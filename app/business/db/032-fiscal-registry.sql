-- 032: cadastro fiscal declarado com histórico de vigência.
CREATE TABLE business.fiscal_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, establishment_id uuid NOT NULL,
 company_name text NOT NULL, establishment_name text NOT NULL, cnpj text NOT NULL,
 effective_on date NOT NULL, regime text NOT NULL CHECK(length(btrim(regime)) BETWEEN 1 AND 120),
 nature_code text CHECK(nature_code IS NULL OR nature_code ~ '^[0-9]{4}$'),
 cnae text CHECK(cnae IS NULL OR cnae ~ '^[0-9]{7}$'),
 uf text NOT NULL CHECK(uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 municipality_code text NOT NULL CHECK(municipality_code ~ '^[0-9]{7}$'),
 state_registration text CHECK(state_registration IS NULL OR length(btrim(state_registration)) BETWEEN 1 AND 40),
 municipal_registration text CHECK(municipal_registration IS NULL OR length(btrim(municipal_registration)) BETWEEN 1 AND 40),
 address text CHECK(address IS NULL OR length(btrim(address)) BETWEEN 1 AND 500),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,establishment_id,effective_on)
);
ALTER TABLE business.fiscal_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.fiscal_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_profiles_read ON business.fiscal_profiles FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_profiles.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY fiscal_profiles_insert ON business.fiscal_profiles FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_profiles.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.fiscal_profiles FROM PUBLIC;
GRANT SELECT,INSERT ON business.fiscal_profiles TO anna_business_runtime;
CREATE FUNCTION business.create_fiscal_profile(p_company uuid,p_establishment uuid,p_effective date,p_regime text,p_nature text,p_cnae text,p_uf text,p_municipality text,p_ie text,p_im text,p_address text,p_source text,p_op uuid)
RETURNS TABLE(profile_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.fiscal_profiles(tenant_id,company_id,establishment_id,company_name,establishment_name,cnpj,effective_on,regime,nature_code,cnae,uf,municipality_code,state_registration,municipal_registration,address,source_reference,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,e.id,p.legal_name,e.name,e.cnpj,p_effective,btrim(p_regime),NULLIF(btrim(p_nature),''),NULLIF(btrim(p_cnae),''),p_uf,p_municipality,NULLIF(btrim(p_ie),''),NULLIF(btrim(p_im),''),NULLIF(btrim(p_address),''),btrim(p_source),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active' JOIN core.establishments e ON e.tenant_id=c.tenant_id AND e.party_id=c.party_id AND e.status='active'
 JOIN business.tenant_memberships m ON m.tenant_id=c.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND e.id=p_establishment
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'fiscal_profile',id,'create',p_op,jsonb_build_object('establishment_id',p_establishment,'effective_on',p_effective) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_fiscal_profile(uuid,uuid,date,text,text,text,text,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_fiscal_profile(uuid,uuid,date,text,text,text,text,text,text,text,text,text,uuid) TO anna_business_runtime;
