-- 036: apropriação gerencial versionada de obrigações, sem alterar o financeiro.
CREATE TABLE business.management_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,obligation_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),competence_on date NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0),lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 30),
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,obligation_id,revision),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.management_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.management_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY management_allocations_read ON business.management_allocations FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_allocations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY management_allocations_insert ON business.management_allocations FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_allocations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.management_allocations FROM PUBLIC;
GRANT SELECT,INSERT ON business.management_allocations TO anna_business_runtime;
CREATE FUNCTION business.create_management_allocation(p_obligation uuid,p_revision integer,p_competence date,p_lines jsonb,p_reason text,p_op uuid)
RETURNS TABLE(allocation_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (
 SELECT o.*,COALESCE((SELECT max(a.revision) FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id),0) AS previous_revision
 FROM business.financial_obligations o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_obligation
 ), raw AS MATERIALIZED (
 SELECT ord,l->>'category_id' AS category_id,l->>'cost_center_id' AS cost_id,l->>'profit_center_id' AS profit_id,l->>'amount' AS amount_text
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines)='array' THEN p_lines ELSE '[]'::jsonb END) WITH ORDINALITY AS j(l,ord)
 ), resolved AS (
 SELECT r.ord,c.id AS category_id,c.code AS category_code,c.name AS category_name,cc.id AS cost_center_id,cc.code AS cost_code,cc.name AS cost_name,pc.id AS profit_center_id,pc.code AS profit_code,pc.name AS profit_name,
 CASE WHEN r.amount_text ~ '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$' THEN r.amount_text::numeric END AS amount
 FROM target o CROSS JOIN raw r JOIN business.management_dimensions c ON c.id::text=r.category_id AND c.tenant_id=o.tenant_id AND c.company_id=o.company_id AND c.kind='financial_category' AND c.direction=o.direction AND c.status='active'
 LEFT JOIN business.management_dimensions cc ON cc.id::text=r.cost_id AND cc.tenant_id=o.tenant_id AND cc.company_id=o.company_id AND cc.kind='cost_center' AND cc.status='active'
 LEFT JOIN business.management_dimensions pc ON pc.id::text=r.profit_id AND pc.tenant_id=o.tenant_id AND pc.company_id=o.company_id AND pc.kind='profit_center' AND pc.status='active'
 WHERE (NULLIF(r.cost_id,'') IS NULL OR cc.id IS NOT NULL) AND (NULLIF(r.profit_id,'') IS NULL OR pc.id IS NOT NULL)
 ), valid AS (
 SELECT jsonb_agg(jsonb_build_object('category_id',category_id,'category_code',category_code,'category_name',category_name,'cost_center_id',cost_center_id,'cost_code',cost_code,'cost_name',cost_name,'profit_center_id',profit_center_id,'profit_code',profit_code,'profit_name',profit_name,'amount',amount::text) ORDER BY ord) AS lines,sum(amount) AS total,count(*) AS n
 FROM resolved HAVING count(*) BETWEEN 1 AND 30 AND count(*)=(SELECT count(*) FROM raw) AND bool_and(amount IS NOT NULL AND amount>0) AND count(*)=count(DISTINCT (category_id,cost_center_id,profit_center_id))
 ), inserted AS (
 INSERT INTO business.management_allocations(tenant_id,obligation_id,revision,competence_on,amount,lines,justification,operation_id,created_by)
 SELECT o.tenant_id,o.id,o.previous_revision+1,p_competence,o.amount,v.lines,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid
 FROM target o CROSS JOIN valid v WHERE o.previous_revision=p_revision AND v.total=o.amount AND p_competence IS NOT NULL AND length(btrim(p_reason)) BETWEEN 1 AND 500
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,management_allocations.revision,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'management_allocation',id,'create',p_op,jsonb_build_object('obligation_id',p_obligation,'revision',inserted.revision,'competence_on',p_competence) FROM inserted
 ) SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_management_allocation(uuid,integer,date,jsonb,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_management_allocation(uuid,integer,date,jsonb,text,uuid) TO anna_business_runtime;
