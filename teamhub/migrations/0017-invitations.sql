-- AnnA Nexus v0.1.7 — convites seguros por e-mail, sem remoção de registros.
CREATE TABLE IF NOT EXISTS teamhub.invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 email text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','manager','member','guest')),
 token_hash text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
 invited_by_subject text NOT NULL,
 accepted_by_subject text,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz,
 cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending ON teamhub.invitations(organization_id,lower(email)) WHERE status='pending';
CREATE INDEX IF NOT EXISTS invitations_org_history ON teamhub.invitations(organization_id,created_at DESC);
