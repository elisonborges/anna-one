-- 041: fundação de estoque, reutilizando produtos do catálogo comercial.
CREATE TABLE business.stock_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,catalog_item_id uuid NOT NULL,
 sku text NOT NULL CHECK(sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 unit text NOT NULL CHECK(unit IN ('unit','kit','kg','meter','liter')),
 tracking text NOT NULL CHECK(tracking IN ('none','lot','serial')),
 barcode text CHECK(barcode IS NULL OR length(btrim(barcode)) BETWEEN 1 AND 100),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,catalog_item_id) REFERENCES business.catalog_items(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,company_id),UNIQUE(tenant_id,company_id,sku),UNIQUE(tenant_id,company_id,catalog_item_id),UNIQUE(tenant_id,operation_id),
 CHECK(tracking<>'serial' OR unit IN ('unit','kit'))
);
CREATE UNIQUE INDEX stock_products_barcode_unique ON business.stock_products(tenant_id,company_id,barcode) WHERE barcode IS NOT NULL;
CREATE TABLE business.warehouses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,establishment_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 location text NOT NULL CHECK(length(btrim(location)) BETWEEN 1 AND 200),
 responsible text NOT NULL CHECK(length(btrim(responsible)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,company_id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.stock_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.stock_products FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_products_read ON business.stock_products FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=stock_products.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
CREATE POLICY stock_products_insert ON business.stock_products FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=stock_products.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
REVOKE ALL ON business.stock_products FROM PUBLIC;
GRANT SELECT,INSERT ON business.stock_products TO anna_business_runtime;
ALTER TABLE business.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouses_read ON business.warehouses FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=warehouses.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
CREATE POLICY warehouses_insert ON business.warehouses FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=warehouses.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active'));
REVOKE ALL ON business.warehouses FROM PUBLIC;
GRANT SELECT,INSERT ON business.warehouses TO anna_business_runtime;
CREATE FUNCTION business.create_stock_product(p_company uuid,p_catalog uuid,p_sku text,p_tracking text,p_barcode text,p_op uuid)
RETURNS TABLE(product_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.stock_products(tenant_id,company_id,catalog_item_id,sku,name,unit,tracking,barcode,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,i.id,upper(btrim(p_sku)),i.name,i.unit,p_tracking,NULLIF(btrim(p_barcode),''),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active'
 JOIN business.catalog_items i ON i.tenant_id=c.tenant_id AND i.id=p_catalog AND i.kind='product' AND i.status='active'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND p_tracking IN ('none','lot','serial') AND (p_tracking<>'serial' OR i.unit IN ('unit','kit'))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'stock_product',id,'create',p_op,jsonb_build_object('company_id',p_company,'catalog_item_id',p_catalog,'sku',upper(btrim(p_sku))) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.create_warehouse(p_company uuid,p_est uuid,p_code text,p_name text,p_location text,p_responsible text,p_op uuid)
RETURNS TABLE(warehouse_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.warehouses(tenant_id,company_id,establishment_id,code,name,location,responsible,operation_id,created_by)
 SELECT c.tenant_id,c.party_id,e.id,upper(btrim(p_code)),btrim(p_name),btrim(p_location),btrim(p_responsible),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active'
 JOIN core.establishments e ON e.tenant_id=c.tenant_id AND e.party_id=c.party_id AND e.id=p_est AND e.status='active'
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'warehouse',id,'create',p_op,jsonb_build_object('company_id',p_company,'establishment_id',p_est,'code',upper(btrim(p_code))) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_stock_product(uuid,uuid,text,text,text,uuid),business.create_warehouse(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_stock_product(uuid,uuid,text,text,text,uuid),business.create_warehouse(uuid,uuid,text,text,text,text,uuid) TO anna_business_runtime;
