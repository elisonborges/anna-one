-- AnnA Nexus v0.1.16: colaboradores em subtarefas e central interna de notificações.
CREATE TABLE IF NOT EXISTS teamhub.subtask_assignees (
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 subtask_id uuid NOT NULL REFERENCES teamhub.subtasks(id),
 auth_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subtask_id, auth_subject),
 FOREIGN KEY (organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE INDEX IF NOT EXISTS subtask_assignees_member ON teamhub.subtask_assignees(organization_id,auth_subject);
INSERT INTO teamhub.subtask_assignees(organization_id,subtask_id,auth_subject)
SELECT s.organization_id,s.id,s.owner_subject FROM teamhub.subtasks s
JOIN teamhub.memberships m ON m.organization_id=s.organization_id AND m.auth_subject=s.owner_subject
WHERE s.owner_subject IS NOT NULL ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS teamhub.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 recipient_subject text NOT NULL,
 actor_subject text NOT NULL,
 event_type text NOT NULL,
 title text NOT NULL,
 details text NOT NULL DEFAULT '',
 project_id uuid,
 task_id uuid,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,recipient_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE INDEX IF NOT EXISTS notifications_inbox ON teamhub.notifications(organization_id,recipient_subject,created_at DESC);
