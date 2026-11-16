-- AnnA Nexus v0.1.42 — status de envio de convites (migração aditiva)
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'manual';
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz;
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS email_provider_id text;
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS email_error text;
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS invitations_email_status_idx ON teamhub.invitations(organization_id,email_status,created_at DESC);
