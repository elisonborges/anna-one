-- 037: orçamento anual com linhas mensais e revisões imutáveis.
CREATE TABLE business.management_budgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 budget_year integer NOT NULL CHECK(budget_year BETWEEN 2000 AND 2100),
 revision integer NOT NULL CHECK(revision>=1),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 120),
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,company_id,budget_year,revision),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.management_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.management_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY management_budgets_read ON business.management_budgets FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_budgets.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY management_budgets_insert ON business.management_budgets FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_budgets.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.management_budgets FROM PUBLIC;
GRANT SELECT,INSERT ON business.management_budgets TO anna_business_runtime;
CREATE FUNCTION business.create_management_budget(p_company uuid,p_year integer,p_revision integer,p_lines jsonb,p_reason text,p_op uuid)
RETURNS TABLE(budget_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (
 SELECT c.tenant_id,c.party_id,COALESCE((SELECT max(b.revision) FROM business.management_budgets b WHERE b.tenant_id=c.tenant_id AND b.company_id=c.party_id AND b.budget_year=p_year),0) AS previous_revision
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active' WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company
 ), raw AS MATERIALIZED (
 SELECT l->>'category_id' AS category_id,l->>'month' AS month_text,l->>'amount' AS amount_text FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines)='array' THEN p_lines ELSE '[]'::jsonb END) l
 ), resolved AS (
 SELECT d.id AS category_id,d.code AS category_code,d.name AS category_name,d.direction,
 CASE WHEN r.month_text ~ '^([1-9]|1[0-2])$' THEN r.month_text::integer END AS month,
 CASE WHEN r.amount_text ~ '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$' THEN r.amount_text::numeric END AS amount
 FROM target t CROSS JOIN raw r JOIN business.management_dimensions d ON d.tenant_id=t.tenant_id AND d.company_id=t.party_id AND d.id::text=r.category_id AND d.kind='financial_category' AND d.status='active'
 ), valid AS (
 SELECT jsonb_agg(jsonb_build_object('category_id',category_id,'category_code',category_code,'category_name',category_name,'direction',direction,'month',month,'amount',amount::text) ORDER BY month,category_code,category_id) AS lines
 FROM resolved HAVING count(*) BETWEEN 1 AND 120 AND count(*)=(SELECT count(*) FROM raw) AND bool_and(month IS NOT NULL AND amount IS NOT NULL AND amount>=0) AND count(*)=count(DISTINCT (category_id,month))
 ), inserted AS (
 INSERT INTO business.management_budgets(tenant_id,company_id,budget_year,revision,lines,justification,operation_id,created_by)
 SELECT t.tenant_id,t.party_id,p_year,t.previous_revision+1,v.lines,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid
 FROM target t CROSS JOIN valid v WHERE t.previous_revision=p_revision AND p_year BETWEEN 2000 AND 2100 AND length(btrim(p_reason)) BETWEEN 1 AND 500
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,management_budgets.revision,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'management_budget',id,'create',p_op,jsonb_build_object('company_id',p_company,'year',p_year,'revision',inserted.revision) FROM inserted
 ) SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_management_budget(uuid,integer,integer,jsonb,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_management_budget(uuid,integer,integer,jsonb,text,uuid) TO anna_business_runtime;
