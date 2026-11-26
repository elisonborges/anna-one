-- 035: dimensões gerenciais por empresa, sem escrituração contábil.
CREATE TABLE business.management_dimensions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('financial_category','cost_center','profit_center')),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 direction text CHECK(direction IN ('receivable','payable')),
 accounting_reference text CHECK(accounting_reference IS NULL OR length(btrim(accounting_reference)) BETWEEN 1 AND 100),
 notes text CHECK(notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 deactivated_by uuid REFERENCES public.app_users(id),deactivated_at timestamptz,deactivation_reason text,deactivation_operation uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,company_id,kind,code),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,deactivation_operation),
 CHECK((kind='financial_category' AND direction IS NOT NULL) OR (kind<>'financial_category' AND direction IS NULL AND accounting_reference IS NULL)),
 CHECK((status='active' AND deactivated_by IS NULL AND deactivated_at IS NULL AND deactivation_reason IS NULL AND deactivation_operation IS NULL) OR (status='inactive' AND deactivated_by IS NOT NULL AND deactivated_at IS NOT NULL AND deactivation_operation IS NOT NULL AND deactivation_reason IS NOT NULL AND length(btrim(deactivation_reason)) BETWEEN 1 AND 500))
);
ALTER TABLE business.management_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.management_dimensions FORCE ROW LEVEL SECURITY;
CREATE POLICY management_dimensions_read ON business.management_dimensions FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_dimensions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY management_dimensions_insert ON business.management_dimensions FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND status='active' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_dimensions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY management_dimensions_deactivate ON business.management_dimensions FOR UPDATE USING(tenant_id::text=current_setting('anna.tenant_id',true) AND status='active' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_dimensions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND status='inactive' AND deactivated_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_dimensions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.management_dimensions FROM PUBLIC;
GRANT SELECT,INSERT ON business.management_dimensions TO anna_business_runtime;
GRANT UPDATE(status,deactivated_by,deactivated_at,deactivation_reason,deactivation_operation) ON business.management_dimensions TO anna_business_runtime;
CREATE FUNCTION business.create_management_dimension(p_company uuid,p_kind text,p_code text,p_name text,p_direction text,p_account text,p_notes text,p_op uuid)
RETURNS TABLE(dimension_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.management_dimensions(tenant_id,company_id,kind,code,name,direction,accounting_reference,notes,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,p_kind,upper(btrim(p_code)),btrim(p_name),NULLIF(btrim(p_direction),''),NULLIF(btrim(p_account),''),NULLIF(btrim(p_notes),''),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'management_dimension',id,'create',p_op,jsonb_build_object('kind',p_kind,'company_id',p_company) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.deactivate_management_dimension(p_id uuid,p_reason text,p_op uuid)
RETURNS TABLE(dimension_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.management_dimensions d SET status='inactive',deactivated_by=current_setting('anna.actor_id',true)::uuid,deactivated_at=now(),deactivation_reason=btrim(p_reason),deactivation_operation=p_op
 WHERE d.tenant_id=current_setting('anna.tenant_id',true)::uuid AND d.id=p_id AND d.status='active' AND length(btrim(p_reason)) BETWEEN 1 AND 500
 RETURNING d.id,d.tenant_id,d.deactivated_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,deactivated_by,'management_dimension',id,'update',p_op,jsonb_build_object('status','inactive') FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_management_dimension(uuid,text,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.deactivate_management_dimension(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_management_dimension(uuid,text,text,text,text,text,text,uuid) TO anna_business_runtime;
GRANT EXECUTE ON FUNCTION business.deactivate_management_dimension(uuid,text,uuid) TO anna_business_runtime;
