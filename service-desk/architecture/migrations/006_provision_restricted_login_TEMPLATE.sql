-- AnnA Service Desk: provision a dedicated LOGIN from a trusted SQL console.
-- Run ONLY in isolated test environment. Never paste real passwords in GitHub.
-- Replace the password placeholder with a generated secret in a secure SQL console.
-- The role must not inherit neon_superuser or any administrative role.
BEGIN;
CREATE ROLE anna_sd_api_login LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'REPLACE_WITH_RANDOM_SECRET_FROM_VAULT';
GRANT anna_sd_api_runtime TO anna_sd_api_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
COMMIT;

-- Audit the new role before giving the URL to the backend:
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolbypassrls,
       COALESCE(array_agg(parent.rolname) FILTER (WHERE parent.rolname IS NOT NULL), '{}') AS memberships
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid
LEFT JOIN pg_roles parent ON parent.oid = m.roleid
WHERE r.rolname = 'anna_sd_api_login'
GROUP BY r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolbypassrls;

-- Expected: LOGIN true, superuser/createrole/bypassrls false;
-- only anna_sd_api_runtime in memberships.
-- NEVER use the Neon role-creation API for this login until its automatic
-- neon_superuser membership behavior is resolved.
