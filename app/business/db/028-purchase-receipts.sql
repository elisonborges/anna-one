-- 028: recebimento documental e físico, sem estoque ou contas a pagar.
CREATE TABLE business.purchase_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, order_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE, reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 received_on date NOT NULL, notes text NOT NULL CHECK(length(btrim(notes)) BETWEEN 1 AND 1000),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), document_total numeric(24,2) NOT NULL CHECK(document_total>=0),
 expected_total numeric(24,2) NOT NULL CHECK(expected_total>=0),
 status text NOT NULL CHECK(status IN ('matched','divergent')), operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,order_id) REFERENCES business.purchase_orders(tenant_id,id),
 UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,order_id,reference), UNIQUE(tenant_id,id)
);
ALTER TABLE business.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_receipts_read ON business.purchase_receipts FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_receipts.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_receipts_insert ON business.purchase_receipts FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_receipts.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.purchase_receipts FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_receipts TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.purchase_receipts_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_purchase_receipt(p_order uuid,p_ref text,p_date date,p_notes text,p_lines jsonb,p_document numeric,p_op uuid)
RETURNS TABLE(receipt_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH ord AS MATERIALIZED (
 SELECT o.* FROM business.purchase_orders o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND o.status='approved'
 ), input AS MATERIALIZED (SELECT line_id,quantity,document_quantity,document_unit_price FROM jsonb_to_recordset(p_lines) AS x(line_id uuid,quantity numeric,document_quantity numeric,document_unit_price numeric)),
 previous AS MATERIALIZED (
 SELECT (l->>'line_id')::uuid AS line_id,sum((l->>'quantity')::numeric) AS received
 FROM business.purchase_receipts r CROSS JOIN LATERAL jsonb_array_elements(r.lines) l WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.order_id=p_order GROUP BY 1
 ), eligible AS MATERIALIZED (
 SELECT i.*,l->>'item_name' AS item_name,l->>'unit' AS unit,(l->>'unit_price')::numeric AS ordered_price,(l->>'quantity')::numeric AS ordered_quantity,
 round(i.quantity*(l->>'unit_price')::numeric,2) AS expected,
 round(i.document_quantity*i.document_unit_price,2) AS documented
 FROM ord o CROSS JOIN LATERAL jsonb_array_elements(o.lines) l JOIN input i ON i.line_id=(l->>'line_id')::uuid LEFT JOIN previous p ON p.line_id=i.line_id
 WHERE i.quantity>=0 AND i.quantity=round(i.quantity,3) AND i.quantity<=999999.999 AND i.quantity+COALESCE(p.received,0)<=(l->>'quantity')::numeric
 AND i.document_quantity BETWEEN 0 AND 999999.999 AND i.document_quantity=round(i.document_quantity,3)
 AND (i.quantity>0 OR i.document_quantity>0) AND i.document_unit_price BETWEEN 0 AND 999999999999.99 AND i.document_unit_price=round(i.document_unit_price,2)
 ), inserted AS (
 INSERT INTO business.purchase_receipts(tenant_id,order_id,reference,received_on,notes,lines,document_total,expected_total,status,operation_id,created_by)
 SELECT o.tenant_id,o.id,btrim(p_ref),p_date,btrim(p_notes),
 (SELECT jsonb_agg(jsonb_build_object('line_id',e.line_id,'item_name',e.item_name,'unit',e.unit,'quantity',e.quantity::text,'document_quantity',e.document_quantity::text,'document_unit_price',e.document_unit_price::text,'ordered_price',e.ordered_price::text,'expected',e.expected::text,'documented',e.documented::text) ORDER BY e.line_id) FROM eligible e),
 p_document,(SELECT sum(expected) FROM eligible),
 CASE WHEN EXISTS(SELECT 1 FROM eligible WHERE quantity<>document_quantity OR ordered_price<>document_unit_price) OR p_document<>(SELECT sum(documented) FROM eligible) THEN 'divergent' ELSE 'matched' END,
 p_op,current_setting('anna.actor_id',true)::uuid
 FROM ord o WHERE p_date BETWEEN (o.decided_at AT TIME ZONE 'America/Fortaleza')::date AND (now() AT TIME ZONE 'America/Fortaleza')::date
 AND p_document BETWEEN 0 AND 9999999999999999999999.99 AND p_document=round(p_document,2)
 AND (SELECT count(*) FROM input) BETWEEN 1 AND 20 AND (SELECT count(*) FROM eligible)=(SELECT count(*) FROM input) AND (SELECT count(DISTINCT line_id) FROM eligible)=(SELECT count(*) FROM input)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,status
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'purchase_receipt',id,'create',p_op,jsonb_build_object('order',p_order,'status',status) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_purchase_receipt(uuid,text,date,text,jsonb,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_purchase_receipt(uuid,text,date,text,jsonb,numeric,uuid) TO anna_business_runtime;
