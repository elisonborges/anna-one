-- AnnA Nexus v0.1.33 — ordem personalizada dos cards por integrante.
-- Cada usuário organiza apenas sua própria visualização e organização.
CREATE TABLE IF NOT EXISTS teamhub.project_card_layouts (
 organization_id uuid NOT NULL,
 auth_subject text NOT NULL,
 project_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,auth_subject),
 FOREIGN KEY(organization_id,auth_subject) REFERENCES teamhub.memberships(organization_id,auth_subject),
 CHECK(jsonb_typeof(project_ids)='array')
);
