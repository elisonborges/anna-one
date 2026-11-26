-- 051: departamento pessoal administrativo. Sem dados clínicos ou cálculo de folha.
BEGIN;
CREATE TABLE business.dp_profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,relationship_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000), effective_on date NOT NULL,
 work_model text NOT NULL CHECK(work_model IN ('onsite','hybrid','remote','other')),
 weekly_minutes integer CHECK(weekly_minutes BETWEEN 0 AND 10080),
 schedule_label text NOT NULL CHECK(length(btrim(schedule_label)) BETWEEN 1 AND 120),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,relationship_id) REFERENCES business.hr_relationships(tenant_id,company_id,id),
 UNIQUE(tenant_id,relationship_id,revision),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.dp_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,relationship_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('benefit','equipment')),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),start_on date NOT NULL,
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 closed_on date,closed_by uuid REFERENCES public.app_users(id),closed_at timestamptz,close_reason text,close_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id,relationship_id) REFERENCES business.hr_relationships(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,close_operation_id),
 CHECK((closed_on IS NULL AND closed_by IS NULL AND closed_at IS NULL AND close_reason IS NULL AND close_operation_id IS NULL) OR (closed_on IS NOT NULL AND closed_on>=start_on AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND close_reason IS NOT NULL AND length(btrim(close_reason)) BETWEEN 1 AND 200 AND close_operation_id IS NOT NULL))
);
CREATE UNIQUE INDEX dp_assignment_live ON business.dp_assignments(tenant_id,relationship_id,kind,reference) WHERE closed_on IS NULL;
CREATE TABLE business.dp_absences(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,relationship_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('vacation','administrative_leave')),start_on date NOT NULL,end_on date NOT NULL CHECK(end_on>=start_on AND end_on-start_on<=366),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 resolved_on date,resolved_by uuid REFERENCES public.app_users(id),resolved_at timestamptz,resolution text,resolution_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id,relationship_id) REFERENCES business.hr_relationships(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,resolution_operation_id),
 CHECK((resolved_on IS NULL AND resolved_by IS NULL AND resolved_at IS NULL AND resolution IS NULL AND resolution_operation_id IS NULL) OR (resolved_on IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution IS NOT NULL AND resolution IN ('completed','cancelled') AND resolution_operation_id IS NOT NULL))
);
CREATE INDEX dp_absence_scope ON business.dp_absences(tenant_id,relationship_id,start_on,end_on);
ALTER TABLE business.dp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.dp_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY dp_profiles_read ON business.dp_profiles FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY dp_profiles_insert ON business.dp_profiles FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.dp_profiles FROM PUBLIC;
GRANT SELECT,INSERT ON business.dp_profiles TO anna_business_runtime;
ALTER TABLE business.dp_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.dp_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY dp_assignments_read ON business.dp_assignments FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY dp_assignments_insert ON business.dp_assignments FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.dp_assignments FROM PUBLIC;
GRANT SELECT,INSERT ON business.dp_assignments TO anna_business_runtime;
ALTER TABLE business.dp_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.dp_absences FORCE ROW LEVEL SECURITY;
CREATE POLICY dp_absences_read ON business.dp_absences FOR SELECT USING(business.hr_allowed(tenant_id,company_id));
CREATE POLICY dp_absences_insert ON business.dp_absences FOR INSERT WITH CHECK(business.hr_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.dp_absences FROM PUBLIC;
GRANT SELECT,INSERT ON business.dp_absences TO anna_business_runtime;
CREATE POLICY dp_assignments_close ON business.dp_assignments FOR UPDATE USING(business.hr_allowed(tenant_id,company_id) AND closed_on IS NULL) WITH CHECK(business.hr_allowed(tenant_id,company_id) AND closed_by::text=current_setting('anna.actor_id',true) AND closed_on IS NOT NULL);
CREATE POLICY dp_absences_resolve ON business.dp_absences FOR UPDATE USING(business.hr_allowed(tenant_id,company_id) AND resolved_on IS NULL) WITH CHECK(business.hr_allowed(tenant_id,company_id) AND resolved_by::text=current_setting('anna.actor_id',true) AND resolved_on IS NOT NULL);
GRANT UPDATE(closed_on,closed_by,closed_at,close_reason,close_operation_id) ON business.dp_assignments TO anna_business_runtime;
GRANT UPDATE(resolved_on,resolved_by,resolved_at,resolution,resolution_operation_id) ON business.dp_absences TO anna_business_runtime;
CREATE FUNCTION business.dp_active(p_tenant uuid,p_relationship uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT EXISTS(SELECT 1 FROM business.hr_relationships r WHERE r.tenant_id=p_tenant AND r.id=p_relationship AND r.start_on<=p_date AND business.hr_allowed(r.tenant_id,r.company_id) AND NOT EXISTS(SELECT 1 FROM business.hr_movements m WHERE m.tenant_id=r.tenant_id AND m.relationship_id=r.id AND m.kind='end'))
$fn$;
CREATE FUNCTION business.dp_add_profile(p_relationship uuid,p_date date,p_model text,p_minutes integer,p_schedule text,p_reference text,p_op uuid) RETURNS TABLE(profile_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT r.tenant_id,r.company_id,r.id,COALESCE(x.revision,0)+1 AS revision,COALESCE(x.effective_on,r.start_on) AS last_date FROM business.hr_relationships r LEFT JOIN LATERAL(SELECT revision,effective_on FROM business.dp_profiles p WHERE p.tenant_id=r.tenant_id AND p.relationship_id=r.id ORDER BY revision DESC LIMIT 1)x ON true WHERE r.id=p_relationship AND r.tenant_id=current_setting('anna.tenant_id',true)::uuid),
 inserted AS (INSERT INTO business.dp_profiles(tenant_id,company_id,relationship_id,revision,effective_on,work_model,weekly_minutes,schedule_label,reference,operation_id,created_by) SELECT tenant_id,company_id,id,revision,p_date,p_model,p_minutes,btrim(p_schedule),btrim(p_reference),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate WHERE business.dp_active(tenant_id,id,p_date) AND p_date>=last_date AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted
$fn$;
CREATE FUNCTION business.dp_add_assignment(p_relationship uuid,p_kind text,p_label text,p_reference text,p_date date,p_op uuid) RETURNS TABLE(assignment_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH inserted AS (INSERT INTO business.dp_assignments(tenant_id,company_id,relationship_id,kind,label,reference,start_on,operation_id,created_by) SELECT r.tenant_id,r.company_id,r.id,p_kind,btrim(p_label),btrim(p_reference),p_date,p_op,current_setting('anna.actor_id',true)::uuid FROM business.hr_relationships r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_relationship AND business.dp_active(r.tenant_id,r.id,p_date) AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted
$fn$;
CREATE FUNCTION business.dp_close_assignment(p_id uuid,p_date date,p_reason text,p_op uuid) RETURNS TABLE(assignment_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH changed AS (UPDATE business.dp_assignments SET closed_on=p_date,closed_at=now(),closed_by=current_setting('anna.actor_id',true)::uuid,close_reason=btrim(p_reason),close_operation_id=p_op WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND closed_on IS NULL AND p_date>=start_on AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date RETURNING id) SELECT id FROM changed
$fn$;
CREATE FUNCTION business.dp_add_absence(p_relationship uuid,p_kind text,p_start date,p_end date,p_reference text,p_op uuid) RETURNS TABLE(absence_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH inserted AS (INSERT INTO business.dp_absences(tenant_id,company_id,relationship_id,kind,start_on,end_on,reference,operation_id,created_by) SELECT r.tenant_id,r.company_id,r.id,p_kind,p_start,p_end,btrim(p_reference),p_op,current_setting('anna.actor_id',true)::uuid FROM business.hr_relationships r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_relationship AND business.dp_active(r.tenant_id,r.id,p_start) AND p_end>=p_start AND p_end-p_start<=366 AND NOT EXISTS(SELECT 1 FROM business.dp_absences a WHERE a.tenant_id=r.tenant_id AND a.relationship_id=r.id AND a.resolution IS DISTINCT FROM 'cancelled' AND a.start_on<=p_end AND a.end_on>=p_start) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted
$fn$;
CREATE FUNCTION business.dp_resolve_absence(p_id uuid,p_resolution text,p_op uuid) RETURNS TABLE(absence_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH changed AS (UPDATE business.dp_absences SET resolved_on=(now() AT TIME ZONE 'America/Fortaleza')::date,resolved_at=now(),resolved_by=current_setting('anna.actor_id',true)::uuid,resolution=p_resolution,resolution_operation_id=p_op WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND resolved_on IS NULL AND (p_resolution='cancelled' OR (p_resolution='completed' AND end_on<=(now() AT TIME ZONE 'America/Fortaleza')::date)) RETURNING id) SELECT id FROM changed
$fn$;
REVOKE ALL ON FUNCTION business.dp_active(uuid,uuid,date),business.dp_add_profile(uuid,date,text,integer,text,text,uuid),business.dp_add_assignment(uuid,text,text,text,date,uuid),business.dp_close_assignment(uuid,date,text,uuid),business.dp_add_absence(uuid,text,date,date,text,uuid),business.dp_resolve_absence(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.dp_active(uuid,uuid,date),business.dp_add_profile(uuid,date,text,integer,text,text,uuid),business.dp_add_assignment(uuid,text,text,text,date,uuid),business.dp_close_assignment(uuid,date,text,uuid),business.dp_add_absence(uuid,text,date,date,text,uuid),business.dp_resolve_absence(uuid,text,uuid) TO anna_business_runtime;
COMMIT;
