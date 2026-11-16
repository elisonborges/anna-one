-- Nexus v0.1.18: visibilidade opcional por projeto.
-- A política antiga fica preservada como padrão (organization).
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'organization';
CREATE TABLE IF NOT EXISTS teamhub.project_members (
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 auth_subject text NOT NULL,
 added_by_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,auth_subject),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id),
 FOREIGN KEY(organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE INDEX IF NOT EXISTS project_members_subject ON teamhub.project_members(organization_id,auth_subject,project_id);
