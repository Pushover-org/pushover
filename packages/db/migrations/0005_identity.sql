-- Claimant identity through Log in with PayPal (docs/architecture.md → Claimant identity).
-- One PayPal account files one claim per settlement, and its payout goes to that account's
-- payer ID. Claims filed before this (the eval corpus) have no PayPal account and stay valid.

ALTER TABLE claims
  ADD COLUMN paypal_payer_id        text CHECK (paypal_payer_id ~ '^[2-9A-HJ-NP-Z]{13}$'),  -- ppaas_payer_id_v3 (checkout_orders_v2.json)
  ADD COLUMN paypal_verified        boolean,
  ADD COLUMN paypal_email_verified  boolean,
  ADD CONSTRAINT claims_paypal_fields_together CHECK ((paypal_payer_id IS NULL) = (paypal_verified IS NULL));

CREATE UNIQUE INDEX claims_one_per_paypal_account ON claims (settlement_id, paypal_payer_id)
  WHERE paypal_payer_id IS NOT NULL;

-- A payout goes to an email or, for a logged-in claimant, to the PayPal account itself.
ALTER TABLE payout_items
  ADD COLUMN recipient_type text NOT NULL DEFAULT 'EMAIL' CHECK (recipient_type IN ('EMAIL', 'PAYPAL_ID'));
