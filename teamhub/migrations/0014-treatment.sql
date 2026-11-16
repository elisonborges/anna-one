-- AnnA Nexus v0.1.4 — migração ADITIVA. Apenas banco anna-nexus-dev.
-- 'status' (Kanban) continua independente de 'treatment_status'.
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS treatment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS treatment_notes text NOT NULL DEFAULT '';
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS pending_reason text NOT NULL DEFAULT '';
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS next_action text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS teamhub.task_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 task_id uuid NOT NULL REFERENCES teamhub.tasks(id),
 actor_subject text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('created','updated','progress','comment')),
 summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_updates_by_task ON teamhub.task_updates(organization_id,task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_attention ON teamhub.tasks(organization_id,treatment_status,status);
