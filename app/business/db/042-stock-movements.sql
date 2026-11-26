-- 042: movimentos imutáveis, saldo derivado e rastreabilidade.
CREATE TABLE business.stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,product_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),kind text NOT NULL CHECK(kind IN ('entry','exit','transfer')),
 moved_on date NOT NULL,source_warehouse_id uuid,destination_warehouse_id uuid,
 trace_key text NOT NULL DEFAULT '' CHECK(length(trace_key)<=100 AND trace_key=btrim(trace_key)),
 quantity numeric(18,3) NOT NULL CHECK(quantity>0),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),document_id uuid,
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,product_id,company_id) REFERENCES business.stock_products(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,source_warehouse_id,company_id) REFERENCES business.warehouses(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,destination_warehouse_id,company_id) REFERENCES business.warehouses(tenant_id,id,company_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,product_id,revision),UNIQUE(tenant_id,operation_id),
 CHECK((kind='entry' AND source_warehouse_id IS NULL AND destination_warehouse_id IS NOT NULL) OR (kind='exit' AND source_warehouse_id IS NOT NULL AND destination_warehouse_id IS NULL) OR (kind='transfer' AND source_warehouse_id IS NOT NULL AND destination_warehouse_id IS NOT NULL AND source_warehouse_id<>destination_warehouse_id))
);
CREATE INDEX stock_movements_trace ON business.stock_movements(tenant_id,product_id,trace_key);
ALTER TABLE business.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_read ON business.stock_movements FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=stock_movements.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY stock_movements_insert ON business.stock_movements FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=stock_movements.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.stock_movements FROM PUBLIC;
GRANT SELECT,INSERT ON business.stock_movements TO anna_business_runtime;
CREATE FUNCTION business.stock_movement_allowed(p_tenant uuid,p_product uuid,p_revision integer,p_kind text,p_date date,p_source uuid,p_dest uuid,p_trace text,p_quantity numeric,p_doc uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
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
$$;
CREATE POLICY stock_movements_integrity ON business.stock_movements AS RESTRICTIVE FOR INSERT WITH CHECK(business.stock_movement_allowed(tenant_id,product_id,revision,kind,moved_on,source_warehouse_id,destination_warehouse_id,trace_key,quantity,document_id));
CREATE FUNCTION business.create_stock_movement(p_product uuid,p_revision integer,p_kind text,p_date date,p_source uuid,p_dest uuid,p_trace text,p_quantity numeric,p_reference text,p_reason text,p_doc uuid,p_op uuid)
RETURNS TABLE(movement_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (SELECT p.tenant_id,p.id,p.company_id FROM business.stock_products p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_product AND business.stock_movement_allowed(p.tenant_id,p.id,p_revision+1,p_kind,p_date,p_source,p_dest,btrim(COALESCE(p_trace,'')),p_quantity,p_doc)),
 inserted AS (INSERT INTO business.stock_movements(tenant_id,company_id,product_id,revision,kind,moved_on,source_warehouse_id,destination_warehouse_id,trace_key,quantity,reference,reason,document_id,operation_id,created_by)
 SELECT t.tenant_id,t.company_id,t.id,p_revision+1,p_kind,p_date,p_source,p_dest,btrim(COALESCE(p_trace,'')),p_quantity,btrim(p_reference),btrim(p_reason),p_doc,p_op,current_setting('anna.actor_id',true)::uuid FROM target t
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,stock_movements.revision,created_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'stock_movement',id,'create',p_op,jsonb_build_object('product_id',p_product,'kind',p_kind,'revision',inserted.revision,'quantity',p_quantity) FROM inserted)
 SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.stock_movement_allowed(uuid,uuid,integer,text,date,uuid,uuid,text,numeric,uuid),business.create_stock_movement(uuid,integer,text,date,uuid,uuid,text,numeric,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.stock_movement_allowed(uuid,uuid,integer,text,date,uuid,uuid,text,numeric,uuid),business.create_stock_movement(uuid,integer,text,date,uuid,uuid,text,numeric,text,text,uuid,uuid) TO anna_business_runtime;
