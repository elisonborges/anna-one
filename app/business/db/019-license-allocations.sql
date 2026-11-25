-- 019: distribuição comercial de capacidade, sem permissões operacionais.
CREATE TABLE business.license_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 right_id uuid NOT NULL,
 beneficiary_kind text NOT NULL CHECK(beneficiary_kind IN ('institution','establishment','person','device','external_unit')),
 institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT,
 establishment_id uuid,
 establishment_party_id uuid,
 person_id uuid,
 beneficiary_ref text CHECK(beneficiary_ref IS NULL OR length(btrim(beneficiary_ref)) BETWEEN 1 AND 200),
 beneficiary_key text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),
 authorization_ref text NOT NULL CHECK(length(btrim(authorization_ref)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'allocated' CHECK(status IN ('allocated','released')),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 released_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
 released_at timestamptz,
 release_reason text CHECK(release_reason IS NULL OR length(btrim(release_reason)) BETWEEN 1 AND 300),
 FOREIGN KEY(tenant_id,right_id) REFERENCES business.license_rights(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,establishment_id,establishment_party_id) REFERENCES core.establishments(tenant_id,id,party_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,person_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 CHECK((beneficiary_kind='institution' AND institution_id IS NOT NULL AND establishment_id IS NULL AND establishment_party_id IS NULL AND person_id IS NULL AND beneficiary_ref IS NULL) OR (beneficiary_kind='establishment' AND institution_id IS NULL AND establishment_id IS NOT NULL AND establishment_party_id IS NOT NULL AND person_id IS NULL AND beneficiary_ref IS NULL) OR (beneficiary_kind='person' AND institution_id IS NULL AND establishment_id IS NULL AND establishment_party_id IS NULL AND person_id IS NOT NULL AND beneficiary_ref IS NULL AND quantity=1) OR (beneficiary_kind IN ('device','external_unit') AND institution_id IS NULL AND establishment_id IS NULL AND establishment_party_id IS NULL AND person_id IS NULL AND beneficiary_ref IS NOT NULL AND (beneficiary_kind<>'device' OR quantity=1))),
 CHECK((status='allocated' AND released_by IS NULL AND released_at IS NULL AND release_reason IS NULL) OR (status='released' AND released_by IS NOT NULL AND released_at IS NOT NULL AND release_reason IS NOT NULL))
);
CREATE UNIQUE INDEX license_allocations_active_target ON business.license_allocations(tenant_id,right_id,beneficiary_key) WHERE status='allocated';
CREATE INDEX license_allocations_right ON business.license_allocations(tenant_id,right_id,status);
ALTER TABLE business.license_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.license_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY license_allocations_read ON business.license_allocations FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY license_allocations_insert ON business.license_allocations FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true)) AND created_by::text=current_setting('anna.actor_id',true) AND status='allocated');
CREATE POLICY license_allocations_update ON business.license_allocations FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true))) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_allocations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true)));
REVOKE ALL ON business.license_allocations FROM PUBLIC;
GRANT SELECT,INSERT ON business.license_allocations TO anna_business_runtime;
GRANT UPDATE(status,released_by,released_at,release_reason) ON business.license_allocations TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.license_allocations_code_seq TO anna_business_runtime;
-- API obrigatoriamente executa a alocação em SERIALIZABLE.
CREATE FUNCTION business.allocate_license(p_right uuid,p_kind text,p_target uuid,p_ref text,p_quantity integer,p_authorization text,p_scope uuid[],p_request uuid)
RETURNS TABLE(allocation_id uuid,allocation_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 eligible AS MATERIALIZED (
 SELECT r.tenant_id,r.id,r.commercial_unit,r.capacity,c.customer_id,clock.today
 FROM business.license_rights r JOIN business.contracts c ON c.tenant_id=r.tenant_id AND c.id=r.contract_id CROSS JOIN clock
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_right AND r.status='registered' AND c.status='active' AND r.capacity IS NOT NULL
 AND r.valid_from<=clock.today AND c.valid_from<=clock.today AND (LEAST(r.valid_until,c.valid_until) IS NULL OR LEAST(r.valid_until,c.valid_until)>=clock.today)
 AND p_quantity>0 AND p_quantity<=r.capacity
 AND p_quantity+COALESCE((SELECT sum(a.quantity) FROM business.license_allocations a WHERE a.tenant_id=r.tenant_id AND a.right_id=r.id AND a.status='allocated'),0)<=r.capacity
 AND length(btrim(p_authorization)) BETWEEN 1 AND 200
 AND ((p_kind IN ('institution','establishment') AND (r.commercial_unit<>'institution' OR p_quantity=1)) OR (p_kind='person' AND r.commercial_unit='seat' AND p_quantity=1) OR (p_kind='device' AND r.commercial_unit='device' AND p_quantity=1) OR (p_kind='external_unit' AND r.commercial_unit='unit'))
 ), inserted AS (
 INSERT INTO business.license_allocations(tenant_id,right_id,beneficiary_kind,institution_id,establishment_id,establishment_party_id,person_id,beneficiary_ref,beneficiary_key,quantity,authorization_ref,created_by)
 SELECT e.tenant_id,e.id,p_kind,CASE WHEN p_kind='institution' THEN p_target END,CASE WHEN p_kind='establishment' THEN p_target END,CASE WHEN p_kind='establishment' THEN e.customer_id END,CASE WHEN p_kind='person' THEN p_target END,CASE WHEN p_kind IN ('device','external_unit') THEN btrim(p_ref) END,p_kind||':'||COALESCE(p_target::text,lower(btrim(p_ref))),p_quantity,btrim(p_authorization),current_setting('anna.actor_id',true)::uuid
 FROM eligible e WHERE
 (p_kind='institution' AND p_ref IS NULL AND p_target=ANY(p_scope) AND EXISTS (SELECT 1 FROM core.institution_links l WHERE l.tenant_id=e.tenant_id AND l.institution_id=p_target AND l.party_id=e.customer_id AND l.valid_from<=e.today AND (l.valid_until IS NULL OR l.valid_until>e.today)))
 OR (p_kind='establishment' AND p_ref IS NULL AND EXISTS (SELECT 1 FROM core.establishments s WHERE s.tenant_id=e.tenant_id AND s.id=p_target AND s.party_id=e.customer_id AND s.status='active'))
 OR (p_kind='person' AND p_ref IS NULL AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=e.tenant_id AND p.id=p_target AND p.kind='PF' AND p.status='active'))
 OR (p_kind IN ('device','external_unit') AND p_target IS NULL AND length(btrim(p_ref)) BETWEEN 1 AND 200)
 ON CONFLICT(tenant_id,right_id,beneficiary_key) WHERE status='allocated' DO NOTHING
 RETURNING id,code,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'license_allocation',id,'create',p_request,jsonb_build_object('right_id',p_right,'kind',p_kind,'quantity',p_quantity) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.release_license_allocation(p_id uuid,p_reason text,p_scope uuid[],p_request uuid)
RETURNS TABLE(allocation_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.license_allocations SET status='released',released_by=current_setting('anna.actor_id',true)::uuid,released_at=now(),release_reason=btrim(p_reason)
 WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND status='allocated' AND length(btrim(p_reason)) BETWEEN 1 AND 300 AND (institution_id IS NULL OR institution_id=ANY(p_scope))
 RETURNING id,tenant_id,released_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,released_by,'license_allocation',id,'deactivate',p_request,jsonb_build_object('reason',btrim(p_reason)) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.allocate_license(uuid,text,uuid,text,integer,text,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.allocate_license(uuid,text,uuid,text,integer,text,uuid[],uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.release_license_allocation(uuid,text,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.release_license_allocation(uuid,text,uuid[],uuid) TO anna_business_runtime;
