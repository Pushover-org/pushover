-- A random name for this database, put in every PayPal batch ID (sender_batch_id). PayPal treats a
-- batch ID it has seen as a retry of that batch. Two databases sharing one PayPal app (a laptop and
-- the deployment) both used "poc-<settlement>-r1-p1", so the deployment's first round was taken for
-- the laptop's (2026-11-12). Exactly one row, made once, never changed.
CREATE TABLE deployment_instance (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  id       text NOT NULL DEFAULT substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 10) CHECK (id ~ '^[0-9a-f]{10}$')
);
INSERT INTO deployment_instance DEFAULT VALUES;
GRANT SELECT ON deployment_instance TO pushover_app;
