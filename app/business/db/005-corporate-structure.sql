-- 005: grupos empresariais e supervisão administrativa operacional.
-- Cadastro exclusivamente interno nesta etapa. Grupos do Master não são alterados.
CREATE TABLE core.corporate_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX corporate_groups_name_unique ON core.corporate_groups(tenant_id,lower(btrim(name)));
CREATE TABLE core.corporate_group_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 group_id uuid NOT NULL,
 party_id uuid NOT NULL,
 membership_kind text NOT NULL CHECK(membership_kind IN ('member','coordinator')),
 valid_from date NOT NULL DEFAULT CURRENT_DATE,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,group_id) REFERENCES core.corporate_groups(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,group_id,party_id)
);
CREATE TABLE core.institution_admin_relations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 supervisor_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
 subordinate_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
 autonomy text NOT NULL CHECK(autonomy IN ('delegated','centralized')),
 valid_from date NOT NULL DEFAULT CURRENT_DATE,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(supervisor_id<>subordinate_id),
 UNIQUE(tenant_id,subordinate_id)
);
ALTER TABLE core.corporate_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.corporate_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY corporate_groups_read ON core.corporate_groups FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=corporate_groups.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY corporate_groups_insert ON core.corporate_groups FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=corporate_groups.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=corporate_groups.tenant_id AND m.role='owner' AND m.active));
REVOKE ALL ON core.corporate_groups FROM PUBLIC;
GRANT SELECT,INSERT ON core.corporate_groups TO anna_business_runtime;
ALTER TABLE core.corporate_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.corporate_group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY corporate_group_members_read ON core.corporate_group_members FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=corporate_group_members.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY corporate_group_members_insert ON core.corporate_group_members FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=corporate_group_members.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=corporate_group_members.tenant_id AND m.role='owner' AND m.active) AND valid_from=CURRENT_DATE AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=corporate_group_members.tenant_id AND p.id=corporate_group_members.party_id AND p.kind='PJ' AND p.status='active'));
REVOKE ALL ON core.corporate_group_members FROM PUBLIC;
GRANT SELECT,INSERT ON core.corporate_group_members TO anna_business_runtime;
ALTER TABLE core.institution_admin_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.institution_admin_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY institution_admin_relations_read ON core.institution_admin_relations FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=institution_admin_relations.tenant_id AND m.active AND t.kind='internal' AND t.status='active'));
CREATE POLICY institution_admin_relations_insert ON core.institution_admin_relations FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=institution_admin_relations.tenant_id AND m.active AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=institution_admin_relations.tenant_id AND m.role='owner' AND m.active) AND valid_from=CURRENT_DATE);
REVOKE ALL ON core.institution_admin_relations FROM PUBLIC;
GRANT SELECT,INSERT ON core.institution_admin_relations TO anna_business_runtime;
CREATE FUNCTION business.create_corporate_group(p_name text,p_request uuid)
RETURNS TABLE(group_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.corporate_groups(tenant_id,name,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,btrim(p_name),current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'corporate_group',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.add_corporate_member(p_group uuid,p_party uuid,p_kind text,p_request uuid)
RETURNS TABLE(member_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.corporate_group_members(tenant_id,group_id,party_id,membership_kind,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_group,p_party,p_kind,current_setting('anna.actor_id',true)::uuid)
 ON CONFLICT(tenant_id,group_id,party_id) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'corporate_group_member',id,'link',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
-- O comando de supervisão deve ser executado em transação SERIALIZABLE.
-- O isolamento evita ciclos concorrentes entre chamadas da API.
CREATE FUNCTION business.add_admin_relation(p_supervisor uuid,p_subordinate uuid,p_autonomy text,p_request uuid)
RETURNS TABLE(relation_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH RECURSIVE descendants(id) AS (
 SELECT p_subordinate UNION
 SELECT r.subordinate_id FROM core.institution_admin_relations r JOIN descendants d ON r.supervisor_id=d.id
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid
 ), inserted AS (
 INSERT INTO core.institution_admin_relations(tenant_id,supervisor_id,subordinate_id,autonomy,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_supervisor,p_subordinate,p_autonomy,current_setting('anna.actor_id',true)::uuid
 WHERE NOT EXISTS(SELECT 1 FROM descendants WHERE id=p_supervisor)
 ON CONFLICT(tenant_id,subordinate_id) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'institution_admin_relation',id,'link',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_corporate_group(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_corporate_group(text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.add_corporate_member(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_corporate_member(uuid,uuid,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.add_admin_relation(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_admin_relation(uuid,uuid,text,uuid) TO anna_business_runtime;
