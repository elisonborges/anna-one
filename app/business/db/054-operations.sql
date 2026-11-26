-- 054: catálogo, ordens operacionais e atividades, escopo por empresa.
BEGIN;
CREATE TABLE business.ops_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES business.tenant_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL))
);
CREATE UNIQUE INDEX ops_live_grant ON business.ops_grants(tenant_id,company_id,user_id) WHERE revoked_at IS NULL;
ALTER TABLE business.ops_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_grants_read ON business.ops_grants FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND (business.hr_admin(tenant_id) OR user_id::text=current_setting('anna.actor_id',true)));
CREATE POLICY ops_grants_insert ON business.ops_grants FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY ops_grants_revoke ON business.ops_grants FOR UPDATE USING(business.hr_admin(tenant_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
CREATE FUNCTION business.ops_allowed(p_tenant uuid,p_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.ops_grants g JOIN business.tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id JOIN business.tenants t ON t.id=g.tenant_id WHERE g.tenant_id=p_tenant AND g.company_id=p_company AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')
$fn$;
CREATE TABLE business.ops_catalog(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),estimated_minutes integer NOT NULL CHECK(estimated_minutes BETWEEN 1 AND 525600),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz,retired_by uuid REFERENCES public.app_users(id),retire_reason text,retire_op uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,retire_op),
 CHECK((retired_at IS NULL AND retired_by IS NULL AND retire_reason IS NULL AND retire_op IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND retire_reason IS NOT NULL AND length(btrim(retire_reason)) BETWEEN 1 AND 200 AND retire_op IS NOT NULL))
);
CREATE TABLE business.ops_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,service_id uuid NOT NULL,customer_id uuid NOT NULL,
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 60),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 1000),planned_on date NOT NULL,due_on date NOT NULL CHECK(due_on>=planned_on),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,service_id) REFERENCES business.ops_catalog(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,reference),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.ops_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,order_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),planned_on date NOT NULL,due_on date NOT NULL CHECK(due_on>=planned_on),
 estimated_minutes integer NOT NULL CHECK(estimated_minutes BETWEEN 1 AND 525600),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.ops_order_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,order_id uuid NOT NULL,seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN ('planned','in_progress','completed','cancelled')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),UNIQUE(tenant_id,order_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.ops_task_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,task_id uuid NOT NULL,seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN ('in_progress','completed','cancelled')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,task_id) REFERENCES business.ops_tasks(tenant_id,company_id,id),UNIQUE(tenant_id,task_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX ops_orders_scope ON business.ops_orders(tenant_id,company_id,due_on);
CREATE INDEX ops_tasks_scope ON business.ops_tasks(tenant_id,company_id,order_id);
ALTER TABLE business.ops_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_catalog_read ON business.ops_catalog FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_catalog_insert ON business.ops_catalog FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_catalog FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_catalog TO anna_business_runtime;
ALTER TABLE business.ops_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_orders_read ON business.ops_orders FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_orders_insert ON business.ops_orders FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_orders FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_orders TO anna_business_runtime;
ALTER TABLE business.ops_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_tasks_read ON business.ops_tasks FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_tasks_insert ON business.ops_tasks FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_tasks FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_tasks TO anna_business_runtime;
ALTER TABLE business.ops_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_order_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_order_events_read ON business.ops_order_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_order_events_insert ON business.ops_order_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_order_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_order_events TO anna_business_runtime;
ALTER TABLE business.ops_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ops_task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_task_events_read ON business.ops_task_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY ops_task_events_insert ON business.ops_task_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.ops_task_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_task_events TO anna_business_runtime;
CREATE POLICY ops_catalog_retire ON business.ops_catalog FOR UPDATE USING(business.ops_allowed(tenant_id,company_id) AND retired_at IS NULL) WITH CHECK(business.ops_allowed(tenant_id,company_id) AND retired_by::text=current_setting('anna.actor_id',true) AND retired_at IS NOT NULL);
GRANT UPDATE(retired_at,retired_by,retire_reason,retire_op) ON business.ops_catalog TO anna_business_runtime;
REVOKE ALL ON business.ops_grants FROM PUBLIC;
GRANT SELECT,INSERT ON business.ops_grants TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.ops_grants TO anna_business_runtime;
CREATE FUNCTION business.ops_order_status(p_order uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT e.status FROM business.ops_order_events e WHERE e.tenant_id=o.tenant_id AND e.order_id=o.id ORDER BY e.seq DESC LIMIT 1),'draft') FROM business.ops_orders o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order
$fn$;
CREATE FUNCTION business.ops_task_status(p_task uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT e.status FROM business.ops_task_events e WHERE e.tenant_id=t.tenant_id AND e.task_id=t.id ORDER BY e.seq DESC LIMIT 1),'pending') FROM business.ops_tasks t WHERE t.tenant_id=current_setting('anna.tenant_id',true)::uuid AND t.id=p_task
$fn$;
CREATE FUNCTION business.ops_create_order(p_company uuid,p_service uuid,p_customer uuid,p_ref text,p_title text,p_desc text,p_start date,p_due date,p_op uuid) RETURNS TABLE(order_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_orders(tenant_id,company_id,service_id,customer_id,reference,title,description,planned_on,due_on,operation_id,created_by)
 SELECT c.tenant_id,c.company_id,c.id,p.id,btrim(p_ref),btrim(p_title),btrim(p_desc),p_start,p_due,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_catalog c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=p_customer AND p.status='active' WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.company_id=p_company AND c.id=p_service AND c.retired_at IS NULL AND business.ops_allowed(c.tenant_id,c.company_id) AND p_due>=p_start AND p_due-p_start<=365 ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_add_task(p_order uuid,p_title text,p_start date,p_due date,p_minutes integer,p_op uuid) RETURNS TABLE(task_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.ops_tasks(tenant_id,company_id,order_id,title,planned_on,due_on,estimated_minutes,operation_id,created_by)
 SELECT o.tenant_id,o.company_id,o.id,btrim(p_title),p_start,p_due,p_minutes,p_op,current_setting('anna.actor_id',true)::uuid FROM business.ops_orders o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND business.ops_order_status(o.id) IN ('draft','planned','in_progress') AND p_start>=o.planned_on AND p_due<=o.due_on AND p_due>=p_start ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_change_order(p_order uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT o.tenant_id,o.company_id,o.id,COALESCE((SELECT max(seq) FROM business.ops_order_events WHERE tenant_id=o.tenant_id AND order_id=o.id),0)+1 AS seq,business.ops_order_status(o.id) AS prior FROM business.ops_orders o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order),
 added AS (INSERT INTO business.ops_order_events(tenant_id,company_id,order_id,seq,status,reason,operation_id,created_by) SELECT tenant_id,company_id,id,seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE (prior='draft' AND p_status='planned' AND EXISTS(SELECT 1 FROM business.ops_tasks t WHERE t.tenant_id=c.tenant_id AND t.order_id=c.id AND business.ops_task_status(t.id)<>'cancelled')) OR (prior='planned' AND p_status='in_progress') OR (prior IN ('draft','planned','in_progress') AND p_status='cancelled' AND NOT EXISTS(SELECT 1 FROM business.ops_tasks t WHERE t.tenant_id=c.tenant_id AND t.order_id=c.id AND business.ops_task_status(t.id) NOT IN ('cancelled','completed'))) OR (prior='in_progress' AND p_status='completed' AND EXISTS(SELECT 1 FROM business.ops_tasks t WHERE t.tenant_id=c.tenant_id AND t.order_id=c.id AND business.ops_task_status(t.id)='completed') AND NOT EXISTS(SELECT 1 FROM business.ops_tasks t WHERE t.tenant_id=c.tenant_id AND t.order_id=c.id AND business.ops_task_status(t.id) NOT IN ('completed','cancelled'))) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.ops_change_task(p_task uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT t.tenant_id,t.company_id,t.id,COALESCE((SELECT max(seq) FROM business.ops_task_events WHERE tenant_id=t.tenant_id AND task_id=t.id),0)+1 AS seq,business.ops_task_status(t.id) AS prior,business.ops_order_status(t.order_id) AS parent FROM business.ops_tasks t WHERE t.tenant_id=current_setting('anna.tenant_id',true)::uuid AND t.id=p_task),
 added AS (INSERT INTO business.ops_task_events(tenant_id,company_id,task_id,seq,status,reason,operation_id,created_by) SELECT tenant_id,company_id,id,seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate WHERE (parent='in_progress' AND ((prior='pending' AND p_status='in_progress') OR (prior='in_progress' AND p_status='completed'))) OR (parent IN ('draft','planned','in_progress') AND prior IN ('pending','in_progress') AND p_status='cancelled') ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.ops_allowed(uuid,uuid),business.ops_order_status(uuid),business.ops_task_status(uuid),business.ops_create_order(uuid,uuid,uuid,text,text,text,date,date,uuid),business.ops_add_task(uuid,text,date,date,integer,uuid),business.ops_change_order(uuid,text,text,uuid),business.ops_change_task(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.ops_allowed(uuid,uuid),business.ops_order_status(uuid),business.ops_task_status(uuid),business.ops_create_order(uuid,uuid,uuid,text,text,text,date,date,uuid),business.ops_add_task(uuid,text,date,date,integer,uuid),business.ops_change_order(uuid,text,text,uuid),business.ops_change_task(uuid,text,text,uuid) TO anna_business_runtime;
COMMIT;
