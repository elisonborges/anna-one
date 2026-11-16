-- AnnA Nexus v0.1.40 — gestão por projeto e solicitações de reabertura
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS manager_subject text;
-- Preserve original ownership. Only infer initial management from creator activity when
-- the creator is still an active manager; otherwise leave management unassigned for admin.
UPDATE teamhub.projects p SET manager_subject=a.actor_subject
FROM teamhub.activities a
JOIN teamhub.memberships m ON m.organization_id=a.organization_id
 AND m.auth_subject=a.actor_subject AND m.active=true AND m.role='manager'
WHERE p.manager_subject IS NULL AND a.organization_id=p.organization_id
 AND a.project_id=p.id AND a.action='project.created'
 AND NOT EXISTS(SELECT 1 FROM teamhub.activities earlier WHERE earlier.project_id=p.id
  AND earlier.organization_id=p.organization_id AND earlier.action='project.created'
  AND (earlier.created_at<a.created_at OR (earlier.created_at=a.created_at AND earlier.actor_subject<a.actor_subject)));
CREATE INDEX IF NOT EXISTS nexus_projects_manager_idx ON teamhub.projects(organization_id,manager_subject);
CREATE TABLE IF NOT EXISTS teamhub.task_reopen_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 task_id uuid NOT NULL,
 requester_subject text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decided_by_subject text,
 decision_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id),
 FOREIGN KEY(task_id) REFERENCES teamhub.tasks(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS nexus_one_reopen_pending ON teamhub.task_reopen_requests(organization_id,task_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS nexus_reopen_queue ON teamhub.task_reopen_requests(organization_id,status,created_at DESC);