-- Who filed a claim, and the binding that makes an assistant's filing a person's claim (P11, P13, P14).
--
-- An assistant can fill in the form and attach the receipt. Only the person can make it a claim,
-- by logging in with PayPal and confirming it. The database holds the line on its own, whatever
-- the application code does:
--   * an assistant's claim outside UNBOUND/LAPSED is bound: it has a confirmation time and a PayPal
--     account (its pseudonym);
--   * no payout can be planned for a claim that is UNBOUND or LAPSED;
--   * an assistant's claim is paid only to the PayPal account that confirmed it, never to an email
--     address the assistant typed.
ALTER TABLE claims
  ADD COLUMN filed_via text NOT NULL DEFAULT 'FORM' CHECK (filed_via IN ('FORM', 'ASSISTANT')),
  -- What the assistant said it is called. Self-declared and shown as such; plain text only.
  ADD COLUMN agent_name text CHECK (char_length(agent_name) BETWEEN 1 AND 64 AND agent_name !~ '[[:cntrl:]]'),
  -- When the assistant filed it. submitted_at is when it entered the claims process (confirmation).
  ADD COLUMN agent_filed_at timestamptz,
  -- SHA-256 of the confirm link's token, which is returned once to the assistant for the person.
  ADD COLUMN confirm_token_hash bytea UNIQUE CHECK (length(confirm_token_hash) = 32),
  ADD COLUMN bound_at timestamptz,
  ADD CONSTRAINT claims_assistant_fields_together CHECK (
    (filed_via = 'ASSISTANT') = (agent_name IS NOT NULL) AND (filed_via = 'ASSISTANT') = (agent_filed_at IS NOT NULL)
  ),
  ADD CONSTRAINT claims_bound_only_if_assistant CHECK (bound_at IS NULL OR filed_via = 'ASSISTANT'),
  ADD CONSTRAINT claims_unbound_is_assistant_and_unbound CHECK (
    status NOT IN ('UNBOUND', 'LAPSED') OR (filed_via = 'ASSISTANT' AND bound_at IS NULL)
  ),
  ADD CONSTRAINT claims_assistant_claim_is_bound_to_paypal CHECK (
    filed_via = 'FORM' OR status IN ('UNBOUND', 'LAPSED') OR (bound_at IS NOT NULL AND paypal_pseudonym IS NOT NULL)
  ),
  ADD CONSTRAINT claims_confirm_token_only_while_unbound CHECK (confirm_token_hash IS NULL OR status = 'UNBOUND');

CREATE INDEX claims_unbound_idx ON claims (settlement_id, agent_filed_at) WHERE status = 'UNBOUND';

CREATE FUNCTION payout_item_needs_bound_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c record;
BEGIN
  IF NEW.claim_id IS NULL THEN
    RETURN NEW;  -- a cy-près item
  END IF;
  SELECT status, filed_via, paypal_pseudonym INTO c FROM claims WHERE id = NEW.claim_id;
  IF c.status IN ('UNBOUND', 'LAPSED') THEN
    RAISE EXCEPTION 'claim % was never confirmed by its person: it cannot be paid', NEW.claim_id USING ERRCODE = 'check_violation';
  END IF;
  IF c.filed_via = 'ASSISTANT' AND (NEW.recipient_type <> 'PAYPAL_ID' OR NEW.receiver <> 'pseudonym:' || c.paypal_pseudonym) THEN
    RAISE EXCEPTION 'claim % was filed by an assistant: it is paid only to the PayPal account that confirmed it', NEW.claim_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payout_items_need_bound_claim BEFORE INSERT OR UPDATE OF claim_id, receiver, recipient_type ON payout_items
  FOR EACH ROW EXECUTE FUNCTION payout_item_needs_bound_claim();
