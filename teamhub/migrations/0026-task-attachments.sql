-- Nexus v0.1.25: anexos privados pequenos, armazenados no banco de desenvolvimento.
-- Limite de 256 KiB para evitar usar o Neon como armazenamento de arquivos grandes.
ALTER TABLE teamhub.tasks ADD CONSTRAINT tasks_id_org_unique UNIQUE (id,organization_id);
CREATE TABLE IF NOT EXISTS teamhub.task_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 task_id uuid NOT NULL,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg','image/webp','text/plain')),
 file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 262144),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 262144),
 uploaded_by_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,organization_id) REFERENCES teamhub.tasks(id,organization_id)
);
CREATE INDEX IF NOT EXISTS task_attachments_lookup ON teamhub.task_attachments(organization_id,task_id,created_at);
