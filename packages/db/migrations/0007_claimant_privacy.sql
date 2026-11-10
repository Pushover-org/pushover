-- Claimant privacy (docs/architecture.md → Claimant privacy; plan items P4–P6).
-- The PayPal payer ID is no longer stored in plain text. Each claim keeps:
--   * paypal_pseudonym: HMAC-SHA256 of the payer ID under a per-settlement key. It enforces one
--     claim per PayPal account and is all the screens, the court report and the payout record
--     show. The same account gets unrelated pseudonyms in two settlements.
--   * paypal_payer_sealed: the payer ID under AES-256-GCM, bound to its settlement and claim.
--     Only the payout code opens it, to address the payment.
-- A claimant's private status link is a random token; only its SHA-256 is stored.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM claims WHERE paypal_payer_id IS NOT NULL) THEN
    RAISE EXCEPTION 'claims hold plain PayPal payer IDs; seal them before running 0007';
  END IF;
  IF EXISTS (SELECT 1 FROM payout_items WHERE recipient_type = 'PAYPAL_ID') THEN
    RAISE EXCEPTION 'payout items hold plain PayPal payer IDs; move them to pseudonyms before running 0007';
  END IF;
END $$;

DROP INDEX claims_one_per_paypal_account;
ALTER TABLE claims DROP CONSTRAINT claims_paypal_fields_together;
ALTER TABLE claims DROP COLUMN paypal_payer_id;

ALTER TABLE claims
  ADD COLUMN paypal_pseudonym    text  CHECK (paypal_pseudonym ~ '^[0-9a-f]{64}$'),
  -- version (1) | IV (12) | GCM tag (16) | ciphertext (a payer ID is 13 characters)
  ADD COLUMN paypal_payer_sealed bytea CHECK (length(paypal_payer_sealed) BETWEEN 30 AND 64),
  ADD COLUMN status_token_hash   bytea UNIQUE CHECK (length(status_token_hash) = 32),
  ADD CONSTRAINT claims_paypal_fields_together CHECK (
    (paypal_pseudonym IS NULL) = (paypal_verified IS NULL) AND (paypal_pseudonym IS NULL) = (paypal_payer_sealed IS NULL)
  );

CREATE UNIQUE INDEX claims_one_per_paypal_account ON claims (settlement_id, paypal_pseudonym)
  WHERE paypal_pseudonym IS NOT NULL;

-- A payout to a PayPal account records the pseudonym, never the payer ID itself.
ALTER TABLE payout_items ADD CONSTRAINT payout_items_paypal_id_is_pseudonym
  CHECK (recipient_type <> 'PAYPAL_ID' OR receiver ~ '^pseudonym:[0-9a-f]{64}$');
