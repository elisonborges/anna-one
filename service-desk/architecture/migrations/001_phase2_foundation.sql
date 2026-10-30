-- AnnA Service Desk / Fase 2 / PostgreSQL
-- Migração PROPOSTA, não aplicada. Requer PostgreSQL 15+ e pgcrypto.
-- Política: conexões de aplicação sem acesso direto às tabelas até API e autorização auditadas.
BEGIN;
CREATE SCHEMA IF NOT EXISTS anna_sd;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE anna_sd.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE anna_sd.platform_users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE anna_sd.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
  name text NOT NULL,
  UNIQUE (tenant_id,id)
);
CREATE TABLE anna_sd.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
  user_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
  role text NOT NULL CHECK (role IN ('requester','technician','supervisor','approver','manager')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('invited','pending','active','revoked')),
  unit_id uuid,
  FOREIGN KEY (tenant_id,unit_id) REFERENCES anna_sd.units(tenant_id,id),
  UNIQUE (tenant_id,user_id,role,unit_id)
);
CREATE INDEX memberships_user_scope ON anna_sd.memberships(user_id,tenant_id,status);
CREATE TABLE anna_sd.protocol_counters (
  tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY(tenant_id,year)
);
CREATE TABLE anna_sd.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
  requester_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
  unit_id uuid NOT NULL,
  category_code text NOT NULL CHECK (category_code ~ '^[A-Z0-9_-]{2,20}$'),
  category_label text NOT NULL,
  protocol_year integer NOT NULL,
  protocol_sequence bigint NOT NULL CHECK (protocol_sequence > 0),
  public_protocol text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','pending','resolved','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,unit_id) REFERENCES anna_sd.units(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,protocol_year,protocol_sequence)
);
CREATE INDEX tickets_tenant_created ON anna_sd.tickets(tenant_id,created_at DESC);
CREATE TABLE anna_sd.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  actor_id uuid REFERENCES anna_sd.platform_users(id),
  kind text NOT NULL,
  note text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES anna_sd.tickets(tenant_id,id)
);
CREATE INDEX events_ticket_created ON anna_sd.ticket_events(tenant_id,ticket_id,created_at);
-- Defesa em profundidade: nenhuma conexão de aplicação recebe grants aqui.
-- Políticas RLS serão adicionadas e testadas após definir identidade confiável da API.
ALTER TABLE anna_sd.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.protocol_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.platform_users FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.units FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.protocol_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.ticket_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA anna_sd FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA anna_sd FROM PUBLIC;
COMMIT;

-- IMPORTANT: No API grants, RLS policies, protocol issuing function, or real auth yet.
-- Do NOT execute against production; this is a versioned design artifact.
