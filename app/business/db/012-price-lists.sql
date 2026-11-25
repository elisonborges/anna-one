-- 012: tabelas de preços por empresa própria e preços com vigência inclusiva.
CREATE TABLE business.price_lists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 seller_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 segment text CHECK(segment IS NULL OR length(btrim(segment)) BETWEEN 1 AND 120),
 payment_terms text CHECK(payment_terms IS NULL OR length(btrim(payment_terms)) BETWEEN 1 AND 300),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,seller_id) REFERENCES business.companies(tenant_id,party_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX price_lists_seller_name ON business.price_lists(tenant_id,seller_id,lower(btrim(name)));
CREATE TABLE business.price_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 list_id uuid NOT NULL,
 item_id uuid NOT NULL,
 unit text NOT NULL,
 unit_price numeric(14,2) NOT NULL CHECK(unit_price>=0),
 valid_from date NOT NULL,
 valid_until date,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 FOREIGN KEY(tenant_id,list_id) REFERENCES business.price_lists(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,item_id) REFERENCES business.catalog_items(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,list_id,item_id,valid_from)
);
CREATE INDEX price_entries_lookup ON business.price_entries(tenant_id,list_id,item_id,valid_from);
ALTER TABLE business.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.price_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY price_lists_read ON business.price_lists FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_lists.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY price_lists_insert ON business.price_lists FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_lists.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=price_lists.tenant_id AND p.id=price_lists.seller_id AND p.kind='PJ' AND p.status='active'));
REVOKE ALL ON business.price_lists FROM PUBLIC;
GRANT SELECT,INSERT ON business.price_lists TO anna_business_runtime;
ALTER TABLE business.price_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.price_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY price_entries_read ON business.price_entries FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_entries.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY price_entries_insert ON business.price_entries FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_entries.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.catalog_items i WHERE i.tenant_id=price_entries.tenant_id AND i.id=price_entries.item_id AND i.status='active' AND i.unit=price_entries.unit) AND EXISTS (SELECT 1 FROM business.price_lists l JOIN core.parties p ON p.tenant_id=l.tenant_id AND p.id=l.seller_id WHERE l.tenant_id=price_entries.tenant_id AND l.id=price_entries.list_id AND p.status='active'));
REVOKE ALL ON business.price_entries FROM PUBLIC;
GRANT SELECT,INSERT ON business.price_entries TO anna_business_runtime;
CREATE POLICY price_entries_update ON business.price_entries FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_entries.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=price_entries.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(valid_until) ON business.price_entries TO anna_business_runtime;
CREATE FUNCTION business.create_price_list(p_seller uuid,p_name text,p_segment text,p_terms text,p_request uuid)
RETURNS TABLE(list_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.price_lists(tenant_id,seller_id,name,segment,payment_terms,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_seller,btrim(p_name),NULLIF(btrim(p_segment),''),NULLIF(btrim(p_terms),''),current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'price_list',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
-- Executar via API em transação SERIALIZABLE.
CREATE FUNCTION business.add_price_entry(p_list uuid,p_item uuid,p_price numeric,p_from date,p_until date,p_request uuid)
RETURNS TABLE(entry_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.price_entries(tenant_id,list_id,item_id,unit,unit_price,valid_from,valid_until,created_by)
 SELECT i.tenant_id,p_list,i.id,i.unit,p_price,p_from,p_until,current_setting('anna.actor_id',true)::uuid
 FROM business.catalog_items i WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_item AND i.status='active'
 AND p_price>=0 AND p_price=round(p_price,2)
 AND NOT EXISTS (SELECT 1 FROM business.price_entries e WHERE e.tenant_id=i.tenant_id AND e.list_id=p_list AND e.item_id=i.id AND (e.valid_until IS NULL OR e.valid_until>=p_from) AND (p_until IS NULL OR e.valid_from<=p_until))
 ON CONFLICT(tenant_id,list_id,item_id,valid_from) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'price_entry',id,'create',p_request,jsonb_build_object('list_id',p_list,'item_id',p_item,'unit_price',p_price,'valid_from',p_from,'valid_until',p_until) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.close_price_entry(p_id uuid,p_until date,p_reason text,p_request uuid)
RETURNS TABLE(entry_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT id,tenant_id,valid_until FROM business.price_entries WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND p_until>=valid_from AND (valid_until IS NULL OR p_until<valid_until) AND length(btrim(p_reason)) BETWEEN 1 AND 300
 ), changed AS (
 UPDATE business.price_entries e SET valid_until=p_until FROM previous p WHERE e.id=p.id AND e.tenant_id=p.tenant_id
 RETURNING e.id,e.tenant_id,p.valid_until AS old_until,e.valid_until AS new_until
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'price_entry',id,'unlink',p_request,jsonb_build_object('old_valid_until',old_until,'new_valid_until',new_until,'reason',btrim(p_reason)) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_price_list(uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_price_list(uuid,text,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.add_price_entry(uuid,uuid,numeric,date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_price_entry(uuid,uuid,numeric,date,date,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.close_price_entry(uuid,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.close_price_entry(uuid,date,text,uuid) TO anna_business_runtime;
