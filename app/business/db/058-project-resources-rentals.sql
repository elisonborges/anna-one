-- 058: recursos compartilhados, orçamento/custos de projetos e locações administrativas.
BEGIN;
CREATE TABLE business.project_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,item_id uuid NOT NULL,resource_id uuid NOT NULL,start_on date NOT NULL,end_on date NOT NULL CHECK(end_on>=start_on),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id,project_id,item_id) REFERENCES business.project_items(tenant_id,company_id,project_id,id),
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE INDEX project_allocations_scope ON business.project_allocations(tenant_id,resource_id,start_on,end_on);
CREATE TABLE business.project_costs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('planned','actual')),category text NOT NULL CHECK(category IN ('labor','materials','equipment','travel','third_party','other')),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),amount numeric(18,2) NOT NULL CHECK(amount>0),incurred_on date NOT NULL,
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE UNIQUE INDEX project_cost_live ON business.project_costs(tenant_id,project_id,kind,reference) WHERE voided_at IS NULL;
CREATE TABLE business.rentals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,resource_id uuid NOT NULL,customer_id uuid NOT NULL,reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 60),
 start_on date NOT NULL,end_on date NOT NULL CHECK(end_on>=start_on AND end_on-start_on<=365),
 agreed_amount numeric(18,2) NOT NULL CHECK(agreed_amount>=0),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,reference),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX rentals_scope ON business.rentals(tenant_id,resource_id,start_on,end_on);
CREATE TABLE business.rental_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,rental_id uuid NOT NULL,seq integer NOT NULL CHECK(seq BETWEEN 1 AND 3),status text NOT NULL CHECK(status IN ('delivered','returned','cancelled')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,rental_id) REFERENCES business.rentals(tenant_id,company_id,id),
 UNIQUE(tenant_id,rental_id,seq),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.project_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY project_allocations_read ON business.project_allocations FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_allocations_insert ON business.project_allocations FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_allocations FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_allocations TO anna_business_runtime;
ALTER TABLE business.project_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY project_costs_read ON business.project_costs FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_costs_insert ON business.project_costs FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_costs FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_costs TO anna_business_runtime;
ALTER TABLE business.rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.rentals FORCE ROW LEVEL SECURITY;
CREATE POLICY rentals_read ON business.rentals FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY rentals_insert ON business.rentals FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.rentals FROM PUBLIC;
GRANT SELECT,INSERT ON business.rentals TO anna_business_runtime;
ALTER TABLE business.rental_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.rental_events FORCE ROW LEVEL SECURITY;
CREATE POLICY rental_events_read ON business.rental_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY rental_events_insert ON business.rental_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.rental_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.rental_events TO anna_business_runtime;
CREATE POLICY project_allocations_void ON business.project_allocations FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND voided_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.project_allocations TO anna_business_runtime;
CREATE POLICY project_costs_void ON business.project_costs FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND voided_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.project_costs TO anna_business_runtime;
CREATE FUNCTION business.rental_status(p_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT status FROM business.rental_events e WHERE e.tenant_id=r.tenant_id AND e.rental_id=r.id ORDER BY seq DESC LIMIT 1),'reserved') FROM business.rentals r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_id
$fn$;
CREATE FUNCTION business.resource_available(p_tenant uuid,p_company uuid,p_resource uuid,p_start date,p_end date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT business.ops_allowed(p_tenant,p_company) AND NOT EXISTS(SELECT 1 FROM business.ops_allocations a WHERE a.tenant_id=p_tenant AND a.company_id=p_company AND a.resource_id=p_resource AND a.voided_at IS NULL AND a.start_on<=p_end AND a.end_on>=p_start)
 AND NOT EXISTS(SELECT 1 FROM business.project_allocations a WHERE a.tenant_id=p_tenant AND a.company_id=p_company AND a.resource_id=p_resource AND a.voided_at IS NULL AND a.start_on<=p_end AND a.end_on>=p_start)
 AND NOT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=p_tenant AND r.company_id=p_company AND r.resource_id=p_resource AND business.rental_status(r.id)<>'cancelled' AND r.start_on<=p_end AND (r.end_on>=p_start OR business.rental_status(r.id)='delivered' AND r.end_on<(now() AT TIME ZONE 'America/Fortaleza')::date OR COALESCE((SELECT max((e.created_at AT TIME ZONE 'America/Fortaleza')::date) FROM business.rental_events e WHERE e.tenant_id=r.tenant_id AND e.rental_id=r.id AND e.status='returned'),r.end_on)>=p_start))
$fn$;
CREATE OR REPLACE FUNCTION business.ops_allocate(p_task uuid,p_resource uuid,p_start date,p_end date,p_op uuid) RETURNS TABLE(allocation_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_allocations(tenant_id,company_id,resource_id,task_id,start_on,end_on,operation_id,created_by)
 SELECT t.tenant_id,t.company_id,r.id,t.id,p_start,p_end,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_tasks t JOIN business.ops_resources r ON r.tenant_id=t.tenant_id AND r.company_id=t.company_id AND r.id=p_resource WHERE t.tenant_id=current_setting('anna.tenant_id',true)::uuid AND t.id=p_task AND business.ops_order_status(t.order_id) IN ('draft','planned','in_progress') AND business.ops_task_status(t.id) IN ('pending','in_progress') AND p_start>=t.planned_on AND p_end<=t.due_on AND p_end>=p_start AND business.resource_available(t.tenant_id,t.company_id,r.id,p_start,p_end) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.project_allocate(p_item uuid,p_resource uuid,p_start date,p_end date,p_op uuid) RETURNS TABLE(allocation_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.project_allocations(tenant_id,company_id,project_id,item_id,resource_id,start_on,end_on,operation_id,created_by)
 SELECT i.tenant_id,i.company_id,i.project_id,i.id,r.id,p_start,p_end,p_op,current_setting('anna.actor_id',true)::uuid FROM business.project_items i JOIN business.ops_resources r ON r.tenant_id=i.tenant_id AND r.company_id=i.company_id AND r.id=p_resource WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_item AND i.kind<>'phase' AND business.project_status(i.project_id) IN ('draft','active') AND business.project_item_status(i.id) IN ('pending','in_progress') AND p_start>=i.planned_on AND p_end<=i.due_on AND p_end>=p_start AND business.resource_available(i.tenant_id,i.company_id,r.id,p_start,p_end) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.project_add_cost(p_project uuid,p_kind text,p_category text,p_ref text,p_amount numeric,p_date date,p_op uuid) RETURNS TABLE(cost_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.project_costs(tenant_id,company_id,project_id,kind,category,reference,amount,incurred_on,operation_id,created_by)
 SELECT p.tenant_id,p.company_id,p.id,p_kind,p_category,btrim(p_ref),p_amount,p_date,p_op,current_setting('anna.actor_id',true)::uuid FROM business.projects p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_project AND p_amount>0 AND p_amount=round(p_amount,2) AND ((p_kind='planned' AND business.project_status(p.id)='draft' AND p_date BETWEEN p.planned_on AND p.due_on) OR (p_kind='actual' AND business.project_status(p.id) IN ('active','completed','cancelled') AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date)) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.rental_create(p_company uuid,p_resource uuid,p_customer uuid,p_ref text,p_start date,p_end date,p_amount numeric,p_op uuid) RETURNS TABLE(rental_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.rentals(tenant_id,company_id,resource_id,customer_id,reference,start_on,end_on,agreed_amount,operation_id,created_by)
 SELECT r.tenant_id,r.company_id,r.id,p.id,btrim(p_ref),p_start,p_end,p_amount,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_resources r JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=p_customer AND p.status='active' WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.company_id=p_company AND r.id=p_resource AND r.kind='equipment' AND p_end>=p_start AND p_end-p_start<=365 AND p_start>=(now() AT TIME ZONE 'America/Fortaleza')::date AND p_amount>=0 AND p_amount=round(p_amount,2) AND business.resource_available(r.tenant_id,r.company_id,r.id,p_start,p_end) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.rental_change(p_id uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT r.*,business.rental_status(r.id) AS prior,COALESCE((SELECT max(seq) FROM business.rental_events e WHERE e.tenant_id=r.tenant_id AND e.rental_id=r.id),0)+1 AS next_seq FROM business.rentals r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_id),
 added AS (INSERT INTO business.rental_events(tenant_id,company_id,rental_id,seq,status,reason,operation_id,created_by) SELECT c.tenant_id,c.company_id,c.id,c.next_seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE (c.prior='reserved' AND p_status='cancelled') OR (c.prior='reserved' AND p_status='delivered' AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN c.start_on AND c.end_on AND NOT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=c.tenant_id AND r.resource_id=c.resource_id AND r.id<>c.id AND business.rental_status(r.id)='delivered')) OR (c.prior='delivered' AND p_status='returned') ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.rental_status(uuid),business.resource_available(uuid,uuid,uuid,date,date),business.project_allocate(uuid,uuid,date,date,uuid),business.project_add_cost(uuid,text,text,text,numeric,date,uuid),business.rental_create(uuid,uuid,uuid,text,date,date,numeric,uuid),business.rental_change(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.rental_status(uuid),business.resource_available(uuid,uuid,uuid,date,date),business.project_allocate(uuid,uuid,date,date,uuid),business.project_add_cost(uuid,text,text,text,numeric,date,uuid),business.rental_create(uuid,uuid,uuid,text,date,date,numeric,uuid),business.rental_change(uuid,text,text,uuid) TO anna_business_runtime;
COMMIT;
