-- Apply only to the isolated Neon test project after review.
-- Private credential storage, not exposed to requester RLS role.
BEGIN;
CREATE TABLE IF NOT EXISTS anna_sd.local_credentials (
 user_id uuid PRIMARY KEY REFERENCES anna_sd.platform_users(id) ON DELETE CASCADE,
 email text NOT NULL,
 password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$16384$8$1$%'),
 enabled boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 100),
 locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT local_credentials_email_valid CHECK (length(email) BETWEEN 5 AND 254 AND email = lower(trim(email)) AND position('@' in email) > 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS local_credentials_email_unique ON anna_sd.local_credentials(email);
ALTER TABLE anna_sd.local_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.local_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON anna_sd.local_credentials FROM PUBLIC;
REVOKE ALL ON anna_sd.local_credentials FROM anna_sd_api_runtime;
-- A separate, audited identity service role must be provisioned before
-- granting access; no anonymous signups or direct SQL access.
COMMIT;
