-- Nexus v0.1.19: etiquetas por tarefa, migração aditiva
ALTER TABLE teamhub.tasks ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS tasks_labels_gin ON teamhub.tasks USING gin(labels);
