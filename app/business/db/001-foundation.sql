-- AB-PD-001 / v0.1.0 / 001. Migração aditiva, sem backfill automático.
-- Aplicar em transação única, primeiro em branch isolada. Nenhuma credencial no repositório.
CREATE SCHEMA core;
CREATE SCHEMA business;
REVOKE ALL ON SCHEMA core, business FROM PUBLIC;
CREATE FUNCTION core.mod11_digit(p text, cyclic boolean) RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN r < 2 THEN 0 ELSE 11-r END
 FROM (SELECT (sum((ascii(substr(p,i,1))-48) * CASE WHEN cyclic THEN ((length(p)-i)%8)+2 ELSE length(p)-i+2 END)%11)::integer AS r FROM generate_series(1,length(p)) AS g(i)) s
$$;
CREATE FUNCTION core.valid_cnpj(p text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN p !~ '^[A-Z0-9]{12}[0-9]{2}$' OR p ~ '^([0-9])\1{13}$' THEN false ELSE
 substr(p,13,1)=core.mod11_digit(substr(p,1,12),true)::text AND substr(p,14,1)=core.mod11_digit(substr(p,1,13),true)::text END
$$;
CREATE FUNCTION core.valid_cpf(p text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN p !~ '^[0-9]{11}$' OR p ~ '^([0-9])\1{10}$' THEN false ELSE
 substr(p,10,1)=core.mod11_digit(substr(p,1,9),false)::text AND substr(p,11,1)=core.mod11_digit(substr(p,1,10),false)::text END
$$;
CREATE TABLE business.tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK (kind IN ('internal','customer')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_one_internal_tenant ON business.tenants(kind) WHERE kind='internal';
CREATE TABLE business.tenant_memberships (
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK (role IN ('owner','registry_editor','registry_viewer')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE core.parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 kind text NOT NULL CHECK (kind IN ('PF','PJ')),
 legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
 display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 200),
 country_code text NOT NULL DEFAULT 'BR' CHECK (country_code ~ '^[A-Z]{2}$'),
 cpf text CHECK (cpf IS NULL OR core.valid_cpf(cpf)),
 cnpj_root text CHECK (cnpj_root IS NULL OR cnpj_root ~ '^[A-Z0-9]{8}$'),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 CHECK ((kind='PF' AND cnpj_root IS NULL) OR (kind='PJ' AND cpf IS NULL)),
 CHECK (country_code='BR' OR (cpf IS NULL AND cnpj_root IS NULL)),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,id,kind,cnpj_root),
 UNIQUE(tenant_id,cpf),
 UNIQUE(tenant_id,cnpj_root)
);
CREATE TABLE core.establishments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 party_id uuid NOT NULL,
 party_kind text NOT NULL DEFAULT 'PJ' CHECK (party_kind='PJ'),
 cnpj_root text NOT NULL,
 cnpj text NOT NULL CHECK (core.valid_cnpj(cnpj) AND left(cnpj,8)=cnpj_root),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK (kind IN ('matrix','branch')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,party_id,party_kind,cnpj_root) REFERENCES core.parties(tenant_id,id,kind,cnpj_root) ON DELETE RESTRICT,
 UNIQUE(tenant_id,cnpj),
 UNIQUE(tenant_id,id,party_id)
);
CREATE UNIQUE INDEX core_one_active_matrix ON core.establishments(tenant_id,party_id) WHERE kind='matrix' AND status='active';
CREATE TABLE business.party_roles (
 tenant_id uuid NOT NULL,
 party_id uuid NOT NULL,
 role text NOT NULL CHECK (role IN ('customer','supplier','partner','service_provider','representative')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,party_id,role),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE business.companies (
 tenant_id uuid NOT NULL,
 party_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,party_id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE core.institution_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
 party_id uuid NOT NULL,
 establishment_id uuid,
 valid_from date NOT NULL DEFAULT CURRENT_DATE,
 valid_until date,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 CHECK (valid_until IS NULL OR valid_until>valid_from),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,establishment_id,party_id) REFERENCES core.establishments(tenant_id,id,party_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,institution_id,valid_from)
);
CREATE UNIQUE INDEX core_one_open_operator ON core.institution_links(tenant_id,institution_id) WHERE valid_until IS NULL;
CREATE TABLE business.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 entity_type text NOT NULL,
 entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('create','update','link','unlink','activate','deactivate')),
 request_id uuid NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_audit_by_tenant ON business.audit_events(tenant_id,created_at DESC);
CREATE INDEX core_party_name ON core.parties(tenant_id,legal_name);
CREATE INDEX core_institution_lookup ON core.institution_links(tenant_id,institution_id);
-- A aplicação deve usar role sem BYPASSRLS, não proprietária, com identidade e tenant
-- definidos via set_config(...,true) dentro da mesma transação após validar JWT e escopo.
-- Nenhuma role de execução é criada ou habilitada nesta migração.
ALTER TABLE business.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE business.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_self_read ON business.tenant_memberships FOR SELECT USING (user_id::text=current_setting('anna.actor_id',true) AND tenant_id::text=current_setting('anna.tenant_id',true) AND active);
CREATE POLICY tenant_member_read ON business.tenants FOR SELECT USING (id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=id AND m.active));
ALTER TABLE core.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.parties FORCE ROW LEVEL SECURITY;
CREATE POLICY parties_read ON core.parties FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=parties.tenant_id AND m.active));
ALTER TABLE core.establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.establishments FORCE ROW LEVEL SECURITY;
CREATE POLICY establishments_read ON core.establishments FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=establishments.tenant_id AND m.active));
ALTER TABLE business.party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.party_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY party_roles_read ON business.party_roles FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=party_roles.tenant_id AND m.active));
ALTER TABLE business.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_read ON business.companies FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=companies.tenant_id AND m.active));
ALTER TABLE core.institution_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.institution_links FORCE ROW LEVEL SECURITY;
CREATE POLICY institution_links_read ON core.institution_links FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=institution_links.tenant_id AND m.active));
ALTER TABLE business.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_read ON business.audit_events FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=audit_events.tenant_id AND m.active));
-- Sem políticas de escrita nesta entrega: somente leitura explicitamente autorizada.
-- Provisionamento de tenants, concessões, políticas de escrita, verificação de vínculos
-- institucionais autorizados e auditoria transacional são pré-requisitos da API.
REVOKE ALL ON ALL TABLES IN SCHEMA core,business FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core,business FROM PUBLIC;
