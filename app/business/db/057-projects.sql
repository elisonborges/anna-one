-- 057: projetos empresariais, entregáveis e dependências; expansão da geração 3.
BEGIN;
CREATE TABLE business.projects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 1000),
 planned_on date NOT NULL,due_on date NOT NULL CHECK(due_on>=planned_on AND due_on-planned_on<=1095),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.project_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,
 phase_id uuid,kind text NOT NULL CHECK(kind IN ('phase','task','deliverable','milestone')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),planned_on date NOT NULL,due_on date NOT NULL CHECK(due_on>=planned_on),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,project_id,id),
 FOREIGN KEY(tenant_id,company_id,project_id,phase_id) REFERENCES business.project_items(tenant_id,company_id,project_id,id),
 CHECK((kind='phase' AND phase_id IS NULL) OR (kind<>'phase' AND phase_id IS NOT NULL)),
 CHECK(kind<>'milestone' OR planned_on=due_on),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.project_dependencies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,
 predecessor_id uuid NOT NULL,successor_id uuid NOT NULL CHECK(predecessor_id<>successor_id),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,project_id,predecessor_id) REFERENCES business.project_items(tenant_id,company_id,project_id,id),
 FOREIGN KEY(tenant_id,company_id,project_id,successor_id) REFERENCES business.project_items(tenant_id,company_id,project_id,id),
 UNIQUE(tenant_id,project_id,predecessor_id,successor_id),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.project_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),status text NOT NULL CHECK(status IN ('active','completed','cancelled')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),
 UNIQUE(tenant_id,project_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.project_item_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,item_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 1000),status text NOT NULL CHECK(status IN ('in_progress','completed','cancelled')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,project_id,item_id) REFERENCES business.project_items(tenant_id,company_id,project_id,id),
 UNIQUE(tenant_id,item_id,seq),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX project_items_scope ON business.project_items(tenant_id,project_id,phase_id);
CREATE INDEX project_deps_successor ON business.project_dependencies(tenant_id,project_id,successor_id);
ALTER TABLE business.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_read ON business.projects FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY projects_insert ON business.projects FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.projects FROM PUBLIC;
GRANT SELECT,INSERT ON business.projects TO anna_business_runtime;
ALTER TABLE business.project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_items FORCE ROW LEVEL SECURITY;
CREATE POLICY project_items_read ON business.project_items FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_items_insert ON business.project_items FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_items FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_items TO anna_business_runtime;
ALTER TABLE business.project_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY project_dependencies_read ON business.project_dependencies FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_dependencies_insert ON business.project_dependencies FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_dependencies FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_dependencies TO anna_business_runtime;
ALTER TABLE business.project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_events FORCE ROW LEVEL SECURITY;
CREATE POLICY project_events_read ON business.project_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_events_insert ON business.project_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_events TO anna_business_runtime;
ALTER TABLE business.project_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_item_events FORCE ROW LEVEL SECURITY;
CREATE POLICY project_item_events_read ON business.project_item_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_item_events_insert ON business.project_item_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_item_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_item_events TO anna_business_runtime;
CREATE FUNCTION business.project_status(p_project uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT status FROM business.project_events e WHERE e.tenant_id=p.tenant_id AND e.project_id=p.id ORDER BY seq DESC LIMIT 1),'draft') FROM business.projects p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_project
$fn$;
CREATE FUNCTION business.project_item_status(p_item uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT status FROM business.project_item_events e WHERE e.tenant_id=i.tenant_id AND e.item_id=i.id ORDER BY seq DESC LIMIT 1),'pending') FROM business.project_items i WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_item
$fn$;
CREATE FUNCTION business.project_add_item(p_project uuid,p_phase uuid,p_kind text,p_title text,p_start date,p_due date,p_op uuid) RETURNS TABLE(item_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.project_items(tenant_id,company_id,project_id,phase_id,kind,title,planned_on,due_on,operation_id,created_by)
 SELECT p.tenant_id,p.company_id,p.id,p_phase,p_kind,btrim(p_title),p_start,p_due,p_op,current_setting('anna.actor_id',true)::uuid FROM business.projects p
 WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_project AND business.project_status(p.id)='draft' AND p_start>=p.planned_on AND p_due<=p.due_on AND p_due>=p_start AND ((p_kind='phase' AND p_phase IS NULL) OR (p_kind IN ('task','deliverable','milestone') AND EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.id=p_phase AND i.kind='phase' AND business.project_item_status(i.id)='pending' AND p_start>=i.planned_on AND p_due<=i.due_on))) AND (p_kind<>'milestone' OR p_start=p_due) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.project_add_dependency(p_project uuid,p_before uuid,p_after uuid,p_op uuid) RETURNS TABLE(dependency_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.project_dependencies(tenant_id,company_id,project_id,predecessor_id,successor_id,operation_id,created_by)
 SELECT a.tenant_id,a.company_id,a.project_id,a.id,b.id,p_op,current_setting('anna.actor_id',true)::uuid FROM business.project_items a JOIN business.project_items b ON b.tenant_id=a.tenant_id AND b.project_id=a.project_id WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.project_id=p_project AND a.id=p_before AND b.id=p_after AND a.kind<>'phase' AND b.kind<>'phase' AND a.due_on<b.planned_on AND business.project_status(a.project_id)='draft' AND business.project_item_status(a.id)='pending' AND business.project_item_status(b.id)='pending' ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.project_change(p_project uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT p.*,business.project_status(p.id) AS prior,COALESCE((SELECT max(seq) FROM business.project_events e WHERE e.tenant_id=p.tenant_id AND e.project_id=p.id),0)+1 AS next_seq FROM business.projects p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_project),
 added AS (INSERT INTO business.project_events(tenant_id,company_id,project_id,seq,status,reason,operation_id,created_by)
 SELECT c.tenant_id,c.company_id,c.id,c.next_seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE
 (c.prior='draft' AND p_status='active' AND EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.project_id=c.id AND i.kind<>'phase' AND business.project_item_status(i.id)='pending') AND NOT EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.project_id=c.id AND i.kind='phase' AND business.project_item_status(i.id)='pending' AND NOT EXISTS(SELECT 1 FROM business.project_items k WHERE k.tenant_id=i.tenant_id AND k.phase_id=i.id AND business.project_item_status(k.id)='pending')))
 OR (c.prior='active' AND p_status='completed' AND EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.project_id=c.id AND i.kind<>'phase' AND business.project_item_status(i.id)='completed') AND NOT EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.project_id=c.id AND business.project_item_status(i.id) NOT IN ('completed','cancelled')))
 OR (c.prior IN ('draft','active') AND p_status='cancelled' AND NOT EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.project_id=c.id AND business.project_item_status(i.id) NOT IN ('completed','cancelled'))) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.project_change_item(p_item uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT i.*,business.project_item_status(i.id) AS prior,business.project_status(i.project_id) AS parent,COALESCE((SELECT max(seq) FROM business.project_item_events e WHERE e.tenant_id=i.tenant_id AND e.item_id=i.id),0)+1 AS next_seq FROM business.project_items i WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_item),
 added AS (INSERT INTO business.project_item_events(tenant_id,company_id,project_id,item_id,seq,status,reason,operation_id,created_by)
 SELECT c.tenant_id,c.company_id,c.project_id,c.id,c.next_seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE
 (c.parent='active' AND c.prior='pending' AND p_status='in_progress' AND (c.kind='phase' OR business.project_item_status(c.phase_id)='in_progress') AND NOT EXISTS(SELECT 1 FROM business.project_dependencies d WHERE d.tenant_id=c.tenant_id AND d.successor_id=c.id AND business.project_item_status(d.predecessor_id)<>'completed'))
 OR (c.parent='active' AND c.prior='in_progress' AND p_status='completed' AND (c.kind<>'phase' OR (EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.phase_id=c.id AND business.project_item_status(i.id)='completed') AND NOT EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.phase_id=c.id AND business.project_item_status(i.id) NOT IN ('completed','cancelled')))))
 OR (c.parent IN ('draft','active') AND c.prior IN ('pending','in_progress') AND p_status='cancelled' AND NOT EXISTS(SELECT 1 FROM business.project_items i WHERE i.tenant_id=c.tenant_id AND i.phase_id=c.id AND business.project_item_status(i.id) NOT IN ('completed','cancelled')) AND NOT EXISTS(SELECT 1 FROM business.project_dependencies d WHERE d.tenant_id=c.tenant_id AND d.predecessor_id=c.id AND business.project_item_status(d.successor_id) NOT IN ('completed','cancelled'))) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.project_status(uuid),business.project_item_status(uuid),business.project_add_item(uuid,uuid,text,text,date,date,uuid),business.project_add_dependency(uuid,uuid,uuid,uuid),business.project_change(uuid,text,text,uuid),business.project_change_item(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.project_status(uuid),business.project_item_status(uuid),business.project_add_item(uuid,uuid,text,text,date,date,uuid),business.project_add_dependency(uuid,uuid,uuid,uuid),business.project_change(uuid,text,text,uuid),business.project_change_item(uuid,text,text,uuid) TO anna_business_runtime;
COMMIT;
