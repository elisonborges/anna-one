-- 044: habilitação individual de portal, sem filiação ao ambiente interno.
CREATE TABLE business.portal_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,party_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES public.app_users(id),portal_role text NOT NULL CHECK(portal_role IN ('customer','accountant')),
 valid_from date NOT NULL,valid_until date NOT NULL CHECK(valid_until>=valid_from AND valid_until-valid_from<=366),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revocation_reason text,revocation_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revocation_operation_id),
 CHECK(company_id<>party_id),CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND revocation_operation_id IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(revocation_reason)) BETWEEN 1 AND 500 AND revocation_operation_id IS NOT NULL))
);
CREATE UNIQUE INDEX portal_grants_one_live ON business.portal_grants(tenant_id,company_id,party_id,user_id,portal_role) WHERE revoked_at IS NULL;
ALTER TABLE business.portal_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.portal_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_grants_read ON business.portal_grants FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND (EXISTS(SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=portal_grants.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner') OR (user_id::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN valid_from AND valid_until)));
CREATE POLICY portal_grants_insert ON business.portal_grants FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=portal_grants.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner') AND EXISTS(SELECT 1 FROM business.tenants t WHERE t.id=portal_grants.tenant_id AND t.kind='internal' AND t.status='active'));
CREATE POLICY portal_grants_revoke ON business.portal_grants FOR UPDATE USING(tenant_id::text=current_setting('anna.tenant_id',true) AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=portal_grants.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner')) WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=portal_grants.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner') AND EXISTS(SELECT 1 FROM business.tenants t WHERE t.id=portal_grants.tenant_id AND t.kind='internal' AND t.status='active'));
-- A única leitura adicional em tenants é o próprio tenant ativo do portal, sem criar membership.
CREATE POLICY tenant_portal_read ON business.tenants FOR SELECT USING(id::text=current_setting('anna.tenant_id',true) AND kind='internal' AND status='active' AND EXISTS(SELECT 1 FROM business.portal_grants g WHERE g.tenant_id=tenants.id AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until));
REVOKE ALL ON business.portal_grants FROM PUBLIC;
GRANT SELECT,INSERT ON business.portal_grants TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revocation_reason,revocation_operation_id) ON business.portal_grants TO anna_business_runtime;
CREATE FUNCTION business.create_portal_grant(p_company uuid,p_party uuid,p_user uuid,p_role text,p_from date,p_until date,p_reason text,p_op uuid)
RETURNS TABLE(grant_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.portal_grants(tenant_id,company_id,party_id,user_id,portal_role,valid_from,valid_until,reason,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,p_party,p_user,p_role,p_from,p_until,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties co ON co.tenant_id=c.tenant_id AND co.id=c.party_id AND co.status='active' JOIN core.parties pa ON pa.tenant_id=c.tenant_id AND pa.id=p_party AND pa.status='active'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND p_party<>p_company AND p_user<>current_setting('anna.actor_id',true)::uuid
 AND p_from>=(now() AT TIME ZONE 'America/Fortaleza')::date AND p_until BETWEEN p_from AND p_from+366 AND p_role IN ('customer','accountant')
 AND EXISTS(SELECT 1 FROM business.party_roles r WHERE r.tenant_id=c.tenant_id AND r.party_id=p_party AND r.active AND ((p_role='customer' AND r.role='customer') OR (p_role='accountant' AND r.role IN ('service_provider','partner'))))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'portal_grant',id,'create',p_op,jsonb_build_object('company_id',p_company,'party_id',p_party,'portal_role',p_role,'valid_until',p_until) FROM inserted)
 SELECT id FROM inserted
$$;
CREATE FUNCTION business.revoke_portal_grant(p_grant uuid,p_reason text,p_op uuid) RETURNS TABLE(grant_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (UPDATE business.portal_grants g SET revoked_at=now(),revoked_by=current_setting('anna.actor_id',true)::uuid,revocation_reason=btrim(p_reason),revocation_operation_id=p_op WHERE g.tenant_id=current_setting('anna.tenant_id',true)::uuid AND g.id=p_grant AND g.revoked_at IS NULL RETURNING g.id,g.tenant_id,g.revoked_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,revoked_by,'portal_grant',id,'update',p_op,jsonb_build_object('status','revoked') FROM changed)
 SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_portal_grant(uuid,uuid,uuid,text,date,date,text,uuid),business.revoke_portal_grant(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_portal_grant(uuid,uuid,uuid,text,date,date,text,uuid),business.revoke_portal_grant(uuid,text,uuid) TO anna_business_runtime;
