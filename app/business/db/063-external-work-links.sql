-- 063: referências externas conferidas manualmente; sem acesso a bancos externos.
BEGIN;
CREATE TABLE business.external_work_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid,order_id uuid,
 provider text NOT NULL CHECK(provider IN ('nexus','service_desk')),external_scope text NOT NULL CHECK(external_scope ~ '^[A-Za-z0-9._:-]{1,100}$'),
 external_ref text NOT NULL CHECK(external_ref ~ '^[A-Za-z0-9._:-]{1,100}$'),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 CHECK((project_id IS NULL) <> (order_id IS NULL)),
 CHECK((provider='nexus' AND project_id IS NOT NULL AND external_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR (provider='service_desk' AND order_id IS NOT NULL)),
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL)));
CREATE UNIQUE INDEX external_work_ref_active ON business.external_work_links(tenant_id,provider,lower(external_scope),lower(external_ref)) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX external_work_project_active ON business.external_work_links(tenant_id,project_id) WHERE revoked_at IS NULL AND project_id IS NOT NULL;
CREATE UNIQUE INDEX external_work_order_active ON business.external_work_links(tenant_id,order_id) WHERE revoked_at IS NULL AND order_id IS NOT NULL;
ALTER TABLE business.external_work_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.external_work_links FORCE ROW LEVEL SECURITY;
CREATE POLICY external_work_read ON business.external_work_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY external_work_insert ON business.external_work_links FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY external_work_revoke ON business.external_work_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.external_work_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.external_work_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.external_work_links TO anna_business_runtime;
COMMIT;
