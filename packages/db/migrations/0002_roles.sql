-- The app connects as a login role that is a member of pushover_app (docs/runbooks.md).
-- pushover_app may read and write the app's tables but may only INSERT and SELECT audit_log,
-- and may not touch schema_migrations. Roles are cluster-wide, so create it only once.
DO $$
BEGIN
  CREATE ROLE pushover_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

GRANT USAGE ON SCHEMA public TO pushover_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pushover_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pushover_app;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM pushover_app;
REVOKE ALL ON schema_migrations FROM pushover_app;
GRANT SELECT ON schema_migrations TO pushover_app;
-- Policy versions are written by migrations, not by the app.
REVOKE INSERT, UPDATE, DELETE ON policy FROM pushover_app;
