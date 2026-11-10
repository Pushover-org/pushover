-- After Distribute (docs/architecture.md → The money path after Distribute; plan items P38–P40, C4, B5).

-- Each payout item's PayPal transaction, and whether PayPal's own history shows it yet.
-- The history lags the payout (docs/sandbox-findings.md, 2026-11-10), so "waiting" is a state.
ALTER TABLE payout_items
  ADD COLUMN paypal_transaction_id text,
  ADD COLUMN history_status        text NOT NULL DEFAULT 'NOT_CHECKED'
    CHECK (history_status IN ('NOT_CHECKED', 'WAITING', 'CONFIRMED', 'NEVER_CAUGHT_UP')),
  ADD COLUMN history_code          text,          -- event code and status as PayPal reports them, e.g. 'T0001 S'
  ADD COLUMN history_checked_at    timestamptz,
  ADD CONSTRAINT payout_items_confirmed_has_code CHECK (history_status <> 'CONFIRMED' OR history_code IS NOT NULL);

-- When a claim's payout came back (RETURNED or FAILED): the re-offer window starts here.
ALTER TABLE claims
  ADD COLUMN money_back_at timestamptz,
  ADD COLUMN reoffers      integer NOT NULL DEFAULT 0 CHECK (reoffers BETWEEN 0 AND 2);

-- Which claims' returned money each cy-près transfer carried. A claim's money goes to cy-près once.
CREATE TABLE cy_pres_claims (
  claim_id     text PRIMARY KEY REFERENCES claims (id),
  transfer_id  bigint NOT NULL REFERENCES cy_pres_transfers (id),
  cents        bigint NOT NULL CHECK (cents > 0)
);
CREATE INDEX cy_pres_claims_by_transfer ON cy_pres_claims (transfer_id);

GRANT SELECT, INSERT ON cy_pres_claims TO pushover_app;
