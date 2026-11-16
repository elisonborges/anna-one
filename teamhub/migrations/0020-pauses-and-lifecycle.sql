-- Nexus v0.1.13: pausas, histórico de pendências e exclusão lógica.
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS paused_at timestamptz;
CREATE TABLE IF NOT EXISTS teamhub.pause_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 project_id uuid NOT NULL,
 task_id uuid,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 started_by_subject text NOT NULL,
 ended_by_subject text,
 CHECK(ended_at IS NULL OR ended_at >= started_at),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id),
 FOREIGN KEY(task_id) REFERENCES teamhub.tasks(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pause_periods_open_project ON teamhub.pause_periods(project_id) WHERE task_id IS NULL AND ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pause_periods_open_task ON teamhub.pause_periods(task_id) WHERE task_id IS NOT NULL AND ended_at IS NULL;
CREATE INDEX IF NOT EXISTS pause_periods_org_project ON teamhub.pause_periods(organization_id,project_id,started_at DESC);
