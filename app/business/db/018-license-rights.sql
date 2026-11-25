-- 018: direitos comerciais, sem permissões de acesso.
ALTER TABLE business.proposal_lines ADD CONSTRAINT proposal_lines_tenant_id_id_key UNIQUE(tenant_id,id);
CREATE TABLE business.license_rights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 contract_id uuid NOT NULL,
 proposal_line_id uuid NOT NULL,
 item_id uuid NOT NULL,
 item_name text NOT NULL,
 commercial_unit text NOT NULL CHECK(commercial_unit IN ('unit','seat','device','institution','month','year')),
 commercial_quantity numeric(9,3) NOT NULL CHECK(commercial_quantity>0),
 capacity integer CHECK(capacity>0),
 module_id uuid REFERENCES public.modules(id) ON DELETE RESTRICT,
 module_code text,
 scope_label text CHECK(scope_label IS NULL OR length(btrim(scope_label)) BETWEEN 1 AND 200),
 valid_from date NOT NULL,
 valid_until date,
 instrument_ref text NOT NULL CHECK(length(btrim(instrument_ref)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','revoked')),
 revoked_at timestamptz,
 revoked_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
 revocation_reason text CHECK(revocation_reason IS NULL OR length(btrim(revocation_reason)) BETWEEN 1 AND 300),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,proposal_line_id) REFERENCES business.proposal_lines(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,item_id) REFERENCES business.catalog_items(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,contract_id,proposal_line_id),
 UNIQUE(tenant_id,id),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 CHECK((module_id IS NULL)=(module_code IS NULL)),
 CHECK(module_id IS NOT NULL OR scope_label IS NOT NULL),
 CHECK((commercial_unit IN ('seat','device','institution','unit') AND capacity IS NOT NULL AND capacity=trunc(commercial_quantity) AND commercial_quantity=trunc(commercial_quantity)) OR (commercial_unit IN ('month','year') AND capacity IS NULL)),
 CHECK((status='registered' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL))
);
ALTER TABLE business.license_rights ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.license_rights FORCE ROW LEVEL SECURITY;
CREATE POLICY license_rights_read ON business.license_rights FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY license_rights_insert ON business.license_rights FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true)) AND created_by::text=current_setting('anna.actor_id',true) AND status='registered');
CREATE POLICY license_rights_update ON business.license_rights FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true))) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=license_rights.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true)));
REVOKE ALL ON business.license_rights FROM PUBLIC;
GRANT SELECT,INSERT ON business.license_rights TO anna_business_runtime;
GRANT UPDATE(status,revoked_at,revoked_by,revocation_reason) ON business.license_rights TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.license_rights_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_license_right(p_contract uuid,p_line uuid,p_module uuid,p_module_code text,p_scope text,p_from date,p_until date,p_reference text,p_request uuid)
RETURNS TABLE(right_id uuid,right_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 inserted AS (
 INSERT INTO business.license_rights(tenant_id,contract_id,proposal_line_id,item_id,item_name,commercial_unit,commercial_quantity,capacity,module_id,module_code,scope_label,valid_from,valid_until,instrument_ref,created_by)
 SELECT c.tenant_id,c.id,l.id,l.item_id,l.item_name,l.unit,l.quantity,CASE WHEN l.unit IN ('seat','device','institution','unit') THEN l.quantity::integer END,p_module,p_module_code,NULLIF(btrim(p_scope),''),p_from,p_until,btrim(p_reference),current_setting('anna.actor_id',true)::uuid
 FROM business.contracts c JOIN business.commercial_orders o ON o.tenant_id=c.tenant_id AND o.id=c.order_id JOIN business.proposal_lines l ON l.tenant_id=o.tenant_id AND l.proposal_id=o.proposal_id AND l.id=p_line JOIN business.catalog_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id CROSS JOIN clock
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.id=p_contract AND c.status='active' AND c.signed_on IS NOT NULL AND c.valid_from<=clock.today AND (c.valid_until IS NULL OR c.valid_until>=clock.today) AND c.contract_kind IN ('license','mixed') AND i.kind='license'
 AND p_from>=GREATEST(c.valid_from,clock.today) AND (c.valid_until IS NULL OR p_from<=c.valid_until) AND (p_until IS NULL OR (p_until>=p_from AND (c.valid_until IS NULL OR p_until<=c.valid_until)))
 AND ((l.unit IN ('month','year') AND p_until IS NOT NULL) OR (l.unit IN ('seat','device','institution','unit') AND l.quantity=trunc(l.quantity)))
 AND length(btrim(p_reference)) BETWEEN 1 AND 200 AND ((p_module IS NOT NULL AND length(btrim(p_module_code)) BETWEEN 1 AND 100) OR (p_module IS NULL AND p_module_code IS NULL AND length(btrim(p_scope)) BETWEEN 1 AND 200))
 ON CONFLICT(tenant_id,contract_id,proposal_line_id) DO NOTHING
 RETURNING id,code,tenant_id,created_by,capacity
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'license_right',id,'create',p_request,jsonb_build_object('contract_id',p_contract,'proposal_line_id',p_line,'capacity',capacity,'module_id',p_module) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.revoke_license_right(p_id uuid,p_reason text,p_request uuid)
RETURNS TABLE(right_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.license_rights SET status='revoked',revoked_at=now(),revoked_by=current_setting('anna.actor_id',true)::uuid,revocation_reason=btrim(p_reason)
 WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND status='registered' AND length(btrim(p_reason)) BETWEEN 1 AND 300
 RETURNING id,tenant_id,revoked_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,revoked_by,'license_right',id,'deactivate',p_request,jsonb_build_object('reason',btrim(p_reason)) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_license_right(uuid,uuid,uuid,text,text,date,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_license_right(uuid,uuid,uuid,text,text,date,date,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.revoke_license_right(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.revoke_license_right(uuid,text,uuid) TO anna_business_runtime;
