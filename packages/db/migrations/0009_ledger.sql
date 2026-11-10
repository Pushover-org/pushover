-- The decision ledger (docs/architecture.md → The decision ledger; plan items P33, P42–P45, C1, C2).
-- Before a payout batch exists, the Merkle root of every decided claim is committed with the rules'
-- fingerprint and a future drand round. The commitment never changes afterwards; only the drand
-- beacon, once published and verified, and the audit sample it picks are filled in, once.

CREATE TABLE ledger_commitments (
  id            bigserial PRIMARY KEY,
  settlement_id text NOT NULL REFERENCES settlements (id),
  proposal_id   bigint NOT NULL UNIQUE REFERENCES money_proposals (id),
  kind          payout_batch_kind NOT NULL,
  round         integer NOT NULL CHECK (round >= 1),
  root          bytea NOT NULL CHECK (length(root) = 32),
  -- SHA-256 of the canonical commitment: what each payout's note at PayPal carries.
  digest        bytea NOT NULL UNIQUE CHECK (length(digest) = 32),
  commitment    jsonb NOT NULL,
  -- Every decision leaf, frozen as committed, so anyone can recompute the root.
  leaves        jsonb NOT NULL,
  drand_round   bigint NOT NULL CHECK (drand_round > 0),
  committed_at  timestamptz NOT NULL DEFAULT now(),
  beacon        jsonb,
  sample        jsonb,
  beacon_checked_at timestamptz,
  CHECK ((beacon IS NULL) = (sample IS NULL))
);

CREATE FUNCTION ledger_commitment_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger commitments are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.settlement_id, NEW.proposal_id, NEW.kind, NEW.round, NEW.root, NEW.digest, NEW.commitment, NEW.leaves, NEW.drand_round, NEW.committed_at)
     IS DISTINCT FROM (OLD.settlement_id, OLD.proposal_id, OLD.kind, OLD.round, OLD.root, OLD.digest, OLD.commitment, OLD.leaves, OLD.drand_round, OLD.committed_at) THEN
    RAISE EXCEPTION 'ledger commitment % is frozen', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.beacon IS NOT NULL AND (NEW.beacon IS DISTINCT FROM OLD.beacon OR NEW.sample IS DISTINCT FROM OLD.sample) THEN
    RAISE EXCEPTION 'the drand beacon of ledger commitment % is already recorded', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_commitment_frozen BEFORE UPDATE OR DELETE ON ledger_commitments
  FOR EACH ROW EXECUTE FUNCTION ledger_commitment_frozen();

-- Every new payout batch names the commitment of its own approved proposal, made before it.
ALTER TABLE payout_batches ADD COLUMN ledger_commitment_id bigint REFERENCES ledger_commitments (id);

CREATE FUNCTION payout_batch_needs_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM ledger_commitments l
    WHERE l.id = NEW.ledger_commitment_id AND l.proposal_id = NEW.proposal_id AND l.settlement_id = NEW.settlement_id AND l.kind = NEW.kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout batch % has no ledger commitment for its proposal', NEW.sender_batch_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_needs_ledger BEFORE INSERT ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_batch_needs_ledger();

CREATE FUNCTION payout_batch_ledger_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ledger_commitment_id IS DISTINCT FROM OLD.ledger_commitment_id THEN
    RAISE EXCEPTION 'the ledger commitment of payout batch % cannot change', OLD.sender_batch_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_ledger_fixed BEFORE UPDATE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_batch_ledger_fixed();

-- PayPal's note on each item as read back, so anyone can see PayPal's record names the ledger.
ALTER TABLE payout_items ADD COLUMN paypal_note text;

GRANT SELECT, INSERT, UPDATE ON ledger_commitments TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;
