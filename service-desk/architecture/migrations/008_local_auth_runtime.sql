-- Isolated Neon test DB only. Identity role is NOLOGIN, default-deny to all others.
BEGIN;
CREATE ROLE anna_sd_identity_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA anna_sd TO anna_sd_identity_runtime;
GRANT SELECT, UPDATE ON anna_sd.local_credentials TO anna_sd_identity_runtime;
CREATE POLICY local_credentials_identity_select ON anna_sd.local_credentials
 FOR SELECT TO anna_sd_identity_runtime USING (true);
CREATE POLICY local_credentials_identity_update ON anna_sd.local_credentials
 FOR UPDATE TO anna_sd_identity_runtime USING (true) WITH CHECK (true);
COMMIT;
-- IMPORTANT: This role is exclusively for the trusted backend login handler.
-- Never grant it to the requester-facing SQL role, frontend, or public.
-- Provision a nonprivileged LOGIN with SET TRUE on this role only after secret management.
