-- AnnA Nexus v0.1.44–46 · additive, preserves existing tenants and data.
CREATE TABLE IF NOT EXISTS teamhub.member_profiles (
  auth_subject text PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE teamhub.organizations
  ADD COLUMN IF NOT EXISTS master_institution_id uuid;
ALTER TABLE teamhub.organizations
  ADD COLUMN IF NOT EXISTS module_enabled boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS teamhub_master_institution_unique
  ON teamhub.organizations(master_institution_id)
  WHERE master_institution_id IS NOT NULL;
