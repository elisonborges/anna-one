-- v0.1.9: identidade visual da organização e responsáveis compartilhados.
ALTER TABLE teamhub.organizations ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE teamhub.organizations ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS teamhub.task_assignees (
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 task_id uuid NOT NULL REFERENCES teamhub.tasks(id),
 auth_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,auth_subject),
 FOREIGN KEY(organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE INDEX IF NOT EXISTS task_assignees_member ON teamhub.task_assignees(organization_id,auth_subject);
-- Migração preserva a atribuição individual já existente.
INSERT INTO teamhub.task_assignees(organization_id,task_id,auth_subject)
SELECT t.organization_id,t.id,t.assignee_subject
FROM teamhub.tasks t JOIN teamhub.memberships m ON m.organization_id=t.organization_id AND m.auth_subject=t.assignee_subject
WHERE t.assignee_subject IS NOT NULL
ON CONFLICT DO NOTHING;
