-- Rightful Share claims schema (spec §4.6, with the corrections in docs/architecture.md).
-- Money is integer cents; bigint where a whole fund can pass what integer holds.
-- Pushover's tables stay as they are (spec §2 default).

CREATE TABLE settlements (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  config      jsonb NOT NULL,                      -- SettlementSchema, as validated by packages/claims
  fund_cents  bigint NOT NULL CHECK (fund_cents > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement_products (
  settlement_id text NOT NULL REFERENCES settlements (id),
  product_id    text NOT NULL,
  name          text NOT NULL,
  description   text NOT NULL,
  PRIMARY KEY (settlement_id, product_id)
);

CREATE TYPE claim_tier AS ENUM ('proof', 'no_proof');
CREATE TYPE claim_state AS ENUM (
  'SUBMITTED', 'EXAMINED', 'APPROVE', 'DENY', 'NEED_MORE', 'REVIEW',
  'SCHEDULED', 'PAID', 'UNCLAIMED', 'RETURNED', 'FAILED', 'CY_PRES_ELIGIBLE', 'UNVERIFIED'
);

CREATE TABLE claims (
  id             text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9._-]{1,63}$'),  -- also PayPal's sender_item_id
  settlement_id  text NOT NULL REFERENCES settlements (id),
  seq            bigserial NOT NULL UNIQUE,        -- filing order: "earlier" in C6, C8 and C12
  tier           claim_tier NOT NULL,
  units_claimed  integer NOT NULL CHECK (units_claimed >= 1),
  claimant_name  text NOT NULL,
  payout_email   text NOT NULL,
  address_line   text NOT NULL,
  city           text NOT NULL,
  state          text NOT NULL,
  zip            text NOT NULL,
  declaration    text NOT NULL,
  ip_key         text,                             -- keyed hash of the /24 or /48, never a raw IP
  status         claim_state NOT NULL DEFAULT 'SUBMITTED',
  submitted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_settlement_idx ON claims (settlement_id, seq);

CREATE TABLE claim_evidence (
  id            bigserial PRIMARY KEY,
  claim_id      text NOT NULL REFERENCES claims (id),
  content_type  text NOT NULL,
  bytes         bytea NOT NULL,                    -- personal data: never in git, never in a report
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  phash         text CHECK (phash ~ '^[01]{64}$'), -- upright hash; NULL means C6 is UNKNOWN
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_evidence_claim_idx ON claim_evidence (claim_id);

CREATE TYPE examiner_status AS ENUM ('OK', 'INVALID', 'REFUSED', 'NOT_RUN');

CREATE TABLE findings (
  id          bigserial PRIMARY KEY,
  claim_id    text NOT NULL REFERENCES claims (id),
  model       text NOT NULL,
  status      examiner_status NOT NULL,
  findings    jsonb,                               -- FindingsSchema; NULL unless status is OK
  cost_usd    numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT findings_only_when_ok CHECK ((status = 'OK') = (findings IS NOT NULL))
);
CREATE INDEX findings_claim_idx ON findings (claim_id, id);

CREATE TYPE decision_outcome AS ENUM ('APPROVE', 'DENY', 'NEED_MORE', 'REVIEW');

-- A decision is never edited. A later one (a person's, or a cluster re-check) is a new row.
CREATE TABLE decisions (
  id                 bigserial PRIMARY KEY,
  claim_id           text NOT NULL REFERENCES claims (id),
  decision_version   text NOT NULL,
  outcome            decision_outcome NOT NULL,
  rule               integer,                      -- NULL for a person's decision
  reason             text NOT NULL,
  check_id           text,
  document_request   text,
  units              integer CHECK (units >= 1),
  units_claimed      integer,
  entitlement_cents  integer CHECK (entitlement_cents > 0),
  decided_by         text NOT NULL,                -- 'system' | 'analyst:<who>'
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_approve_has_amount CHECK ((outcome = 'APPROVE') = (entitlement_cents IS NOT NULL))
);
CREATE INDEX decisions_claim_idx ON decisions (claim_id, id);

CREATE TYPE check_outcome AS ENUM ('PASS', 'FAIL', 'UNKNOWN');

CREATE TABLE check_results (
  decision_id  bigint NOT NULL REFERENCES decisions (id),
  check_id     text NOT NULL,
  result       check_outcome NOT NULL,
  detail       text NOT NULL,
  PRIMARY KEY (decision_id, check_id)
);

CREATE TYPE payout_batch_kind AS ENUM ('CLAIMS', 'CY_PRES');

CREATE TABLE payout_batches (
  id               bigserial PRIMARY KEY,
  settlement_id    text NOT NULL REFERENCES settlements (id),
  kind             payout_batch_kind NOT NULL,
  round            integer NOT NULL CHECK (round >= 1),
  part             integer NOT NULL DEFAULT 1 CHECK (part >= 1),
  -- PayPal refuses a repeat for only 30 days. This refuses it for good.
  sender_batch_id  text NOT NULL UNIQUE,
  paypal_batch_id  text UNIQUE,                    -- NULL until PayPal answers
  batch_status     text,                           -- as PayPal reports it
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),
  fees_cents       bigint CHECK (fees_cents >= 0), -- NULL until PayPal reports it: never assumed
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, kind, round, part)
);

CREATE TYPE payout_outcome AS ENUM ('PLANNED', 'PAID', 'UNCLAIMED', 'RETURNED', 'FAILED', 'IN_FLIGHT', 'UNVERIFIED');

CREATE TABLE payout_items (
  id              bigserial PRIMARY KEY,
  batch_id        bigint NOT NULL REFERENCES payout_batches (id),
  claim_id        text REFERENCES claims (id),     -- NULL for a cy-près item
  sender_item_id  text NOT NULL,
  receiver        text NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents > 0),
  paypal_item_id  text UNIQUE,
  paypal_status   text,
  outcome         payout_outcome NOT NULL DEFAULT 'PLANNED',
  fee_cents       integer CHECK (fee_cents >= 0),  -- NULL until reported: never assumed
  error           text,
  read_at         timestamptz,
  UNIQUE (batch_id, sender_item_id)
);
-- A claim can hold one live payout. Only money that came back frees it.
CREATE UNIQUE INDEX payout_items_one_live_per_claim ON payout_items (claim_id)
  WHERE claim_id IS NOT NULL AND outcome NOT IN ('RETURNED', 'FAILED');

CREATE TABLE cy_pres_transfers (
  id               bigserial PRIMARY KEY,
  settlement_id    text NOT NULL REFERENCES settlements (id),
  batch_id         bigint NOT NULL UNIQUE REFERENCES payout_batches (id),
  recipient_name   text NOT NULL,
  recipient_email  text NOT NULL,
  cents            bigint NOT NULL CHECK (cents > 0),
  approved_by      text NOT NULL,                  -- a person always approves it (spec §1.3)
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Decisions and their checks are the court's record: nobody rewrites them, table owner included.
CREATE FUNCTION record_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER decisions_no_update_delete BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION record_is_append_only();
CREATE TRIGGER decisions_no_truncate BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION record_is_append_only();
CREATE TRIGGER check_results_no_update_delete BEFORE UPDATE OR DELETE ON check_results
  FOR EACH ROW EXECUTE FUNCTION record_is_append_only();
CREATE TRIGGER check_results_no_truncate BEFORE TRUNCATE ON check_results
  FOR EACH STATEMENT EXECUTE FUNCTION record_is_append_only();

-- 0002's grants covered only the tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  settlements, settlement_products, claims, claim_evidence, findings, payout_batches, payout_items, cy_pres_transfers
  TO pushover_app;
GRANT SELECT, INSERT ON decisions, check_results TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;
