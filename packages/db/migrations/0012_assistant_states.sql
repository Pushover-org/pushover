-- Claims an assistant files for a person (plan items P13, P14, C14). Two new states:
--   UNBOUND: an assistant filed it; nobody has confirmed it is theirs. It is never read, checked,
--            decided or paid in this state.
--   LAPSED:  it was never confirmed (the window ran out, or the person said it isn't theirs). Kept
--            for the record, closed for good.
-- On their own in this file: Postgres can't use an enum value in the transaction that adds it,
-- and the migrator runs each file in one transaction. 0013 uses them.
ALTER TYPE claim_state ADD VALUE 'UNBOUND' BEFORE 'SUBMITTED';
ALTER TYPE claim_state ADD VALUE 'LAPSED';
