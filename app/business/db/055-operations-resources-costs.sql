-- 055: recursos, alocação, custos e esforço operacional informado.
BEGIN;
CREATE TABLE business.ops_resources(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),kind text NOT NULL CHECK(kind IN ('team','person','equipment','other')),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),party_id uuid,
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 CHECK((kind='person')=(party_id IS NOT NULL)),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
CREATE UNIQUE INDEX ops_resource_person ON business.ops_resources(tenant_id,company_id,party_id) WHERE party_id IS NOT NULL;
CREATE TABLE business.ops_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,resource_id uuid NOT NULL,task_id uuid NOT NULL,start_on date NOT NULL,end_on date NOT NULL CHECK(end_on>=start_on),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,task_id) REFERENCES business.ops_tasks(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE INDEX ops_allocations_scope ON business.ops_allocations(tenant_id,company_id,resource_id,start_on,end_on);
CREATE TABLE business.ops_costs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,order_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('planned','actual')),
 category text NOT NULL CHECK(category IN ('labor','materials','equipment','travel','third_party','other')),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),amount numeric(18,2) NOT NULL CHECK(amount>0),
 incurred_on date NOT NULL,operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE UNIQUE INDEX ops_cost_reference_live ON business.ops_costs(tenant_id,order_id,kind,reference) WHERE voided_at IS NULL;
CREATE TABLE business.ops_effort(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,task_id uuid NOT NULL,work_on date NOT NULL,minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 525600),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id,task_id) REFERENCES business.ops_tasks(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE UNIQUE INDEX ops_effort_reference_live ON business.ops_effort(tenant_id,task_id,reference) WHERE voided_at IS NULL;
ALTER TABLE business.ops_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_resources_read ON business.ops_resources FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_resources_insert ON business.ops_resources FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_resources FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_resources TO anna_business_runtime;
ALTER TABLE business.ops_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_allocations_read ON business.ops_allocations FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_allocations_insert ON business.ops_allocations FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_allocations FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_allocations TO anna_business_runtime;
ALTER TABLE business.ops_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_costs_read ON business.ops_costs FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_costs_insert ON business.ops_costs FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_costs FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_costs TO anna_business_runtime;
ALTER TABLE business.ops_effort ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_effort FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_effort_read ON business.ops_effort FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_effort_insert ON business.ops_effort FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_effort FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_effort TO anna_business_runtime;
CREATE POLICY ops_allocations_void ON business.ops_allocations FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND voided_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.ops_allocations TO anna_business_runtime;
CREATE POLICY ops_costs_void ON business.ops_costs FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND voided_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.ops_costs TO anna_business_runtime;
CREATE POLICY ops_effort_void ON business.ops_effort FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND voided_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.ops_effort TO anna_business_runtime;
CREATE FUNCTION business.ops_allocate(p_task uuid,p_resource uuid,p_start date,p_end date,p_op uuid) RETURNS TABLE(allocation_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_allocations(tenant_id,company_id,resource_id,task_id,start_on,end_on,operation_id,created_by)
 SELECT t.tenant_id,t.company_id,r.id,t.id,p_start,p_end,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_tasks t JOIN business.ops_resources r ON r.tenant_id=t.tenant_id AND r.company_id=t.company_id AND r.id=p_resource WHERE t.tenant_id=current_setting('anna.tenant_id',true)::uuid AND t.id=p_task AND business.ops_order_status(t.order_id) IN ('draft','planned','in_progress') AND business.ops_task_status(t.id) IN ('pending','in_progress') AND p_start>=t.planned_on AND p_end<=t.due_on AND p_end>=p_start AND NOT EXISTS(SELECT 1 FROM business.ops_allocations a WHERE a.tenant_id=t.tenant_id AND a.resource_id=r.id AND a.voided_at IS NULL AND a.start_on<=p_end AND a.end_on>=p_start) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_add_cost(p_order uuid,p_kind text,p_category text,p_ref text,p_amount numeric,p_date date,p_op uuid) RETURNS TABLE(cost_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_costs(tenant_id,company_id,order_id,kind,category,reference,amount,incurred_on,operation_id,created_by)
 SELECT o.tenant_id,o.company_id,o.id,p_kind,p_category,btrim(p_ref),p_amount,p_date,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_orders o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND p_amount>0 AND p_amount=round(p_amount,2) AND ((p_kind='planned' AND business.ops_order_status(o.id) IN ('draft','planned') AND p_date BETWEEN o.planned_on AND o.due_on) OR (p_kind='actual' AND business.ops_order_status(o.id) IN ('in_progress','completed','cancelled') AND p_date<= (now() AT TIME ZONE 'America/Fortaleza')::date)) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_add_effort(p_task uuid,p_date date,p_minutes integer,p_ref text,p_op uuid) RETURNS TABLE(effort_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_effort(tenant_id,company_id,task_id,work_on,minutes,reference,operation_id,created_by)
 SELECT t.tenant_id,t.company_id,t.id,p_date,p_minutes,btrim(p_ref),p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_tasks t WHERE t.tenant_id=current_setting('anna.tenant_id',true)::uuid AND t.id=p_task AND business.ops_task_status(t.id) IN ('in_progress','completed') AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.ops_allocate(uuid,uuid,date,date,uuid),business.ops_add_cost(uuid,text,text,text,numeric,date,uuid),business.ops_add_effort(uuid,date,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.ops_allocate(uuid,uuid,date,date,uuid),business.ops_add_cost(uuid,text,text,text,numeric,date,uuid),business.ops_add_effort(uuid,date,integer,text,uuid) TO anna_business_runtime;
COMMIT;
