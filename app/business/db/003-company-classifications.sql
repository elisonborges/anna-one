-- 003: classificação comercial e empresas próprias; aditiva.
-- Aplicar após 001, 002 e criação de anna_business_runtime.
GRANT SELECT, INSERT ON business.party_roles TO anna_business_runtime;
GRANT INSERT ON business.companies TO anna_business_runtime;
CREATE POLICY companies_owner_pj_insert ON business.companies AS RESTRICTIVE FOR INSERT WITH CHECK (
 EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=companies.tenant_id AND m.role='owner' AND m.active)
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=companies.tenant_id AND p.id=companies.party_id AND p.kind='PJ' AND p.status='active')
);
CREATE FUNCTION business.add_classification(p_party uuid,p_classification text,p_request uuid)
RETURNS TABLE(classification text,inserted boolean) LANGUAGE sql SECURITY INVOKER AS $$
 WITH eligible AS (
 SELECT id,tenant_id FROM core.parties WHERE id=p_party AND tenant_id=current_setting('anna.tenant_id',true)::uuid AND status='active'
 ), role_added AS (
 INSERT INTO business.party_roles(tenant_id,party_id,role)
 SELECT tenant_id,id,p_classification FROM eligible WHERE p_classification IN ('customer','supplier','partner','service_provider','representative')
 ON CONFLICT (tenant_id,party_id,role) DO NOTHING RETURNING tenant_id,party_id
 ), company_added AS (
 INSERT INTO business.companies(tenant_id,party_id)
 SELECT tenant_id,id FROM eligible WHERE p_classification='own_company'
 ON CONFLICT (tenant_id,party_id) DO NOTHING RETURNING tenant_id,party_id
 ), changed AS (
 SELECT tenant_id,party_id FROM role_added UNION ALL SELECT tenant_id,party_id FROM company_added
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'party',party_id,'link',p_request,jsonb_build_object('classification',p_classification) FROM changed
 )
 SELECT p_classification,EXISTS(SELECT 1 FROM changed) FROM eligible WHERE p_classification IN ('customer','supplier','partner','service_provider','representative','own_company')
$$;
REVOKE ALL ON FUNCTION business.add_classification(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_classification(uuid,text,uuid) TO anna_business_runtime;
