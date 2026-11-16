-- AnnA Nexus v0.1.28 — auditoria de agendamento e preparação de e-mail
CREATE TABLE IF NOT EXISTS teamhub.automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 job_name text NOT NULL DEFAULT 'deadline-check',
 local_day date NOT NULL,
 status text NOT NULL CHECK (status IN ('running','completed','failed')),
 trigger_type text NOT NULL CHECK(trigger_type IN ('scheduled','manual')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 tasks_created integer NOT NULL DEFAULT 0,
 subtasks_created integer NOT NULL DEFAULT 0,
 error_message text NOT NULL DEFAULT '',
 UNIQUE(organization_id,job_name,local_day,trigger_type)
);
CREATE INDEX IF NOT EXISTS automation_runs_recent ON teamhub.automation_runs(organization_id,started_at DESC);
-- E-mails só podem ser habilitados por um usuário com identidade autenticada e e-mail verificado.
CREATE TABLE IF NOT EXISTS teamhub.notification_email_contacts (
 organization_id uuid NOT NULL,
 auth_subject text NOT NULL,
 email text NOT NULL,
 verified_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,auth_subject),
 FOREIGN KEY(organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE TABLE IF NOT EXISTS teamhub.email_delivery_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL UNIQUE REFERENCES teamhub.notifications(id),
 organization_id uuid NOT NULL REFERENCES teamhub.organizations(id),
 recipient_subject text NOT NULL,
 recipient_email text NOT NULL,
 status text NOT NULL CHECK(status IN ('sent','failed')),
 provider_message_id text,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 error_message text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS email_delivery_org ON teamhub.email_delivery_log(organization_id,attempted_at DESC);
