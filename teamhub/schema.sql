-- AnnA Nexus MVP (schema técnico teamhub preservado): execute SOMENTE em um banco de desenvolvimento isolado.
CREATE SCHEMA IF NOT EXISTS teamhub;
CREATE TABLE IF NOT EXISTS teamhub.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teamhub.memberships (
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 auth_subject text NOT NULL, role text NOT NULL CHECK(role IN ('admin','manager','member','guest')),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,auth_subject)
);
CREATE TABLE IF NOT EXISTS teamhub.projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 description text NOT NULL DEFAULT '', archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS teamhub.tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 240),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 assignee_subject text,
 due_at timestamptz,
 position integer NOT NULL DEFAULT 0,
 created_by_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id)
);
CREATE INDEX IF NOT EXISTS tasks_by_project ON teamhub.tasks(organization_id,project_id,status,position);
CREATE INDEX IF NOT EXISTS tasks_by_assignee ON teamhub.tasks(organization_id,assignee_subject);
CREATE TABLE IF NOT EXISTS teamhub.activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 actor_subject text NOT NULL, action text NOT NULL,
 project_id uuid, task_id uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_by_org ON teamhub.activities(organization_id,created_at DESC);
-- A organização e administrador inicial devem ser provisionados SOMENTE após autenticação validada.
