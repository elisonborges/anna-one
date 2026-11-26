-- 056: vínculos explícitos, sem gerar cobranças ou pagamentos.
BEGIN;
CREATE TABLE business.ops_contract_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,order_id uuid NOT NULL,contract_id uuid NOT NULL,
 contract_revision integer NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL))
);
CREATE UNIQUE INDEX ops_contract_one_live ON business.ops_contract_links(tenant_id,order_id) WHERE revoked_at IS NULL;
CREATE TABLE business.ops_finance_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,order_id uuid NOT NULL,cost_id uuid NOT NULL,obligation_id uuid NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 FOREIGN KEY(cost_id) REFERENCES business.ops_costs(id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL))
);
CREATE UNIQUE INDEX ops_finance_one_cost ON business.ops_finance_links(tenant_id,cost_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX ops_finance_one_obligation ON business.ops_finance_links(tenant_id,obligation_id) WHERE revoked_at IS NULL;
ALTER TABLE business.ops_contract_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_contract_links FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_contract_links_read ON business.ops_contract_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_contract_links_insert ON business.ops_contract_links FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY ops_contract_links_revoke ON business.ops_contract_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
REVOKE ALL ON business.ops_contract_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_contract_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.ops_contract_links TO anna_business_runtime;
ALTER TABLE business.ops_finance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_finance_links FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_finance_links_read ON business.ops_finance_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_finance_links_insert ON business.ops_finance_links FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY ops_finance_links_revoke ON business.ops_finance_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
REVOKE ALL ON business.ops_finance_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_finance_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.ops_finance_links TO anna_business_runtime;
CREATE FUNCTION business.ops_link_contract(p_order uuid,p_contract uuid,p_reason text,p_op uuid) RETURNS TABLE(link_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_contract_links(tenant_id,company_id,order_id,contract_id,contract_revision,reason,operation_id,created_by)
 SELECT o.tenant_id,o.company_id,o.id,c.id,c.revision,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_orders o JOIN business.contracts c ON c.tenant_id=o.tenant_id AND c.seller_id=o.company_id AND c.customer_id=o.customer_id WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND c.id=p_contract AND c.status='active' AND c.valid_from<=o.planned_on AND (c.valid_until IS NULL OR c.valid_until>=o.due_on) AND business.ops_order_status(o.id)<>'cancelled' AND business.hr_admin(o.tenant_id) AND business.ops_allowed(o.tenant_id,o.company_id) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_link_finance(p_order uuid,p_cost uuid,p_obligation uuid,p_reason text,p_op uuid) RETURNS TABLE(link_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_finance_links(tenant_id,company_id,order_id,cost_id,obligation_id,amount,reason,operation_id,created_by)
 SELECT o.tenant_id,o.company_id,o.id,c.id,f.id,c.amount,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_orders o JOIN business.ops_costs c ON c.tenant_id=o.tenant_id AND c.company_id=o.company_id AND c.order_id=o.id JOIN business.financial_obligations f ON f.tenant_id=o.tenant_id AND f.company_id=o.company_id AND f.amount=c.amount WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND c.id=p_cost AND f.id=p_obligation AND c.kind='actual' AND c.voided_at IS NULL AND f.direction='payable' AND f.currency='BRL' AND business.hr_admin(o.tenant_id) AND business.ops_allowed(o.tenant_id,o.company_id) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.ops_link_contract(uuid,uuid,text,uuid),business.ops_link_finance(uuid,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.ops_link_contract(uuid,uuid,text,uuid),business.ops_link_finance(uuid,uuid,uuid,text,uuid) TO anna_business_runtime;
COMMIT;
