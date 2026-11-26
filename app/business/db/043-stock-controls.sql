-- 043: conferência física e entrada rastreável de recebimento, sem efeitos financeiros.
CREATE TABLE business.stock_controls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,product_id uuid NOT NULL,warehouse_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('inventory','receipt')),checked_on date NOT NULL,trace_key text NOT NULL CHECK(length(trace_key)<=100),
 expected_quantity numeric NOT NULL CHECK(expected_quantity>=0),actual_quantity numeric NOT NULL CHECK(actual_quantity>=0),
 receipt_id uuid,receipt_line_id uuid,movement_id uuid,product_revision integer NOT NULL CHECK(product_revision>=0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id,company_id) REFERENCES business.stock_products(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,warehouse_id,company_id) REFERENCES business.warehouses(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES business.purchase_receipts(tenant_id,id),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES business.stock_movements(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,movement_id),
 CHECK((kind='inventory' AND receipt_id IS NULL AND receipt_line_id IS NULL AND ((expected_quantity=actual_quantity)=(movement_id IS NULL))) OR (kind='receipt' AND receipt_id IS NOT NULL AND receipt_line_id IS NOT NULL AND movement_id IS NOT NULL AND actual_quantity>0 AND actual_quantity<=expected_quantity))
);
CREATE INDEX stock_controls_receipt ON business.stock_controls(tenant_id,receipt_id,receipt_line_id);
ALTER TABLE business.stock_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.stock_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_controls_read ON business.stock_controls FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=stock_controls.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY stock_controls_insert ON business.stock_controls FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=stock_controls.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.stock_controls FROM PUBLIC;
GRANT SELECT,INSERT ON business.stock_controls TO anna_business_runtime;
CREATE FUNCTION business.record_stock_control(p_product uuid,p_revision integer,p_warehouse uuid,p_kind text,p_date date,p_trace text,p_quantity numeric,p_receipt uuid,p_line uuid,p_reason text,p_op uuid)
RETURNS TABLE(control_id uuid,movement_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (
 SELECT p.*,btrim(COALESCE(p_trace,'')) AS trace,COALESCE((SELECT max(m.revision) FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id),0) AS rev,
 (SELECT max(m.moved_on) FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id) AS last_on,
 COALESCE((SELECT sum(CASE WHEN m.destination_warehouse_id=p_warehouse THEN m.quantity ELSE 0 END-CASE WHEN m.source_warehouse_id=p_warehouse THEN m.quantity ELSE 0 END) FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id AND m.trace_key=btrim(COALESCE(p_trace,''))),0) AS balance
 FROM business.stock_products p JOIN business.warehouses w ON w.tenant_id=p.tenant_id AND w.company_id=p.company_id AND w.id=p_warehouse
 WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_product AND p_quantity BETWEEN 0 AND 999999999999999.999 AND p_quantity=round(p_quantity,3)
 AND (p.unit NOT IN ('unit','kit') OR p_quantity=trunc(p_quantity)) AND ((p.tracking='none' AND btrim(COALESCE(p_trace,''))='') OR (p.tracking IN ('lot','serial') AND length(btrim(COALESCE(p_trace,''))) BETWEEN 1 AND 100))
 AND (p.tracking<>'serial' OR p_quantity IN (0,1)) AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date
 AND length(btrim(p_reason)) BETWEEN 1 AND 500 AND NOT EXISTS(SELECT 1 FROM business.stock_controls c WHERE c.tenant_id=p.tenant_id AND c.operation_id=p_op)
 ), eligible AS MATERIALIZED (
 SELECT t.*,CASE WHEN p_kind='inventory' THEN t.balance ELSE r.remaining END AS expected,
 CASE WHEN p_kind='inventory' THEN p_quantity-t.balance ELSE p_quantity END AS delta
 FROM target t LEFT JOIN LATERAL(
 SELECT (l->>'quantity')::numeric-COALESCE((SELECT sum(c.actual_quantity) FROM business.stock_controls c WHERE c.tenant_id=t.tenant_id AND c.receipt_id=pr.id AND c.receipt_line_id=p_line),0) AS remaining
 FROM business.purchase_receipts pr JOIN business.purchase_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id AND o.status='approved' AND o.company_id=t.company_id
 CROSS JOIN LATERAL jsonb_array_elements(pr.lines) l JOIN business.purchase_request_lines rl ON rl.tenant_id=o.tenant_id AND rl.request_id=o.request_id AND rl.id=(l->>'line_id')::uuid AND rl.item_id=t.catalog_item_id AND rl.unit=t.unit
 WHERE pr.tenant_id=t.tenant_id AND pr.id=p_receipt AND pr.status='matched' AND (l->>'line_id')::uuid=p_line AND p_date>=pr.received_on
 ) r ON p_kind='receipt'
 WHERE t.rev=p_revision AND (t.last_on IS NULL OR p_date>=t.last_on) AND ((p_kind='inventory' AND p_receipt IS NULL AND p_line IS NULL) OR (p_kind='receipt' AND p_quantity>0 AND p_quantity<=r.remaining))
 ), moved AS MATERIALIZED (
 SELECT e.*,m.movement_id FROM eligible e LEFT JOIN LATERAL business.create_stock_movement(e.id,p_revision,CASE WHEN e.delta<0 THEN 'exit' ELSE 'entry' END,p_date,CASE WHEN e.delta<0 THEN p_warehouse END,CASE WHEN e.delta>0 THEN p_warehouse END,e.trace,abs(e.delta),CASE WHEN p_kind='receipt' THEN 'Recebimento '||p_receipt::text||' / '||p_line::text ELSE 'Inventário '||p_op::text END,p_reason,NULL,gen_random_uuid()) m ON e.delta<>0
 ), inserted AS (
 INSERT INTO business.stock_controls(tenant_id,company_id,product_id,warehouse_id,kind,checked_on,trace_key,expected_quantity,actual_quantity,receipt_id,receipt_line_id,movement_id,product_revision,reason,operation_id,created_by)
 SELECT e.tenant_id,e.company_id,e.id,p_warehouse,p_kind,p_date,e.trace,e.expected,p_quantity,p_receipt,p_line,e.movement_id,p_revision,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM moved e WHERE e.delta=0 OR e.movement_id IS NOT NULL
 RETURNING id,tenant_id,stock_controls.movement_id,created_by
 ), logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'stock_control',id,'create',p_op,jsonb_build_object('kind',p_kind,'product_id',p_product,'movement_id',inserted.movement_id) FROM inserted)
 SELECT id,inserted.movement_id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.record_stock_control(uuid,integer,uuid,text,date,text,numeric,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.record_stock_control(uuid,integer,uuid,text,date,text,numeric,uuid,uuid,text,uuid) TO anna_business_runtime;
