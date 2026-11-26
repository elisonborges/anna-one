-- 039: cadastro de ativos próprios e em custódia, com movimentações imutáveis.
CREATE TABLE business.assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 tag text NOT NULL CHECK(tag ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 category text NOT NULL CHECK(length(btrim(category)) BETWEEN 1 AND 100),
 ownership text NOT NULL CHECK(ownership IN ('owned','custody')),
 owner_party_id uuid,serial_number text CHECK(serial_number IS NULL OR length(btrim(serial_number)) BETWEEN 1 AND 100),
 registered_on date NOT NULL, acquisition_value numeric(18,2) CHECK(acquisition_value>=0),
 document_id uuid, establishment_id uuid NOT NULL,location text NOT NULL CHECK(length(btrim(location)) BETWEEN 1 AND 200),
 responsible text NOT NULL CHECK(length(btrim(responsible)) BETWEEN 1 AND 120),
 condition text NOT NULL CHECK(condition IN ('good','fair','damaged','unknown')),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,owner_party_id) REFERENCES core.parties(tenant_id,id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,company_id),UNIQUE(tenant_id,company_id,tag),UNIQUE(tenant_id,operation_id),
 CHECK((ownership='owned' AND owner_party_id IS NULL) OR (ownership='custody' AND owner_party_id IS NOT NULL AND owner_party_id<>company_id AND acquisition_value IS NULL))
);
CREATE TABLE business.asset_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,asset_id uuid NOT NULL,company_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),moved_on date NOT NULL,
 establishment_id uuid NOT NULL,location text NOT NULL CHECK(length(btrim(location)) BETWEEN 1 AND 200),
 responsible text NOT NULL CHECK(length(btrim(responsible)) BETWEEN 1 AND 120),
 condition text NOT NULL CHECK(condition IN ('good','fair','damaged','unknown')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,asset_id,company_id) REFERENCES business.assets(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,asset_id,revision),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_read ON business.assets FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=assets.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
CREATE POLICY assets_insert ON business.assets FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=assets.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
REVOKE ALL ON business.assets FROM PUBLIC;
GRANT SELECT,INSERT ON business.assets TO anna_business_runtime;
ALTER TABLE business.asset_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.asset_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_movements_read ON business.asset_movements FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=asset_movements.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
CREATE POLICY asset_movements_insert ON business.asset_movements FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=asset_movements.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
REVOKE ALL ON business.asset_movements FROM PUBLIC;
GRANT SELECT,INSERT ON business.asset_movements TO anna_business_runtime;
CREATE FUNCTION business.create_asset(p_company uuid,p_tag text,p_title text,p_category text,p_ownership text,p_owner uuid,p_serial text,p_date date,p_value numeric,p_doc uuid,p_est uuid,p_location text,p_responsible text,p_condition text,p_source text,p_op uuid)
RETURNS TABLE(asset_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.assets(tenant_id,company_id,tag,title,category,ownership,owner_party_id,serial_number,registered_on,acquisition_value,document_id,establishment_id,location,responsible,condition,source_reference,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,upper(btrim(p_tag)),btrim(p_title),btrim(p_category),p_ownership,p_owner,NULLIF(btrim(p_serial),''),p_date,p_value,p_doc,e.id,btrim(p_location),btrim(p_responsible),p_condition,btrim(p_source),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active' JOIN core.establishments e ON e.tenant_id=c.tenant_id AND e.party_id=c.party_id AND e.id=p_est AND e.status='active'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date
 AND (p_value IS NULL OR (p_value BETWEEN 0 AND 9999999999999999.99 AND p_value=round(p_value,2)))
 AND ((p_ownership='owned' AND p_owner IS NULL) OR (p_ownership='custody' AND p_owner<>c.party_id AND p_value IS NULL AND EXISTS(SELECT 1 FROM core.parties x WHERE x.tenant_id=c.tenant_id AND x.id=p_owner AND x.status='active')))
 AND (p_doc IS NULL OR EXISTS(SELECT 1 FROM business.documents d WHERE d.tenant_id=c.tenant_id AND d.id=p_doc AND d.company_id=c.party_id))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'asset',id,'create',p_op,jsonb_build_object('company_id',p_company,'ownership',p_ownership,'tag',upper(btrim(p_tag))) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.move_asset(p_asset uuid,p_revision integer,p_date date,p_est uuid,p_location text,p_responsible text,p_condition text,p_reason text,p_op uuid)
RETURNS TABLE(movement_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS (
 SELECT a.*,COALESCE(m.revision,0) AS prev,COALESCE(m.moved_on,a.registered_on) AS prev_date
 FROM business.assets a LEFT JOIN LATERAL(SELECT m.revision,m.moved_on FROM business.asset_movements m WHERE m.tenant_id=a.tenant_id AND m.asset_id=a.id ORDER BY revision DESC LIMIT 1) m ON true
 WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.id=p_asset
 ), inserted AS (
 INSERT INTO business.asset_movements(tenant_id,asset_id,company_id,revision,moved_on,establishment_id,location,responsible,condition,reason,operation_id,created_by)
 SELECT a.tenant_id,a.id,a.company_id,a.prev+1,p_date,e.id,btrim(p_location),btrim(p_responsible),p_condition,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM target a JOIN core.establishments e ON e.tenant_id=a.tenant_id AND e.party_id=a.company_id AND e.id=p_est AND e.status='active'
 WHERE a.prev=p_revision AND p_date>=a.prev_date AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,asset_movements.revision,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'asset_movement',id,'create',p_op,jsonb_build_object('asset_id',p_asset,'revision',inserted.revision,'establishment_id',p_est) FROM inserted
 ) SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_asset(uuid,text,text,text,text,uuid,text,date,numeric,uuid,uuid,text,text,text,text,uuid),business.move_asset(uuid,integer,date,uuid,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_asset(uuid,text,text,text,text,uuid,text,date,numeric,uuid,uuid,text,text,text,text,uuid),business.move_asset(uuid,integer,date,uuid,text,text,text,text,uuid) TO anna_business_runtime;
