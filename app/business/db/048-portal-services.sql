-- 048: acompanhamento externo explícito de serviços e solicitações.
BEGIN;
CREATE FUNCTION business.service_portal_owner(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=p_tenant AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')
$$;
CREATE FUNCTION business.service_portal_customer(p_tenant uuid,p_grant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND current_setting('anna.portal_read',true)='yes' AND EXISTS(SELECT 1 FROM business.portal_grants g JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE g.tenant_id=p_tenant AND g.id=p_grant AND g.user_id::text=current_setting('anna.actor_id',true) AND g.portal_role='customer' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until)
$$;
REVOKE ALL ON FUNCTION business.service_portal_owner(uuid),business.service_portal_customer(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.service_portal_owner(uuid),business.service_portal_customer(uuid,uuid) TO anna_business_runtime;
CREATE TABLE business.portal_service_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,grant_id uuid NOT NULL,contract_id uuid,
 contract_reference text,origin text NOT NULL CHECK(origin IN ('customer','owner')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 1500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES business.portal_grants(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,operation_id),
 CHECK((contract_id IS NULL AND contract_reference IS NULL) OR (origin='owner' AND contract_id IS NOT NULL AND contract_reference IS NOT NULL AND length(btrim(contract_reference)) BETWEEN 1 AND 200))
);
CREATE TABLE business.portal_service_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,case_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN ('accepted','in_progress','waiting_customer','completed','cancelled')),
 message text NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 1500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,case_id) REFERENCES business.portal_service_cases(tenant_id,id),
 UNIQUE(tenant_id,case_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX portal_service_cases_grant ON business.portal_service_cases(tenant_id,grant_id,created_at DESC);
ALTER TABLE business.portal_service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.portal_service_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE business.portal_service_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.portal_service_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY service_cases_read ON business.portal_service_cases FOR SELECT USING(business.service_portal_owner(tenant_id) OR business.service_portal_customer(tenant_id,grant_id));
CREATE POLICY service_cases_insert ON business.portal_service_cases FOR INSERT WITH CHECK(
 tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND
 ((origin='customer' AND contract_id IS NULL AND business.service_portal_customer(tenant_id,grant_id))
 OR (origin='owner' AND business.service_portal_owner(tenant_id) AND EXISTS(
 SELECT 1 FROM business.portal_grants g WHERE g.tenant_id=portal_service_cases.tenant_id AND g.id=portal_service_cases.grant_id AND g.portal_role='customer' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until
 AND (portal_service_cases.contract_id IS NULL OR EXISTS(SELECT 1 FROM business.contracts c WHERE c.tenant_id=g.tenant_id AND c.id=portal_service_cases.contract_id AND c.seller_id=g.company_id AND c.customer_id=g.party_id AND portal_service_cases.contract_reference='Contrato #'||c.code::text))))));
CREATE POLICY service_updates_read ON business.portal_service_updates FOR SELECT USING(
 tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.portal_service_cases c WHERE c.tenant_id=portal_service_updates.tenant_id AND c.id=portal_service_updates.case_id));
CREATE POLICY service_updates_insert ON business.portal_service_updates FOR INSERT WITH CHECK(
 business.service_portal_owner(tenant_id) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.portal_service_cases c WHERE c.tenant_id=portal_service_updates.tenant_id AND c.id=portal_service_updates.case_id));
REVOKE ALL ON business.portal_service_cases,business.portal_service_updates FROM PUBLIC;
GRANT SELECT,INSERT ON business.portal_service_cases,business.portal_service_updates TO anna_business_runtime;
CREATE FUNCTION business.create_portal_service_case(p_grant uuid,p_contract uuid,p_title text,p_description text,p_op uuid,p_origin text) RETURNS TABLE(case_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.portal_service_cases(tenant_id,grant_id,contract_id,contract_reference,origin,title,description,operation_id,created_by)
 SELECT g.tenant_id,g.id,p_contract,CASE WHEN p_contract IS NOT NULL THEN 'Contrato #'||c.code::text END,p_origin,btrim(p_title),btrim(p_description),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.portal_grants g LEFT JOIN business.contracts c ON c.tenant_id=g.tenant_id AND c.id=p_contract AND c.seller_id=g.company_id AND c.customer_id=g.party_id
 WHERE g.tenant_id=current_setting('anna.tenant_id',true)::uuid AND g.id=p_grant AND g.portal_role='customer' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until
 AND ((p_origin='customer' AND p_contract IS NULL AND business.service_portal_customer(g.tenant_id,g.id)) OR (p_origin='owner' AND business.service_portal_owner(g.tenant_id) AND (p_contract IS NULL OR c.id IS NOT NULL)))
 ON CONFLICT DO NOTHING RETURNING id)
 SELECT id FROM inserted
$$;
CREATE FUNCTION business.add_portal_service_update(p_case uuid,p_status text,p_message text,p_op uuid) RETURNS TABLE(update_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH candidate AS (
 SELECT c.tenant_id,c.id,COALESCE(u.seq,0)+1 AS next_seq,COALESCE(u.status,'requested') AS prior
 FROM business.portal_service_cases c LEFT JOIN LATERAL (SELECT seq,status FROM business.portal_service_updates x WHERE x.tenant_id=c.tenant_id AND x.case_id=c.id ORDER BY seq DESC LIMIT 1) u ON true
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.id=p_case AND business.service_portal_owner(c.tenant_id)),
 inserted AS (INSERT INTO business.portal_service_updates(tenant_id,case_id,seq,status,message,operation_id,created_by)
 SELECT tenant_id,id,next_seq,p_status,btrim(p_message),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate
 WHERE (prior='requested' AND p_status IN ('accepted','cancelled')) OR (prior='accepted' AND p_status IN ('in_progress','cancelled')) OR (prior='in_progress' AND p_status IN ('waiting_customer','completed','cancelled')) OR (prior='waiting_customer' AND p_status IN ('in_progress','cancelled'))
 ON CONFLICT DO NOTHING RETURNING id)
 SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_portal_service_case(uuid,uuid,text,text,uuid,text),business.add_portal_service_update(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_portal_service_case(uuid,uuid,text,text,uuid,text),business.add_portal_service_update(uuid,text,text,uuid) TO anna_business_runtime;
COMMIT;
