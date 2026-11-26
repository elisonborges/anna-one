-- 040: ciclo de vida físico patrimonial, garantias declaradas e manutenção.
CREATE TABLE business.asset_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,asset_id uuid NOT NULL,company_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),
 kind text NOT NULL CHECK(kind IN ('warranty','maintenance_start','maintenance_finish','retired','returned')),
 event_on date NOT NULL,description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 provider text CHECK(provider IS NULL OR length(btrim(provider)) BETWEEN 1 AND 200),
 warranty_from date,warranty_until date,reference text CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 200),
 maintenance_cost numeric(18,2) CHECK(maintenance_cost>=0),document_id uuid,
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,asset_id,company_id) REFERENCES business.assets(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,asset_id,revision),UNIQUE(tenant_id,operation_id),
 CHECK((kind='warranty' AND warranty_from IS NOT NULL AND warranty_until IS NOT NULL AND warranty_until>=warranty_from AND provider IS NOT NULL AND reference IS NOT NULL) OR (kind<>'warranty' AND warranty_from IS NULL AND warranty_until IS NULL)),
 CHECK(maintenance_cost IS NULL OR kind='maintenance_finish')
);
ALTER TABLE business.asset_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.asset_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_lifecycle_read ON business.asset_lifecycle_events FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=asset_lifecycle_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY asset_lifecycle_insert ON business.asset_lifecycle_events FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=asset_lifecycle_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.asset_lifecycle_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.asset_lifecycle_events TO anna_business_runtime;
CREATE FUNCTION business.asset_movement_allowed(p_tenant uuid,p_asset uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT NOT EXISTS(SELECT 1 FROM business.asset_lifecycle_events e WHERE e.tenant_id=p_tenant AND e.asset_id=p_asset AND (e.kind IN ('retired','returned') OR e.event_on>p_date))
$$;
CREATE POLICY asset_movements_lifecycle_guard ON business.asset_movements AS RESTRICTIVE FOR INSERT WITH CHECK(business.asset_movement_allowed(tenant_id,asset_id,moved_on));
CREATE FUNCTION business.record_asset_event(p_asset uuid,p_revision integer,p_kind text,p_date date,p_description text,p_provider text,p_from date,p_until date,p_reference text,p_cost numeric,p_doc uuid,p_op uuid)
RETURNS TABLE(event_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (
 SELECT a.*,COALESCE(last_event.revision,0) AS prev,GREATEST(a.registered_on,last_event.event_on,last_move.moved_on) AS last_on,COALESCE(state.kind,'maintenance_finish') AS state
 FROM business.assets a
 LEFT JOIN LATERAL(SELECT e.revision,e.event_on FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id ORDER BY e.revision DESC LIMIT 1) last_event ON true
 LEFT JOIN LATERAL(SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1) state ON true
 LEFT JOIN LATERAL(SELECT m.moved_on FROM business.asset_movements m WHERE m.tenant_id=a.tenant_id AND m.asset_id=a.id ORDER BY m.revision DESC LIMIT 1) last_move ON true
 WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.id=p_asset
 ), inserted AS (
 INSERT INTO business.asset_lifecycle_events(tenant_id,asset_id,company_id,revision,kind,event_on,description,provider,warranty_from,warranty_until,reference,maintenance_cost,document_id,operation_id,created_by)
 SELECT a.tenant_id,a.id,a.company_id,a.prev+1,p_kind,p_date,btrim(p_description),NULLIF(btrim(p_provider),''),p_from,p_until,NULLIF(btrim(p_reference),''),p_cost,p_doc,p_op,current_setting('anna.actor_id',true)::uuid
 FROM target a WHERE a.prev=p_revision AND p_date>=a.last_on AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND a.state NOT IN ('retired','returned')
 AND (p_kind='warranty' OR (p_kind='maintenance_start' AND a.state='maintenance_finish') OR (p_kind='maintenance_finish' AND a.state='maintenance_start') OR (p_kind='retired' AND a.ownership='owned' AND a.state='maintenance_finish') OR (p_kind='returned' AND a.ownership='custody' AND a.state='maintenance_finish'))
 AND (p_cost IS NULL OR (p_kind='maintenance_finish' AND p_cost BETWEEN 0 AND 9999999999999999.99 AND p_cost=round(p_cost,2)))
 AND (p_doc IS NULL OR EXISTS(SELECT 1 FROM business.documents d WHERE d.tenant_id=a.tenant_id AND d.id=p_doc AND d.company_id=a.company_id))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,asset_lifecycle_events.revision,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'asset_lifecycle',id,'create',p_op,jsonb_build_object('asset_id',p_asset,'kind',p_kind,'revision',inserted.revision) FROM inserted
 ) SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.asset_movement_allowed(uuid,uuid,date),business.record_asset_event(uuid,integer,text,date,text,text,date,date,text,numeric,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.asset_movement_allowed(uuid,uuid,date),business.record_asset_event(uuid,integer,text,date,text,text,date,date,text,numeric,uuid,uuid) TO anna_business_runtime;
