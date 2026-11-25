-- 011: catálogo comercial independente de preços, contratos e estoque.
CREATE TABLE business.catalog_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX catalog_categories_unique ON business.catalog_categories(tenant_id,lower(btrim(name)));
CREATE TABLE business.catalog_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 category_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('product','service','license')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 description text CHECK(description IS NULL OR length(btrim(description)) BETWEEN 1 AND 1000),
 unit text NOT NULL CHECK(unit IN ('unit','kit','kg','meter','liter','hour','day','project','month','year','seat','device','institution')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,category_id) REFERENCES business.catalog_categories(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id),
 CHECK((kind='product' AND unit IN ('unit','kit','kg','meter','liter')) OR (kind='service' AND unit IN ('unit','hour','day','project','month','year')) OR (kind='license' AND unit IN ('unit','seat','device','institution','month','year')))
);
CREATE INDEX catalog_items_lookup ON business.catalog_items(tenant_id,kind,status,category_id);
ALTER TABLE business.catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.catalog_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_categories_read ON business.catalog_categories FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_categories.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY catalog_categories_insert ON business.catalog_categories FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_categories.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.catalog_categories FROM PUBLIC;
GRANT SELECT,INSERT ON business.catalog_categories TO anna_business_runtime;
ALTER TABLE business.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.catalog_items FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_items_read ON business.catalog_items FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_items.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY catalog_items_insert ON business.catalog_items FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_items.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND revision=1 AND status='active');
REVOKE ALL ON business.catalog_items FROM PUBLIC;
GRANT SELECT,INSERT ON business.catalog_items TO anna_business_runtime;
CREATE POLICY catalog_items_update ON business.catalog_items FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_items.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=catalog_items.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(category_id,name,description,unit,status,revision,updated_at) ON business.catalog_items TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.catalog_items_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_catalog_category(p_name text,p_request uuid)
RETURNS TABLE(category_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.catalog_categories(tenant_id,name,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,btrim(p_name),current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'catalog_category',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.create_catalog_item(p_category uuid,p_kind text,p_name text,p_description text,p_unit text,p_request uuid)
RETURNS TABLE(item_id uuid,item_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.catalog_items(tenant_id,category_id,kind,name,description,unit,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_category,p_kind,btrim(p_name),NULLIF(btrim(p_description),''),p_unit,current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by,code
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'catalog_item',id,'create',p_request FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.update_catalog_item(p_id uuid,p_revision integer,p_category uuid,p_name text,p_description text,p_unit text,p_status text,p_request uuid)
RETURNS TABLE(item_id uuid,new_revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT * FROM business.catalog_items WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND revision=p_revision
 ), changed AS (
 UPDATE business.catalog_items i SET category_id=p_category,name=btrim(p_name),description=NULLIF(btrim(p_description),''),unit=p_unit,status=p_status,revision=i.revision+1,updated_at=now()
 FROM previous p WHERE i.id=p.id AND i.tenant_id=p.tenant_id AND i.revision=p_revision
 AND (i.category_id,i.name,i.description,i.unit,i.status) IS DISTINCT FROM (p_category,btrim(p_name),NULLIF(btrim(p_description),''),p_unit,p_status)
 RETURNING i.id,i.tenant_id,i.revision,i.status,p.status AS old_status,jsonb_build_object('name',p.name,'description',p.description,'category_id',p.category_id,'unit',p.unit,'status',p.status) AS before_values,jsonb_build_object('name',i.name,'description',i.description,'category_id',i.category_id,'unit',i.unit,'status',i.status) AS after_values
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'catalog_item',id,CASE WHEN old_status<>status AND status='inactive' THEN 'deactivate' WHEN old_status<>status AND status='active' THEN 'activate' ELSE 'update' END,p_request,jsonb_build_object('before',before_values,'after',after_values,'revision',revision) FROM changed
 ) SELECT id,revision FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_catalog_category(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_catalog_category(text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.create_catalog_item(uuid,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_catalog_item(uuid,text,text,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.update_catalog_item(uuid,integer,uuid,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.update_catalog_item(uuid,integer,uuid,text,text,text,text,uuid) TO anna_business_runtime;
