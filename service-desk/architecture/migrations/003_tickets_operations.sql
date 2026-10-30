-- AnnA Service Desk — Fase 2 / extensão do modelo (PROPOSTA, NÃO APLICADA)
-- Executar APÓS 001. PostgreSQL 15+. Não concede acesso à API.
BEGIN;
CREATE TABLE anna_sd.providers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name))>=2),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE anna_sd.contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
 provider_id uuid NOT NULL REFERENCES anna_sd.providers(id),
 starts_on date NOT NULL,
 ends_on date,
 active boolean NOT NULL DEFAULT true,
 CHECK (ends_on IS NULL OR ends_on >= starts_on),
 UNIQUE(tenant_id,id)
);
CREATE INDEX contracts_tenant_provider ON anna_sd.contracts(tenant_id,provider_id);
CREATE TABLE anna_sd.provider_memberships (
 provider_id uuid NOT NULL REFERENCES anna_sd.providers(id),
 user_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
 PRIMARY KEY(provider_id,user_id)
);
CREATE TABLE anna_sd.ticket_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 ticket_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','internal')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES anna_sd.tickets(tenant_id,id)
);
CREATE INDEX messages_ticket_time ON anna_sd.ticket_messages(tenant_id,ticket_id,created_at);
CREATE TABLE anna_sd.attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 ticket_id uuid NOT NULL,
 uploader_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
 storage_key text NOT NULL UNIQUE,
 original_name text NOT NULL,
 content_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
 sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','internal')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES anna_sd.tickets(tenant_id,id)
);
CREATE INDEX attachments_ticket ON anna_sd.attachments(tenant_id,ticket_id);
CREATE TABLE anna_sd.priority_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 ticket_id uuid NOT NULL,
 requester_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
 requested_priority text NOT NULL CHECK(requested_priority IN ('low','normal','high')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 reviewer_id uuid REFERENCES anna_sd.platform_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES anna_sd.tickets(tenant_id,id),
 CHECK ((state='pending' AND reviewer_id IS NULL AND reviewed_at IS NULL)
   OR (state IN ('approved','rejected') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX reviews_ticket ON anna_sd.priority_reviews(tenant_id,ticket_id,created_at);
CREATE TABLE anna_sd.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES anna_sd.tenants(id),
 actor_id uuid REFERENCES anna_sd.platform_users(id),
 action text NOT NULL,
 resource_type text NOT NULL,
 resource_id uuid,
 result text NOT NULL CHECK(result IN ('allowed','denied','error')),
 created_at timestamptz NOT NULL DEFAULT now(),
 details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_tenant_time ON anna_sd.audit_events(tenant_id,created_at DESC);
-- Defense in depth: RLS enabled and forced, no policies or grants yet.
ALTER TABLE anna_sd.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.provider_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.priority_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.providers FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.provider_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.ticket_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.priority_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA anna_sd FROM PUBLIC;
COMMIT;
-- Acesso às linhas e armazenamento privado dependem de autorização real no backend.
