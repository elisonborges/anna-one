-- Esquema mínimo descartável. Nenhuma credencial ou dado real.
CREATE SCHEMA business;
CREATE SCHEMA core;
CREATE ROLE anna_business_runtime NOLOGIN;
CREATE TABLE business.companies(tenant_id uuid,party_id uuid,PRIMARY KEY(tenant_id,party_id));
CREATE FUNCTION business.hr_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE business.audit_events(tenant_id uuid,actor_id uuid,entity_type text,entity_id uuid,action text,request_id uuid,details jsonb);
CREATE TABLE business.financial_obligations(tenant_id uuid,id uuid PRIMARY KEY,issued_on date);
CREATE TABLE business.financial_installments(tenant_id uuid,id uuid PRIMARY KEY,obligation_id uuid,remaining numeric,revision int,status text);
CREATE TABLE business.financial_settlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code bigint GENERATED ALWAYS AS IDENTITY,tenant_id uuid,installment_id uuid,principal numeric,discount numeric,interest numeric,fine numeric,settled_on date,method text,reference text,request_id uuid,created_by uuid,cash_amount numeric GENERATED ALWAYS AS(principal-discount+interest+fine) STORED,UNIQUE(tenant_id,request_id));
CREATE TABLE business.financial_reversals(id uuid PRIMARY KEY);
CREATE TABLE business.catalog_items(tenant_id uuid,id uuid PRIMARY KEY,status text,kind text,unit text);
CREATE TABLE business.stock_products(tenant_id uuid,id uuid PRIMARY KEY,company_id uuid,catalog_item_id uuid,unit text,tracking text);
CREATE TABLE business.warehouses(tenant_id uuid,id uuid PRIMARY KEY,company_id uuid,establishment_id uuid);
CREATE TABLE core.establishments(tenant_id uuid,id uuid PRIMARY KEY,status text);
CREATE TABLE business.documents(tenant_id uuid,id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE business.stock_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,company_id uuid,product_id uuid,revision int,kind text,moved_on date,source_warehouse_id uuid,destination_warehouse_id uuid,trace_key text,quantity numeric,reference text,reason text,document_id uuid,operation_id uuid,created_by uuid,UNIQUE(tenant_id,product_id,revision),UNIQUE(tenant_id,operation_id));
CREATE TABLE business.stock_controls(id uuid PRIMARY KEY);
CREATE TABLE business.tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);
CREATE TABLE business.purchase_requests(tenant_id uuid,id uuid PRIMARY KEY,created_by uuid,status text,revision int,updated_at timestamptz);
CREATE TABLE business.purchase_request_events(tenant_id uuid,request_id uuid,from_status text,to_status text,reason text,operation_id uuid,created_by uuid,UNIQUE(tenant_id,operation_id));
CREATE TABLE business.purchase_orders(tenant_id uuid,id uuid PRIMARY KEY,status text,revision int,decided_by uuid,decided_at timestamptz,decision_reason text,decision_operation uuid,supplier_id uuid,valid_until date,UNIQUE(tenant_id,decision_operation));
CREATE TABLE core.parties(tenant_id uuid,id uuid PRIMARY KEY,status text);
CREATE TABLE business.party_roles(tenant_id uuid,party_id uuid,role text,active boolean);
CREATE TABLE business.management_period_events(tenant_id uuid,company_id uuid,period_on date,status text);
CREATE TABLE business.ledger_entries(tenant_id uuid,company_id uuid,posted_on date);
CREATE FUNCTION business.management_period_closed(t uuid,c uuid,d date) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM business.management_period_events WHERE tenant_id=t AND company_id=c AND period_on=d AND status='closed') $$;
CREATE FUNCTION business.guard_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

-- Funções reais capturadas do esquema de teste Neon, versão 107.
CREATE OR REPLACE FUNCTION business.stock_movement_allowed(p_tenant uuid, p_product uuid, p_revision integer, p_kind text, p_date date, p_source uuid, p_dest uuid, p_trace text, p_quantity numeric, p_doc uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 WITH p AS (SELECT s.*,i.status AS catalog_status,i.kind AS catalog_kind,i.unit AS catalog_unit FROM business.stock_products s JOIN business.catalog_items i ON i.tenant_id=s.tenant_id AND i.id=s.catalog_item_id WHERE s.tenant_id=p_tenant AND s.id=p_product),
 previous AS (SELECT COALESCE(max(m.revision),0) AS revision,max(m.moved_on) AS moved_on FROM business.stock_movements m WHERE m.tenant_id=p_tenant AND m.product_id=p_product),
 balance AS (SELECT COALESCE(sum(CASE WHEN m.destination_warehouse_id=p_source THEN m.quantity ELSE 0 END-CASE WHEN m.source_warehouse_id=p_source THEN m.quantity ELSE 0 END),0) AS source_balance,COALESCE(sum(CASE WHEN m.kind='entry' THEN m.quantity WHEN m.kind='exit' THEN -m.quantity ELSE 0 END),0) AS total_balance FROM business.stock_movements m WHERE m.tenant_id=p_tenant AND m.product_id=p_product AND m.trace_key=p_trace)
 SELECT EXISTS(SELECT 1 FROM p CROSS JOIN previous v CROSS JOIN balance b WHERE p_revision=v.revision+1 AND p_date<= (now() AT TIME ZONE 'America/Fortaleza')::date AND (v.moved_on IS NULL OR p_date>=v.moved_on)
 AND p_quantity BETWEEN 0.001 AND 999999999999999.999 AND p_quantity=round(p_quantity,3) AND (p.unit NOT IN ('unit','kit') OR p_quantity=trunc(p_quantity))
 AND ((p.tracking='none' AND p_trace='') OR (p.tracking='lot' AND length(p_trace) BETWEEN 1 AND 100) OR (p.tracking='serial' AND length(p_trace) BETWEEN 1 AND 100 AND p_quantity=1))
 AND ((p_kind='entry' AND p_source IS NULL AND p_dest IS NOT NULL AND p.catalog_status='active' AND p.catalog_kind='product' AND p.catalog_unit=p.unit AND (p.tracking<>'serial' OR b.total_balance=0)) OR (p_kind='exit' AND p_source IS NOT NULL AND p_dest IS NULL AND b.source_balance>=p_quantity) OR (p_kind='transfer' AND p_source IS NOT NULL AND p_dest IS NOT NULL AND p_source<>p_dest AND b.source_balance>=p_quantity))
 AND (p_source IS NULL OR EXISTS(SELECT 1 FROM business.warehouses w WHERE w.tenant_id=p_tenant AND w.id=p_source AND w.company_id=p.company_id))
 AND (p_dest IS NULL OR EXISTS(SELECT 1 FROM business.warehouses w JOIN core.establishments e ON e.tenant_id=w.tenant_id AND e.id=w.establishment_id AND e.status='active' WHERE w.tenant_id=p_tenant AND w.id=p_dest AND w.company_id=p.company_id))
 AND (p_doc IS NULL OR EXISTS(SELECT 1 FROM business.documents d WHERE d.tenant_id=p_tenant AND d.id=p_doc AND d.company_id=p.company_id)))
$function$;

CREATE OR REPLACE FUNCTION business.advance_purchase_request(p_id uuid, p_revision integer, p_status text, p_reason text, p_operation uuid)
 RETURNS TABLE(purchase_id uuid, new_status text, new_revision integer)
 LANGUAGE sql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION business.create_stock_movement(p_product uuid, p_revision integer, p_kind text, p_date date, p_source uuid, p_dest uuid, p_trace text, p_quantity numeric, p_reference text, p_reason text, p_doc uuid, p_op uuid)
 RETURNS TABLE(movement_id uuid, revision integer)
 LANGUAGE sql
AS $function$
 WITH target AS MATERIALIZED (SELECT p.tenant_id,p.id,p.company_id FROM business.stock_products p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_product AND business.stock_movement_allowed(p.tenant_id,p.id,p_revision+1,p_kind,p_date,p_source,p_dest,btrim(COALESCE(p_trace,'')),p_quantity,p_doc)),
 inserted AS (INSERT INTO business.stock_movements(tenant_id,company_id,product_id,revision,kind,moved_on,source_warehouse_id,destination_warehouse_id,trace_key,quantity,reference,reason,document_id,operation_id,created_by)
 SELECT t.tenant_id,t.company_id,t.id,p_revision+1,p_kind,p_date,p_source,p_dest,btrim(COALESCE(p_trace,'')),p_quantity,btrim(p_reference),btrim(p_reason),p_doc,p_op,current_setting('anna.actor_id',true)::uuid FROM target t
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,stock_movements.revision,created_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'stock_movement',id,'create',p_op,jsonb_build_object('product_id',p_product,'kind',p_kind,'revision',inserted.revision,'quantity',p_quantity) FROM inserted)
 SELECT id,inserted.revision FROM inserted
$function$;

CREATE OR REPLACE FUNCTION business.decide_purchase_order(p_order uuid, p_revision integer, p_status text, p_reason text, p_op uuid)
 RETURNS TABLE(order_id uuid)
 LANGUAGE sql
AS $function$
 WITH changed AS (
 UPDATE business.purchase_orders o SET status=p_status,revision=o.revision+1,decided_by=current_setting('anna.actor_id',true)::uuid,decided_at=now(),decision_reason=btrim(p_reason),decision_operation=p_op
 WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND o.status='pending' AND o.revision=p_revision AND p_status IN ('approved','rejected')
 AND (p_status='rejected' OR (o.valid_until >= (now() AT TIME ZONE 'America/Fortaleza')::date AND EXISTS(SELECT 1 FROM core.parties s JOIN business.party_roles pr ON pr.tenant_id=s.tenant_id AND pr.party_id=s.id WHERE s.tenant_id=o.tenant_id AND s.id=o.supplier_id AND s.status='active' AND pr.role='supplier' AND pr.active)))
 RETURNING o.id,o.tenant_id,o.decided_by,o.status
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,decided_by,'purchase_order',id,'update',p_op,jsonb_build_object('status',status,'reason',p_reason) FROM changed
 ) SELECT id FROM changed
$function$;

CREATE OR REPLACE FUNCTION business.settle_financial_installment(p_id uuid, p_revision integer, p_principal numeric, p_discount numeric, p_interest numeric, p_fine numeric, p_date date, p_method text, p_reference text, p_request uuid)
 RETURNS TABLE(settlement_id uuid, settlement_code bigint)
 LANGUAGE sql
AS $function$
 WITH changed AS (
 UPDATE business.financial_installments i SET remaining=i.remaining-p_principal,status=CASE WHEN i.remaining=p_principal THEN 'settled' ELSE 'partial' END,revision=i.revision+1
 FROM business.financial_obligations o
 WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_id AND i.revision=p_revision AND o.tenant_id=i.tenant_id AND o.id=i.obligation_id
 AND p_principal>0 AND p_principal<=i.remaining AND p_discount BETWEEN 0 AND p_principal AND p_interest BETWEEN 0 AND 9999999999999999.99 AND p_fine BETWEEN 0 AND 9999999999999999.99
 AND p_principal=round(p_principal,2) AND p_discount=round(p_discount,2) AND p_interest=round(p_interest,2) AND p_fine=round(p_fine,2)
 AND p_date BETWEEN o.issued_on AND (now() AT TIME ZONE 'America/Fortaleza')::date
 AND p_method IN ('pix','transfer','cash','card','boleto','other','non_cash') AND (p_method='non_cash')=(p_principal-p_discount+p_interest+p_fine=0)
 AND length(btrim(p_reference)) BETWEEN 1 AND 200
 AND NOT EXISTS (SELECT 1 FROM business.financial_settlements s WHERE s.tenant_id=i.tenant_id AND s.request_id=p_request)
 RETURNING i.id,i.tenant_id,i.remaining
 ), inserted AS (
 INSERT INTO business.financial_settlements(tenant_id,installment_id,principal,discount,interest,fine,settled_on,method,reference,request_id,created_by)
 SELECT tenant_id,id,p_principal,p_discount,p_interest,p_fine,p_date,p_method,btrim(p_reference),p_request,current_setting('anna.actor_id',true)::uuid FROM changed
 RETURNING id,code,tenant_id,created_by,cash_amount
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_settlement',id,'create',p_request,jsonb_build_object('installment_id',p_id,'principal',p_principal,'discount',p_discount,'interest',p_interest,'fine',p_fine,'cash',cash_amount) FROM inserted
 ) SELECT id,code FROM inserted
$function$;
