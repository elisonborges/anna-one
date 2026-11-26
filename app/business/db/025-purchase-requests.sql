-- 025: requisições internas de compra e aprovação, sem pedido ou obrigação financeira.
CREATE TABLE business.purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES business.tenants(id),
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,company_id uuid NOT NULL,supplier_id uuid,
 company_name text NOT NULL,supplier_name text,title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 1000),
 needed_on date,priority text NOT NULL CHECK(priority IN ('normal','urgent')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES core.parties(tenant_id,id),
 CHECK(supplier_id IS NULL OR supplier_id<>company_id),CHECK((supplier_id IS NULL)=(supplier_name IS NULL)),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_id)
);
CREATE TABLE business.purchase_request_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,request_id uuid NOT NULL,item_id uuid NOT NULL,
 item_code bigint NOT NULL,item_name text NOT NULL,unit text NOT NULL,
 quantity numeric(9,3) NOT NULL CHECK(quantity>0),estimated_unit_price numeric(14,2) NOT NULL CHECK(estimated_unit_price>=0),
 estimated_total numeric(24,2) GENERATED ALWAYS AS (round(quantity*estimated_unit_price,2)) STORED,
 FOREIGN KEY(tenant_id,request_id) REFERENCES business.purchase_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,item_id) REFERENCES business.catalog_items(tenant_id,id),
 UNIQUE(tenant_id,request_id,item_id)
);
CREATE TABLE business.purchase_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,request_id uuid NOT NULL,
 from_status text NOT NULL,to_status text NOT NULL,reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,request_id) REFERENCES business.purchase_requests(tenant_id,id),
 UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_requests_read ON business.purchase_requests FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_requests.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_requests_insert ON business.purchase_requests FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_requests.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND status='draft' AND revision=1);
REVOKE ALL ON business.purchase_requests FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_requests TO anna_business_runtime;
ALTER TABLE business.purchase_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_request_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_request_lines_read ON business.purchase_request_lines FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_request_lines.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_request_lines_insert ON business.purchase_request_lines FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_request_lines.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.purchase_request_lines FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_request_lines TO anna_business_runtime;
ALTER TABLE business.purchase_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_request_events FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_request_events_read ON business.purchase_request_events FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_request_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_request_events_insert ON business.purchase_request_events FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_request_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.purchase_request_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_request_events TO anna_business_runtime;
CREATE POLICY purchase_requests_update ON business.purchase_requests FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_requests.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_requests.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(status,revision,updated_at) ON business.purchase_requests TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.purchase_requests_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_purchase_request(p_company uuid,p_supplier uuid,p_title text,p_justification text,p_needed date,p_priority text,p_lines jsonb,p_operation uuid)
RETURNS TABLE(purchase_id uuid,purchase_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH input AS MATERIALIZED (SELECT item_id,quantity,estimated_unit_price FROM jsonb_to_recordset(p_lines) AS x(item_id uuid,quantity numeric,estimated_unit_price numeric)),
 eligible AS MATERIALIZED (SELECT i.id,i.code,i.name,i.unit,x.quantity,x.estimated_unit_price FROM input x JOIN business.catalog_items i ON i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=x.item_id AND i.status='active' WHERE x.quantity>0 AND x.quantity<=999999.999 AND x.quantity=round(x.quantity,3) AND x.estimated_unit_price BETWEEN 0 AND 999999999999.99 AND x.estimated_unit_price=round(x.estimated_unit_price,2)),
 header AS (
 INSERT INTO business.purchase_requests(tenant_id,company_id,supplier_id,company_name,supplier_name,title,justification,needed_on,priority,request_id,created_by)
 SELECT b.tenant_id,b.party_id,p_supplier,c.legal_name,s.legal_name,btrim(p_title),btrim(p_justification),p_needed,p_priority,p_operation,current_setting('anna.actor_id',true)::uuid
 FROM business.companies b JOIN core.parties c ON c.tenant_id=b.tenant_id AND c.id=b.party_id AND c.status='active'
 LEFT JOIN core.parties s ON s.tenant_id=b.tenant_id AND s.id=p_supplier AND s.status='active'
 WHERE b.tenant_id=current_setting('anna.tenant_id',true)::uuid AND b.party_id=p_company AND (p_supplier IS NULL OR (s.id IS NOT NULL AND s.id<>b.party_id AND EXISTS(SELECT 1 FROM business.party_roles r WHERE r.tenant_id=b.tenant_id AND r.party_id=s.id AND r.role='supplier' AND r.active)))
 AND (p_needed IS NULL OR p_needed>=(now() AT TIME ZONE 'America/Fortaleza')::date)
 AND (SELECT count(*) FROM input) BETWEEN 1 AND 20 AND (SELECT count(*) FROM eligible)=(SELECT count(*) FROM input) AND (SELECT count(DISTINCT id) FROM eligible)=(SELECT count(*) FROM input)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,code,created_by
 ), lines AS (
 INSERT INTO business.purchase_request_lines(tenant_id,request_id,item_id,item_code,item_name,unit,quantity,estimated_unit_price)
 SELECT h.tenant_id,h.id,e.id,e.code,e.name,e.unit,e.quantity,e.estimated_unit_price FROM header h CROSS JOIN eligible e RETURNING request_id,estimated_total
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT h.tenant_id,h.created_by,'purchase_request',h.id,'create',p_operation,jsonb_build_object('items',count(*),'estimate',sum(l.estimated_total)) FROM header h JOIN lines l ON l.request_id=h.id GROUP BY h.tenant_id,h.created_by,h.id
 ) SELECT id,code FROM header
$$;
CREATE FUNCTION business.advance_purchase_request(p_id uuid,p_revision integer,p_status text,p_reason text,p_operation uuid)
RETURNS TABLE(purchase_id uuid,new_status text,new_revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH eligible AS MATERIALIZED (
 SELECT r.id,r.tenant_id,r.status AS previous FROM business.purchase_requests r JOIN business.tenant_memberships m ON m.tenant_id=r.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_id AND r.revision=p_revision
 AND ((r.status='draft' AND p_status IN ('submitted','cancelled') AND (r.created_by=m.user_id OR m.role='owner')) OR (r.status='submitted' AND p_status IN ('approved','rejected','cancelled') AND m.role='owner'))
 AND (p_status NOT IN ('rejected','cancelled') OR length(btrim(p_reason)) BETWEEN 1 AND 300)
 AND (p_reason IS NULL OR length(btrim(p_reason)) BETWEEN 1 AND 300)
 AND NOT EXISTS(SELECT 1 FROM business.purchase_request_events e WHERE e.tenant_id=r.tenant_id AND e.operation_id=p_operation)
 ), changed AS (
 UPDATE business.purchase_requests r SET status=p_status,revision=r.revision+1,updated_at=now() FROM eligible e WHERE r.tenant_id=e.tenant_id AND r.id=e.id AND r.revision=p_revision RETURNING r.id,r.tenant_id,r.status,r.revision,e.previous
 ), recorded AS (
 INSERT INTO business.purchase_request_events(tenant_id,request_id,from_status,to_status,reason,operation_id,created_by)
 SELECT tenant_id,id,previous,status,NULLIF(btrim(p_reason),''),p_operation,current_setting('anna.actor_id',true)::uuid FROM changed RETURNING request_id
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT c.tenant_id,current_setting('anna.actor_id',true)::uuid,'purchase_request',c.id,'update',p_operation,jsonb_build_object('from',c.previous,'to',c.status,'revision',c.revision) FROM changed c JOIN recorded r ON r.request_id=c.id
 ) SELECT id,status,revision FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_purchase_request(uuid,uuid,text,text,date,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_purchase_request(uuid,uuid,text,text,date,text,jsonb,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.advance_purchase_request(uuid,integer,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.advance_purchase_request(uuid,integer,text,text,uuid) TO anna_business_runtime;
