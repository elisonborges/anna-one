-- AnnA Nexus 0.1.47–0.1.49 · produção e convites por card (aditivo DEV).
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'project' CHECK (card_type IN ('project','production'));
CREATE TABLE IF NOT EXISTS teamhub.production_settings(
 organization_id uuid NOT NULL, project_id uuid NOT NULL,
 target numeric(16,3) NOT NULL CHECK(target>0), unit text NOT NULL,
 due_date date NOT NULL, goal_mode text NOT NULL DEFAULT 'collective' CHECK(goal_mode IN ('collective','individual')),
 approval_required boolean NOT NULL DEFAULT false,
 quality_enabled boolean NOT NULL DEFAULT false,
 quality_actor text NOT NULL DEFAULT 'operator' CHECK(quality_actor IN ('operator','inspector')),
 shifts jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,project_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id)
);
CREATE TABLE IF NOT EXISTS teamhub.production_assignments(
 organization_id uuid NOT NULL, project_id uuid NOT NULL, auth_subject text NOT NULL,
 production_role text NOT NULL DEFAULT 'operator' CHECK(production_role IN ('operator','inspector','viewer')),
 individual_target numeric(16,3) CHECK(individual_target IS NULL OR individual_target>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,project_id,auth_subject),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id)
);
CREATE TABLE IF NOT EXISTS teamhub.production_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,project_id uuid NOT NULL,
 author_subject text NOT NULL, quantity numeric(16,3) NOT NULL CHECK(quantity>0),
 operational_date date NOT NULL,
 shift_name text,
 quality_approved numeric(16,3), quality_rejected numeric(16,3),
 quality_rework numeric(16,3),
 quality_by_subject text,quality_at timestamptz,
 status text NOT NULL CHECK(status IN ('awaiting_quality','pending','approved','rejected')),
 decided_by_subject text,decided_at timestamptz,
 decision_note text NOT NULL DEFAULT '',
 client_request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,organization_id) REFERENCES teamhub.projects(id,organization_id),
 UNIQUE(organization_id,project_id,client_request_id),
 CHECK(quality_approved IS NULL OR quality_approved>=0),
 CHECK(quality_rejected IS NULL OR quality_rejected>=0),
 CHECK(quality_rework IS NULL OR quality_rework>=0)
);
CREATE INDEX IF NOT EXISTS production_entries_project_idx ON teamhub.production_entries(organization_id,project_id,operational_date DESC);
CREATE TABLE IF NOT EXISTS teamhub.production_rework(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL, project_id uuid NOT NULL, entry_id uuid NOT NULL REFERENCES teamhub.production_entries(id),
 approved numeric(16,3) NOT NULL CHECK(approved>=0),
 rejected numeric(16,3) NOT NULL CHECK(rejected>=0),
 operator_subject text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teamhub.production_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,project_id uuid NOT NULL,entry_id uuid,
 actor_subject text NOT NULL, action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS project_id uuid;
CREATE INDEX IF NOT EXISTS invitations_card_idx ON teamhub.invitations(organization_id,project_id) WHERE project_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS teamhub.card_email_notices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,
 project_id uuid NOT NULL, recipient_subject text NOT NULL,
 recipient_email text NOT NULL, status text NOT NULL DEFAULT 'queued',
 provider_id text,error_message text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,recipient_subject)
);
