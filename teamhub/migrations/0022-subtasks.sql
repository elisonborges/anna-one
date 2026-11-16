-- Nexus v0.1.15 — subtarefas por tarefa, com responsável e prazo independentes
CREATE TABLE IF NOT EXISTS teamhub.subtasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 project_id uuid NOT NULL,
 task_id uuid NOT NULL REFERENCES teamhub.tasks(id),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 240),
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 owner_subject text,
 due_at timestamptz,
 created_by_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id)
);
CREATE INDEX IF NOT EXISTS subtasks_by_task ON teamhub.subtasks(organization_id,task_id,created_at);
