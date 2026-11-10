-- Fraud rings (docs/architecture.md → Fraud rings and the investigator; plan items P25–P30).

-- The linking signals, as keyed hashes (like ip_key): the same device, the same inbox once
-- normalised, the same building. Ring detection compares these, never the raw values.
ALTER TABLE claims
  ADD COLUMN device_key   text CHECK (device_key ~ '^[0-9a-f]{64}$'),
  ADD COLUMN inbox_key    text CHECK (inbox_key ~ '^[0-9a-f]{64}$'),
  ADD COLUMN building_key text CHECK (building_key ~ '^[0-9a-f]{64}$');

-- A group as found: the same members always have the same signature. When membership changes, the
-- old group goes inactive and the new membership is a new group. Held is not denied: a person
-- clears or denies it.
CREATE TABLE ring_groups (
  id             bigserial PRIMARY KEY,
  settlement_id  text NOT NULL REFERENCES settlements (id),
  signature      text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  members        jsonb NOT NULL,
  core           jsonb NOT NULL,
  signals        jsonb NOT NULL,
  shared_signals integer NOT NULL CHECK (shared_signals >= 1),
  active         boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'CLEARED', 'DENIED')),
  decided_by     text,
  decided_at     timestamptz,
  found_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, signature),
  CHECK ((status = 'HELD') = (decided_by IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL))
);

-- What the investigator was shown (stand-in labels only), what it answered, and the fixed rule's
-- recommendation. The label → claim map stays here and is never sent. Append-only for the app.
CREATE TABLE investigations (
  id              bigserial PRIMARY KEY,
  group_id        bigint NOT NULL REFERENCES ring_groups (id),
  facts_sha256    text NOT NULL CHECK (facts_sha256 ~ '^[0-9a-f]{64}$'),
  facts           jsonb NOT NULL,
  labels          jsonb NOT NULL,
  model           text NOT NULL,
  status          text NOT NULL CHECK (status IN ('OK', 'REPLAYED', 'INVALID', 'REFUSED', 'NOT_RUN')),
  answers         jsonb,
  recommendation  text NOT NULL CHECK (recommendation IN ('CLEAR', 'DENY_GROUP', 'PERSON_DECIDES')),
  error           text,
  cost_usd        numeric(10, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('OK', 'REPLAYED')) = (answers IS NOT NULL)),
  CHECK (status IN ('OK', 'REPLAYED') OR recommendation = 'PERSON_DECIDES')
);
CREATE INDEX investigations_by_group ON investigations (group_id, id);

GRANT SELECT, INSERT, UPDATE ON ring_groups TO pushover_app;
GRANT SELECT, INSERT ON investigations TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;
