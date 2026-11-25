-- 008: marcas, redes e vínculos comerciais declaratórios de franquia.
CREATE TABLE core.brands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 holder_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 registration_ref text CHECK(registration_ref IS NULL OR length(btrim(registration_ref)) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,holder_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX brands_holder_name_unique ON core.brands(tenant_id,holder_id,lower(btrim(name)));
CREATE TABLE core.franchise_networks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 franchisor_id uuid NOT NULL,
 authority_ref text NOT NULL CHECK(length(btrim(authority_ref)) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES core.brands(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,franchisor_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,brand_id,franchisor_id)
);
CREATE TABLE core.franchise_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 network_id uuid NOT NULL,
 franchisee_id uuid NOT NULL,
 agreement_ref text NOT NULL CHECK(length(btrim(agreement_ref)) BETWEEN 1 AND 200),
 territory text CHECK(territory IS NULL OR length(btrim(territory)) BETWEEN 1 AND 200),
 valid_from date NOT NULL,
 valid_until date,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 FOREIGN KEY(tenant_id,network_id) REFERENCES core.franchise_networks(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,franchisee_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,network_id,franchisee_id,valid_from)
);
CREATE INDEX franchise_relationships_lookup ON core.franchise_relationships(tenant_id,network_id,franchisee_id);
ALTER TABLE core.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.brands FORCE ROW LEVEL SECURITY;
CREATE POLICY brands_read ON core.brands FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=brands.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY brands_insert ON core.brands FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=brands.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=brands.tenant_id AND m.role='owner' AND m.active) AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=brands.tenant_id AND p.id=brands.holder_id AND p.status='active'));
REVOKE ALL ON core.brands FROM PUBLIC;
GRANT SELECT,INSERT ON core.brands TO anna_business_runtime;
ALTER TABLE core.franchise_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.franchise_networks FORCE ROW LEVEL SECURITY;
CREATE POLICY franchise_networks_read ON core.franchise_networks FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_networks.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY franchise_networks_insert ON core.franchise_networks FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_networks.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=franchise_networks.tenant_id AND m.role='owner' AND m.active) AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=franchise_networks.tenant_id AND p.id=franchise_networks.franchisor_id AND p.kind='PJ' AND p.status='active'));
REVOKE ALL ON core.franchise_networks FROM PUBLIC;
GRANT SELECT,INSERT ON core.franchise_networks TO anna_business_runtime;
ALTER TABLE core.franchise_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.franchise_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY franchise_relationships_read ON core.franchise_relationships FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_relationships.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY franchise_relationships_insert ON core.franchise_relationships FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_relationships.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=franchise_relationships.tenant_id AND m.role='owner' AND m.active) AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=franchise_relationships.tenant_id AND p.id=franchise_relationships.franchisee_id AND p.kind='PJ' AND p.status='active') AND EXISTS (SELECT 1 FROM core.franchise_networks n JOIN core.parties p ON p.tenant_id=n.tenant_id AND p.id=n.franchisor_id WHERE n.tenant_id=franchise_relationships.tenant_id AND n.id=franchise_relationships.network_id AND n.franchisor_id<>franchise_relationships.franchisee_id AND p.status='active'));
REVOKE ALL ON core.franchise_relationships FROM PUBLIC;
GRANT SELECT,INSERT ON core.franchise_relationships TO anna_business_runtime;
CREATE FUNCTION business.create_brand(p_holder uuid,p_name text,p_registration text,p_request uuid)
RETURNS TABLE(brand_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.brands(tenant_id,holder_id,name,registration_ref,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_holder,btrim(p_name),NULLIF(btrim(p_registration),''),current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'brand',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.create_franchise_network(p_brand uuid,p_franchisor uuid,p_ref text,p_request uuid)
RETURNS TABLE(network_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.franchise_networks(tenant_id,brand_id,franchisor_id,authority_ref,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_brand,p_franchisor,btrim(p_ref),current_setting('anna.actor_id',true)::uuid)
 ON CONFLICT(tenant_id,brand_id,franchisor_id) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'franchise_network',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
-- Executar pela API em transação SERIALIZABLE para impedir sobreposição concorrente.
CREATE FUNCTION business.add_franchise_relationship(p_network uuid,p_franchisee uuid,p_ref text,p_territory text,p_from date,p_until date,p_request uuid)
RETURNS TABLE(relationship_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.franchise_relationships(tenant_id,network_id,franchisee_id,agreement_ref,territory,valid_from,valid_until,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_network,p_franchisee,btrim(p_ref),NULLIF(btrim(p_territory),''),p_from,p_until,current_setting('anna.actor_id',true)::uuid
 WHERE NOT EXISTS (SELECT 1 FROM core.franchise_relationships r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.network_id=p_network AND r.franchisee_id=p_franchisee AND (r.valid_until IS NULL OR r.valid_until>=p_from) AND (p_until IS NULL OR r.valid_from<=p_until))
 ON CONFLICT(tenant_id,network_id,franchisee_id,valid_from) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'franchise_relationship',id,'link',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_brand(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_brand(uuid,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.create_franchise_network(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_franchise_network(uuid,uuid,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.add_franchise_relationship(uuid,uuid,text,text,date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_franchise_relationship(uuid,uuid,text,text,date,date,uuid) TO anna_business_runtime;
