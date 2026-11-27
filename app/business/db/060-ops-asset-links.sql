-- 060: integração administrativa de patrimônio e recursos.
BEGIN;
CREATE TABLE business.ops_asset_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,resource_id uuid NOT NULL,asset_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,asset_id,company_id) REFERENCES business.assets(tenant_id,id,company_id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_operation_id),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_operation_id IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 300 AND revoke_operation_id IS NOT NULL)));
CREATE UNIQUE INDEX ops_asset_resource_active ON business.ops_asset_links(tenant_id,company_id,resource_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX ops_asset_asset_active ON business.ops_asset_links(tenant_id,company_id,asset_id) WHERE revoked_at IS NULL;
ALTER TABLE business.ops_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_asset_links FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_asset_read ON business.ops_asset_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_asset_insert ON business.ops_asset_links FOR INSERT WITH CHECK(
 business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM business.ops_resources r WHERE r.tenant_id=ops_asset_links.tenant_id AND r.company_id=ops_asset_links.company_id AND r.id=ops_asset_links.resource_id AND r.kind='equipment')
 AND EXISTS(SELECT 1 FROM business.assets a WHERE a.tenant_id=ops_asset_links.tenant_id AND a.company_id=ops_asset_links.company_id AND a.id=ops_asset_links.asset_id AND a.ownership='owned'
 AND COALESCE((SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1),'active') IN ('active','maintenance_finish')));
CREATE POLICY ops_asset_revoke ON business.ops_asset_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL)
 WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_asset_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_asset_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_operation_id) ON business.ops_asset_links TO anna_business_runtime;
COMMIT;
