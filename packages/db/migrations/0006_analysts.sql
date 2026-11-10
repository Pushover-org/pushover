-- Analyst logins, sessions, and two-person approval for money (docs/architecture.md → Admin login).
-- Every review and every money move names a real person. Money leaves the fund only after one
-- analyst proposes an exact plan and a different person with the supervisor role approves it.

CREATE TABLE analysts (
  id             bigserial PRIMARY KEY,
  email          text NOT NULL UNIQUE CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role           text NOT NULL CHECK (role IN ('analyst', 'supervisor')),
  password_hash  text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The cookie carries a random token; only its SHA-256 is stored, so a database leak opens no session.
CREATE TABLE analyst_sessions (
  token_hash  bytea PRIMARY KEY CHECK (length(token_hash) = 32),
  analyst_id  bigint NOT NULL REFERENCES analysts (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX analyst_sessions_by_analyst ON analyst_sessions (analyst_id);

CREATE TABLE money_proposals (
  id             bigserial PRIMARY KEY,
  settlement_id  text NOT NULL REFERENCES settlements (id),
  kind           payout_batch_kind NOT NULL,
  -- SHA-256 of the exact plan. The approver's plan must hash the same, or nothing is sent.
  plan_hash      bytea NOT NULL CHECK (length(plan_hash) = 32),
  plan           jsonb NOT NULL,
  total_cents    bigint NOT NULL CHECK (total_cents > 0),
  proposed_by    bigint NOT NULL REFERENCES analysts (id),
  proposed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL CHECK (expires_at > proposed_at),
  status         text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'CANCELLED', 'SUPERSEDED')),
  decided_by     bigint REFERENCES analysts (id),
  decided_at     timestamptz,
  CHECK ((status = 'PROPOSED') = (decided_by IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  -- Nobody approves their own proposal.
  CHECK (status <> 'APPROVED' OR decided_by <> proposed_by)
);
-- At most one open proposal per settlement and kind.
CREATE UNIQUE INDEX money_proposals_one_open ON money_proposals (settlement_id, kind) WHERE status = 'PROPOSED';

-- The approver must be an enabled supervisor, and a decided proposal never changes again.
CREATE FUNCTION money_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'money proposal % is already %', OLD.id, OLD.status;
  END IF;
  IF NEW.status = 'APPROVED' THEN
    IF NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'money proposal % expired', NEW.id;
    END IF;
    PERFORM 1 FROM analysts WHERE id = NEW.decided_by AND role = 'supervisor' AND NOT disabled;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'only an enabled supervisor can approve money proposal %', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER money_proposal_guard BEFORE INSERT OR UPDATE ON money_proposals
  FOR EACH ROW EXECUTE FUNCTION money_proposal_guard();

-- Every new payout batch comes from an approved proposal for the same settlement and kind.
-- Batches planned before this migration keep a NULL proposal.
ALTER TABLE payout_batches ADD COLUMN proposal_id bigint REFERENCES money_proposals (id);

CREATE FUNCTION payout_batch_needs_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM money_proposals
    WHERE id = NEW.proposal_id AND status = 'APPROVED' AND settlement_id = NEW.settlement_id AND kind = NEW.kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout batch % has no approved proposal', NEW.sender_batch_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_needs_approval BEFORE INSERT ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_batch_needs_approval();
CREATE FUNCTION payout_batch_proposal_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proposal_id IS DISTINCT FROM OLD.proposal_id THEN
    RAISE EXCEPTION 'the proposal of payout batch % cannot change', OLD.sender_batch_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_proposal_fixed BEFORE UPDATE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_batch_proposal_fixed();

GRANT SELECT, INSERT, UPDATE ON analysts, money_proposals TO pushover_app;
GRANT SELECT, INSERT, DELETE ON analyst_sessions TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;
