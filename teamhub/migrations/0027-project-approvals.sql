-- Nexus v0.1.26: conferência e aprovação formal de encerramento
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'active';
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS completion_requested_at timestamptz;
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS completion_note text;
CREATE TABLE IF NOT EXISTS teamhub.project_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('requested','approved','rejected','reopened')),
 actor_subject text NOT NULL,
 note text NOT NULL DEFAULT '',
 checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id)
);
CREATE INDEX IF NOT EXISTS project_approvals_history ON teamhub.project_approvals(organization_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_completion_queue ON teamhub.projects(organization_id,completion_status);
