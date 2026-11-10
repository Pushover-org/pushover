-- What a claimant sends after filing (plan items P9, C9, B3): an appeal, with words and optionally a
-- new document, or the document the rules asked for. Append-only, like the decisions it leads to.
-- An appeal is open until a person decides the claim after it (a decision by an analyst, newer).
CREATE TABLE claim_followups (
  id           bigserial PRIMARY KEY,
  claim_id     text NOT NULL REFERENCES claims (id),
  kind         text NOT NULL CHECK (kind IN ('APPEAL', 'DOCUMENT')),
  from_status  claim_state NOT NULL,
  message      text CHECK (char_length(message) <= 2000),
  evidence_id  bigint REFERENCES claim_evidence (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'DOCUMENT' OR message IS NOT NULL),
  CHECK (kind = 'APPEAL' OR evidence_id IS NOT NULL)
);
CREATE INDEX claim_followups_by_claim ON claim_followups (claim_id, id);

CREATE TRIGGER claim_followups_no_update_delete BEFORE UPDATE OR DELETE ON claim_followups
  FOR EACH ROW EXECUTE FUNCTION record_is_append_only();
CREATE TRIGGER claim_followups_no_truncate BEFORE TRUNCATE ON claim_followups
  FOR EACH STATEMENT EXECUTE FUNCTION record_is_append_only();

GRANT SELECT, INSERT ON claim_followups TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;
