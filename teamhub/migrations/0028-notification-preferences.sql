-- v0.1.27: preferências de notificação por integrante, com e-mail desativado por padrão
CREATE TABLE IF NOT EXISTS teamhub.notification_preferences (
 organization_id uuid NOT NULL,
 auth_subject text NOT NULL,
 assignments boolean NOT NULL DEFAULT true,
 mentions boolean NOT NULL DEFAULT true,
 deadlines boolean NOT NULL DEFAULT true,
 approvals boolean NOT NULL DEFAULT true,
 email_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,auth_subject),
 FOREIGN KEY (organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject)
);
CREATE INDEX IF NOT EXISTS notification_preferences_org ON teamhub.notification_preferences(organization_id);
