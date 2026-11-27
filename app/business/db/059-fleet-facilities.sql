-- 059: frotas, logística, instalações, manutenção e vínculos operacionais.
BEGIN;
CREATE TABLE business.fleet_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,resource_id uuid NOT NULL,vehicle_ref text NOT NULL CHECK(length(btrim(vehicle_ref)) BETWEEN 1 AND 60),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,resource_id),UNIQUE(tenant_id,company_id,vehicle_ref),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.facility_sites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
 location_ref text NOT NULL CHECK(length(btrim(location_ref)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.field_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('trip','maintenance')),reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 60),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),details text NOT NULL CHECK(length(btrim(details)) BETWEEN 1 AND 500),
 resource_id uuid,vehicle_id uuid,site_id uuid,project_id uuid,order_id uuid,
 start_on date NOT NULL,end_on date NOT NULL CHECK(end_on>=start_on AND end_on-start_on<=365),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,vehicle_id) REFERENCES business.fleet_vehicles(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,site_id) REFERENCES business.facility_sites(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,order_id) REFERENCES business.ops_orders(tenant_id,company_id,id),
 CHECK((kind='trip' AND vehicle_id IS NOT NULL AND resource_id IS NOT NULL AND site_id IS NULL) OR (kind='maintenance' AND vehicle_id IS NULL AND (site_id IS NOT NULL OR resource_id IS NOT NULL))),
 CHECK(project_id IS NULL OR order_id IS NULL),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,reference),UNIQUE(tenant_id,operation_id)
);
CREATE INDEX field_jobs_resource ON business.field_jobs(tenant_id,company_id,resource_id,start_on,end_on);
CREATE TABLE business.field_job_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,job_id uuid NOT NULL,seq integer NOT NULL CHECK(seq BETWEEN 1 AND 2),
 status text NOT NULL CHECK(status IN ('in_progress','completed','cancelled')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,company_id,job_id) REFERENCES business.field_jobs(tenant_id,company_id,id),
 UNIQUE(tenant_id,job_id,seq),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.fleet_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.fleet_vehicles FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_vehicles_read ON business.fleet_vehicles FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY fleet_vehicles_insert ON business.fleet_vehicles FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.fleet_vehicles FROM PUBLIC;
GRANT SELECT,INSERT ON business.fleet_vehicles TO anna_business_runtime;
ALTER TABLE business.facility_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.facility_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_sites_read ON business.facility_sites FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY facility_sites_insert ON business.facility_sites FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.facility_sites FROM PUBLIC;
GRANT SELECT,INSERT ON business.facility_sites TO anna_business_runtime;
ALTER TABLE business.field_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.field_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY field_jobs_read ON business.field_jobs FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY field_jobs_insert ON business.field_jobs FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.field_jobs FROM PUBLIC;
GRANT SELECT,INSERT ON business.field_jobs TO anna_business_runtime;
ALTER TABLE business.field_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.field_job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY field_job_events_read ON business.field_job_events FOR SELECT USING(business.ops_allowed(tenant_id,company_id));
CREATE POLICY field_job_events_insert ON business.field_job_events FOR INSERT WITH CHECK(business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.field_job_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.field_job_events TO anna_business_runtime;
CREATE FUNCTION business.field_job_status(p_job uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT COALESCE((SELECT e.status FROM business.field_job_events e WHERE e.tenant_id=j.tenant_id AND e.job_id=j.id ORDER BY e.seq DESC LIMIT 1),'planned') FROM business.field_jobs j WHERE j.tenant_id=current_setting('anna.tenant_id',true)::uuid AND j.id=p_job
$fn$;
CREATE OR REPLACE FUNCTION business.resource_available(p_tenant uuid,p_company uuid,p_resource uuid,p_start date,p_end date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT business.ops_allowed(p_tenant,p_company) AND NOT EXISTS(SELECT 1 FROM business.ops_allocations a WHERE a.tenant_id=p_tenant AND a.company_id=p_company AND a.resource_id=p_resource AND a.voided_at IS NULL AND a.start_on<=p_end AND a.end_on>=p_start)
 AND NOT EXISTS(SELECT 1 FROM business.project_allocations a WHERE a.tenant_id=p_tenant AND a.company_id=p_company AND a.resource_id=p_resource AND a.voided_at IS NULL AND a.start_on<=p_end AND a.end_on>=p_start)
 AND NOT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=p_tenant AND r.company_id=p_company AND r.resource_id=p_resource AND business.rental_status(r.id)<>'cancelled' AND r.start_on<=p_end AND (r.end_on>=p_start OR business.rental_status(r.id)='delivered' AND r.end_on<(now() AT TIME ZONE 'America/Fortaleza')::date OR COALESCE((SELECT max((e.created_at AT TIME ZONE 'America/Fortaleza')::date) FROM business.rental_events e WHERE e.tenant_id=r.tenant_id AND e.rental_id=r.id AND e.status='returned'),r.end_on)>=p_start))
 AND NOT EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=p_tenant AND j.company_id=p_company AND j.resource_id=p_resource AND business.field_job_status(j.id)<>'cancelled' AND j.start_on<=p_end AND (j.end_on>=p_start OR (business.field_job_status(j.id)='in_progress' AND j.end_on<(now() AT TIME ZONE 'America/Fortaleza')::date) OR COALESCE((SELECT max((e.created_at AT TIME ZONE 'America/Fortaleza')::date) FROM business.field_job_events e WHERE e.tenant_id=j.tenant_id AND e.job_id=j.id AND e.status='completed'),j.end_on)>=p_start))
$fn$;
CREATE OR REPLACE FUNCTION business.rental_change(p_id uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT r.*,business.rental_status(r.id) AS prior,COALESCE((SELECT max(seq) FROM business.rental_events e WHERE e.tenant_id=r.tenant_id AND e.rental_id=r.id),0)+1 AS next_seq FROM business.rentals r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_id),
 added AS (INSERT INTO business.rental_events(tenant_id,company_id,rental_id,seq,status,reason,operation_id,created_by) SELECT c.tenant_id,c.company_id,c.id,c.next_seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE (c.prior='reserved' AND p_status='cancelled') OR (c.prior='reserved' AND p_status='delivered' AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN c.start_on AND c.end_on AND NOT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=c.tenant_id AND r.resource_id=c.resource_id AND r.id<>c.id AND business.rental_status(r.id)='delivered') AND NOT EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=c.tenant_id AND j.resource_id=c.resource_id AND business.field_job_status(j.id)='in_progress')) OR (c.prior='delivered' AND p_status='returned') ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.field_create_job(p_company uuid,p_kind text,p_ref text,p_title text,p_details text,p_vehicle uuid,p_site uuid,p_resource uuid,p_project uuid,p_order uuid,p_start date,p_end date,p_op uuid) RETURNS TABLE(job_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT c.tenant_id,c.party_id AS company_id,CASE WHEN p_kind='trip' THEN v.resource_id ELSE r.id END AS resource_id,v.id AS vehicle_id,s.id AS site_id
 FROM business.companies c LEFT JOIN business.fleet_vehicles v ON v.tenant_id=c.tenant_id AND v.company_id=c.party_id AND v.id=p_vehicle LEFT JOIN business.facility_sites s ON s.tenant_id=c.tenant_id AND s.company_id=c.party_id AND s.id=p_site LEFT JOIN business.ops_resources r ON r.tenant_id=c.tenant_id AND r.company_id=c.party_id AND r.id=p_resource AND r.kind='equipment'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND business.ops_allowed(c.tenant_id,c.party_id) AND p_start>=(now() AT TIME ZONE 'America/Fortaleza')::date AND p_end>=p_start AND p_end-p_start<=365
 AND ((p_kind='trip' AND v.id IS NOT NULL AND p_site IS NULL AND p_resource IS NULL) OR (p_kind='maintenance' AND p_vehicle IS NULL AND (s.id IS NOT NULL OR r.id IS NOT NULL) AND (p_site IS NULL OR s.id IS NOT NULL) AND (p_resource IS NULL OR r.id IS NOT NULL)))
 AND (p_project IS NULL OR (p_order IS NULL AND EXISTS(SELECT 1 FROM business.projects p WHERE p.tenant_id=c.tenant_id AND p.company_id=c.party_id AND p.id=p_project AND business.project_status(p.id) IN ('draft','active') AND p_start>=p.planned_on AND p_end<=p.due_on)))
 AND (p_order IS NULL OR EXISTS(SELECT 1 FROM business.ops_orders o WHERE o.tenant_id=c.tenant_id AND o.company_id=c.party_id AND o.id=p_order AND business.ops_order_status(o.id) IN ('draft','planned','in_progress') AND p_start>=o.planned_on AND p_end<=o.due_on))),
 added AS (INSERT INTO business.field_jobs(tenant_id,company_id,kind,reference,title,details,resource_id,vehicle_id,site_id,project_id,order_id,start_on,end_on,operation_id,created_by)
 SELECT tenant_id,company_id,p_kind,btrim(p_ref),btrim(p_title),btrim(p_details),resource_id,vehicle_id,site_id,p_project,p_order,p_start,p_end,p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE c.resource_id IS NULL OR business.resource_available(c.tenant_id,c.company_id,c.resource_id,p_start,p_end) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.field_change_job(p_job uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT j.*,business.field_job_status(j.id) AS prior,COALESCE((SELECT max(seq) FROM business.field_job_events e WHERE e.tenant_id=j.tenant_id AND e.job_id=j.id),0)+1 AS next_seq FROM business.field_jobs j WHERE j.tenant_id=current_setting('anna.tenant_id',true)::uuid AND j.id=p_job),
 added AS (INSERT INTO business.field_job_events(tenant_id,company_id,job_id,seq,status,reason,operation_id,created_by)
 SELECT c.tenant_id,c.company_id,c.id,c.next_seq,p_status,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM candidate c WHERE
 (c.prior='planned' AND p_status='cancelled') OR (c.prior='in_progress' AND p_status='completed') OR
 (c.prior='planned' AND p_status='in_progress' AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN c.start_on AND c.end_on AND (c.project_id IS NULL OR business.project_status(c.project_id)='active') AND (c.order_id IS NULL OR business.ops_order_status(c.order_id)='in_progress') AND (c.resource_id IS NULL OR (NOT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=c.tenant_id AND r.resource_id=c.resource_id AND business.rental_status(r.id)='delivered') AND NOT EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=c.tenant_id AND j.resource_id=c.resource_id AND j.id<>c.id AND business.field_job_status(j.id)='in_progress')))) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
REVOKE ALL ON FUNCTION business.field_job_status(uuid),business.field_create_job(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,date,date,uuid),business.field_change_job(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.field_job_status(uuid),business.field_create_job(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,date,date,uuid),business.field_change_job(uuid,text,text,uuid) TO anna_business_runtime;
COMMIT;
