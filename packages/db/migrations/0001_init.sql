-- Pushover schema v1 (spec §4.5, with the changes listed in docs/architecture.md).
-- Money is integer cents everywhere. Currency is USD only.
-- schema_migrations is created by the migrator itself (src/migrate.ts).

CREATE TYPE merchant_kind AS ENUM ('BASELINE', 'GUARDED');

-- Customers and orders are keyed by (merchant, id): the Lab mirrors one scenario into
-- both stores, so "C-1042" and "PO-4417" exist once per store.
CREATE TABLE customers (
  merchant      merchant_kind NOT NULL,
  id            text NOT NULL,                     -- 'C-1042'
  display_name  text NOT NULL,
  email         text NOT NULL,
  is_demo       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant, id),
  UNIQUE (merchant, email)
);

CREATE TABLE orders (
  merchant        merchant_kind NOT NULL,
  id              text NOT NULL,                   -- store reference 'PO-4417'
  customer_id     text,                            -- NULL while the order sits unassigned in the pool
  paypal_order_id text NOT NULL UNIQUE,
  currency        text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  total_cents     integer NOT NULL CHECK (total_cents > 0),
  delivered_at    timestamptz,                     -- policy window runs from here (spec §3.6)
  notes           text,                            -- may contain attacker text (A8 fixtures)
  scenario_id     text,                            -- which fixture checked it out
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant, id),
  FOREIGN KEY (merchant, customer_id) REFERENCES customers (merchant, id),
  -- An order has an owner exactly when it has a delivery date.
  CONSTRAINT orders_assigned_together CHECK ((customer_id IS NULL) = (delivered_at IS NULL))
);
CREATE INDEX orders_customer_idx ON orders (merchant, customer_id);

CREATE TABLE order_items (
  merchant    merchant_kind NOT NULL,
  order_id    text NOT NULL,
  sku         text NOT NULL,
  name        text NOT NULL,                       -- merchant-controlled; may carry injected text (A8)
  qty         integer NOT NULL CHECK (qty > 0),
  unit_cents  integer NOT NULL CHECK (unit_cents >= 0),
  tax_cents   integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),  -- PER UNIT, as PayPal's items[].tax
  PRIMARY KEY (merchant, order_id, sku),
  FOREIGN KEY (merchant, order_id) REFERENCES orders (merchant, id)
);

CREATE TYPE capture_state AS ENUM ('POOL', 'ASSIGNED', 'RETIRED');
CREATE TABLE captures (
  id              text PRIMARY KEY,                -- PayPal capture id
  merchant        merchant_kind NOT NULL,
  order_id        text NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents > 0),
  paypal_status   text NOT NULL,                   -- last read: COMPLETED | PARTIALLY_REFUNDED | REFUNDED | PENDING | ...
  state           capture_state NOT NULL DEFAULT 'POOL',
  last_synced_at  timestamptz,
  UNIQUE (merchant, order_id),
  FOREIGN KEY (merchant, order_id) REFERENCES orders (merchant, id)
);

CREATE TABLE refunds (                             -- mirror of PayPal refunds, from reads/webhooks
  id                text PRIMARY KEY,              -- PayPal refund id
  capture_id        text NOT NULL REFERENCES captures (id),
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  paypal_status     text NOT NULL,                 -- COMPLETED | PENDING | FAILED | CANCELLED
  source            text NOT NULL CHECK (source IN ('LEDGER', 'BASELINE_AGENT', 'EXTERNAL')),
  refund_request_id uuid,                          -- set when the ledger created it
  created_at        timestamptz NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE rr_status AS ENUM ('DECIDING', 'REFUSED', 'HELD', 'EXECUTING', 'REFUNDED', 'UNVERIFIED', 'FAILED', 'DENIED');
CREATE TABLE refund_requests (                     -- one row per refund INTENT; the ledger serves the guarded store only
  id                uuid PRIMARY KEY,
  merchant          merchant_kind NOT NULL DEFAULT 'GUARDED' CHECK (merchant = 'GUARDED'),
  session_id        text NOT NULL,
  customer_id       text NOT NULL,                 -- FROM SESSION, never from message
  order_ref         text NOT NULL,                 -- what the model passed (may not exist / not be theirs)
  order_id          text,                          -- resolved, only if it exists
  capture_id        text REFERENCES captures (id),
  scope             text NOT NULL CHECK (scope IN ('full', 'item')),
  item_sku          text,
  reason            text NOT NULL,                 -- model-supplied free text, stored, never used for decisions
  amount_cents      integer CHECK (amount_cents > 0),  -- computed by the ledger, never by the model
  status            rr_status NOT NULL DEFAULT 'DECIDING',
  decision          jsonb,                         -- full Decision object incl. rule trace
  paypal_request_id text UNIQUE,                   -- 'pushover-refund-<id>'
  paypal_refund_id  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant, customer_id) REFERENCES customers (merchant, id),
  FOREIGN KEY (merchant, order_id) REFERENCES orders (merchant, id),
  CONSTRAINT rr_item_scope CHECK ((scope = 'item') = (item_sku IS NOT NULL))
);
-- At most ONE live intent per (capture, scope, item): duplicates collapse onto it.
CREATE UNIQUE INDEX rr_one_live_intent ON refund_requests (capture_id, scope, coalesce(item_sku, ''))
  WHERE status IN ('DECIDING', 'HELD', 'EXECUTING', 'UNVERIFIED');

CREATE TABLE held_queue (
  ticket_id         text PRIMARY KEY,              -- 'H-0194'
  refund_request_id uuid NOT NULL UNIQUE REFERENCES refund_requests (id),
  reason_code       text NOT NULL CHECK (reason_code IN ('ABOVE_THRESHOLD', 'UNVERIFIED', 'DAILY_CAP', 'VELOCITY', 'DISPUTED', 'ESCALATED')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution        text CHECK (resolution IN ('APPROVED', 'DENIED', 'EXPIRED')),
  resolved_by       text,
  CONSTRAINT held_resolved_together CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

CREATE TABLE policy (                              -- versioned store policy; ledger and oracle both read the active row
  version               integer PRIMARY KEY,
  window_days           integer NOT NULL CHECK (window_days > 0),
  human_threshold_cents integer NOT NULL CHECK (human_threshold_cents > 0),
  daily_cap_cents       integer NOT NULL CHECK (daily_cap_cents > 0),
  velocity_max          integer NOT NULL CHECK (velocity_max > 0),
  velocity_window_days  integer NOT NULL CHECK (velocity_window_days > 0),
  active                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX policy_one_active ON policy (active) WHERE active;

CREATE TABLE lab_sessions (
  id                   text PRIMARY KEY,
  ip_hash              text NOT NULL,
  scenario_id          text NOT NULL,
  guarded_merchant     merchant_kind NOT NULL DEFAULT 'GUARDED' CHECK (guarded_merchant = 'GUARDED'),
  guarded_customer_id  text NOT NULL,
  baseline_merchant    merchant_kind NOT NULL DEFAULT 'BASELINE' CHECK (baseline_merchant = 'BASELINE'),
  baseline_customer_id text NOT NULL,
  messages_used        integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  FOREIGN KEY (guarded_merchant, guarded_customer_id) REFERENCES customers (merchant, id),
  FOREIGN KEY (baseline_merchant, baseline_customer_id) REFERENCES customers (merchant, id)
);

CREATE TABLE chat_turns (
  id            bigserial PRIMARY KEY,
  session_id    text NOT NULL,
  agent         text NOT NULL CHECK (agent IN ('pushover', 'baseline')),
  model         text NOT NULL,
  role          text NOT NULL,
  content       jsonb NOT NULL,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10, 6),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attack_runs (                         -- one row per corpus item per agent per model per seed
  id                bigserial PRIMARY KEY,
  run_id            text NOT NULL,
  item_id           text NOT NULL,
  attack_class      text NOT NULL,
  agent             text NOT NULL,
  model             text NOT NULL,
  seed              integer NOT NULL,
  moved_cents       integer,                       -- NULL = not verified (never 0 by default)
  owed_cents        integer NOT NULL,
  unwarranted_cents integer,
  legit             boolean NOT NULL,
  outcome           text NOT NULL CHECK (outcome IN ('REFUNDED', 'REFUSED', 'HELD', 'NO_ACTION', 'UNVERIFIED', 'ERROR')),
  false_refusal     boolean,
  duplicate_refunds integer NOT NULL DEFAULT 0,
  tool_calls        jsonb NOT NULL,
  cost_usd          numeric(10, 6),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- An unverified row has no moved amount; a verified one must have one.
  CONSTRAINT attack_runs_unknown_is_null CHECK ((outcome = 'UNVERIFIED') = (moved_cents IS NULL))
);

CREATE TABLE webhook_events (
  id           text PRIMARY KEY,                   -- PayPal event id (idempotency)
  event_type   text NOT NULL,
  verified     boolean NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE audit_log (                           -- append-only (0002 grants + trigger below)
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,                           -- 'agent:pushover' | 'ledger' | 'admin:<email>' | 'worker'
  action  text NOT NULL,
  subject text NOT NULL,
  detail  jsonb NOT NULL
);

-- Even the table owner cannot rewrite history. The app role also lacks the grants (0002).
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Shared PayPal rate limit across processes: at most N grants per key in any rolling minute.
-- rate_buckets holds one lock row per key; rate_grants logs each grant.
CREATE TABLE rate_buckets (key text PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_grants (
  key text NOT NULL REFERENCES rate_buckets (key),
  at  timestamptz NOT NULL
);
CREATE INDEX rate_grants_key_at ON rate_grants (key, at);

CREATE TABLE ai_spend_daily (day date PRIMARY KEY, usd numeric(12, 6) NOT NULL DEFAULT 0);
