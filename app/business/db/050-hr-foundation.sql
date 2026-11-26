-- 050: RH administrativo, sem folha, saúde ou dados de remuneração.
BEGIN;
CREATE FUNCTION business.hr_admin(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=p_tenant AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')
$fn$;
CREATE TABLE business.hr_access_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revocation_reason text,revocation_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES business.tenant_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revocation_operation_id),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND revocation_operation_id IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(revocation_reason)) BETWEEN 1 AND 300 AND revocation_operation_id IS NOT NULL))
);
CREATE UNIQUE INDEX hr_one_live_grant ON business.hr_access_grants(tenant_id,company_id,user_id) WHERE revoked_at IS NULL;
ALTER TABLE business.hr_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.hr_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY hr_grants_read ON business.hr_access_grants FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND (business.hr_admin(tenant_id) OR user_id::text=current_setting('anna.actor_id',true)));
CREATE POLICY hr_grants_insert ON business.hr_access_grants FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY hr_grants_revoke ON business.hr_access_grants FOR UPDATE USING(business.hr_admin(tenant_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true));
CREATE FUNCTION business.hr_allowed(p_tenant uuid,p_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.hr_access_grants g JOIN business.tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id JOIN business.tenants t ON t.id=g.tenant_id WHERE g.tenant_id=p_tenant AND g.company_id=p_company AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')
$fn$;
CREATE TABLE business.hr_positions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 department text NOT NULL CHECK(length(btrim(department)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.hr_relationships(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,party_id uuid NOT NULL,position_id uuid NOT NULL,
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 60),
 kind text NOT NULL CHECK(kind IN ('clt','intern','apprentice','self_employed','pj','partner','outsourced','representative','volunteer')),
 start_on date NOT NULL,operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,position_id) REFERENCES business.hr_positions(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,reference),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.hr_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,relationship_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 kind text NOT NULL CHECK(kind IN ('position','end')),position_id uuid,effective_on date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,relationship_id) REFERENCES business.hr_relationships(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,position_id) REFERENCES business.hr_positions(tenant_id,company_id,id),
 CHECK((kind='position' AND position_id IS NOT NULL) OR (kind='end' AND position_id IS NULL)),
 UNIQUE(tenant_id,relationship_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX hr_relationships_scope ON business.hr_relationships(tenant_id,company_id,start_on);
ALTER TABLE business.hr_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.hr_positions FORCE ROW LEVEL SECURITY;
ALTER TABLE business.hr_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.hr_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE business.hr_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.hr_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY hr_positions_read ON business.hr_positions FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY hr_positions_insert ON business.hr_positions FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY hr_relationships_read ON business.hr_relationships FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY hr_relationships_insert ON business.hr_relationships FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND start_on<=(now() AT TIME ZONE 'America/Fortaleza')::date AND EXISTS(SELECT 1 FROM core.parties p WHERE p.tenant_id=hr_relationships.tenant_id AND p.id=hr_relationships.party_id AND p.status='active' AND ((hr_relationships.kind='pj' AND p.kind='PJ') OR (hr_relationships.kind IN ('clt','intern','apprentice','self_employed','volunteer') AND p.kind='PF') OR hr_relationships.kind IN ('partner','outsourced','representative'))));
CREATE POLICY hr_movements_read ON business.hr_movements FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY hr_movements_insert ON business.hr_movements FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
CREATE FUNCTION business.add_hr_movement(p_relationship uuid,p_kind text,p_position uuid,p_date date,p_reason text,p_op uuid) RETURNS TABLE(movement_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT r.tenant_id,r.company_id,r.id,COALESCE(m.seq,0)+1 AS seq,COALESCE(m.effective_on,r.start_on) AS last_on,m.kind AS last_kind,COALESCE(m.position_id,r.position_id) AS last_position FROM business.hr_relationships r LEFT JOIN LATERAL(SELECT x.seq,x.effective_on,x.kind,x.position_id FROM business.hr_movements x WHERE x.tenant_id=r.tenant_id AND x.relationship_id=r.id ORDER BY x.seq DESC LIMIT 1)m ON true WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_relationship),
 inserted AS (INSERT INTO business.hr_movements(tenant_id,company_id,relationship_id,seq,kind,position_id,effective_on,reason,operation_id,created_by)
 SELECT tenant_id,company_id,id,seq,p_kind,p_position,p_date,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate WHERE last_kind IS DISTINCT FROM 'end' AND p_date>=last_on AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND ((p_kind='end' AND p_position IS NULL) OR (p_kind='position' AND p_position IS NOT NULL AND p_position<>last_position)) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted
$fn$;
REVOKE ALL ON FUNCTION business.hr_admin(uuid),business.hr_allowed(uuid,uuid),business.add_hr_movement(uuid,text,uuid,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.hr_admin(uuid),business.hr_allowed(uuid,uuid),business.add_hr_movement(uuid,text,uuid,date,text,uuid) TO anna_business_runtime;
REVOKE ALL ON business.hr_access_grants,business.hr_positions,business.hr_relationships,business.hr_movements FROM PUBLIC;
GRANT SELECT,INSERT ON business.hr_access_grants,business.hr_positions,business.hr_relationships,business.hr_movements TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revocation_reason,revocation_operation_id) ON business.hr_access_grants TO anna_business_runtime;
COMMIT;
