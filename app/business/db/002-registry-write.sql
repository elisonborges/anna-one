-- 002 / Escrita cadastral mínima. Não executar sem 001 e autorização de implantação.
-- O papel de runtime deverá ser dedicado, não proprietário e sem BYPASSRLS.
CREATE POLICY parties_insert ON core.parties FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=parties.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY establishments_insert ON core.establishments FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=establishments.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY party_roles_insert ON business.party_roles FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=party_roles.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.status='active'));
CREATE POLICY companies_insert ON business.companies FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=companies.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.status='active'));
CREATE POLICY audit_events_insert ON business.audit_events FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=audit_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.status='active') AND actor_id::text=current_setting('anna.actor_id',true));
-- Impedir leitura de registros de tenants encerrados/suspensos por papel de aplicação.
CREATE POLICY parties_active_tenant ON core.parties AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=parties.tenant_id AND t.status='active'));
CREATE POLICY establishments_active_tenant ON core.establishments AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=establishments.tenant_id AND t.status='active'));
CREATE POLICY party_roles_active_tenant ON business.party_roles AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=party_roles.tenant_id AND t.status='active'));
CREATE POLICY companies_active_tenant ON business.companies AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=companies.tenant_id AND t.status='active'));
CREATE POLICY institution_links_active_tenant ON core.institution_links AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=institution_links.tenant_id AND t.status='active'));
CREATE POLICY audit_events_active_tenant ON business.audit_events AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenants t WHERE t.id=audit_events.tenant_id AND t.status='active'));
CREATE POLICY audit_owner_read ON business.audit_events AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=audit_events.tenant_id AND m.role='owner' AND m.active));
-- Comando de criação. Todos os efeitos são atômicos. UUID de requisição registrado.
-- O backend deve estabelecer anna.actor_id e anna.tenant_id por transação a partir
-- da sessão verificada e do escopo autorizado, nunca diretamente do corpo da requisição.
CREATE FUNCTION business.create_party(p_kind text,p_name text,p_display text,p_cpf text,p_root text,p_request uuid)
RETURNS TABLE(party_id uuid,party_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.parties(tenant_id,kind,legal_name,display_name,cpf,cnpj_root,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_kind,btrim(p_name),NULLIF(btrim(p_display),''),NULLIF(p_cpf,''),NULLIF(p_root,''),current_setting('anna.actor_id',true)::uuid)
 RETURNING id,code,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'party',id,'create',p_request FROM inserted
 )
 SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.create_establishment(p_party uuid,p_cnpj text,p_name text,p_kind text,p_request uuid)
RETURNS TABLE(establishment_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.establishments(tenant_id,party_id,cnpj_root,cnpj,name,kind,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_party,left(p_cnpj,8),p_cnpj,btrim(p_name),p_kind,current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'establishment',id,'create',p_request FROM inserted
 )
 SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_party(text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.create_establishment(uuid,text,text,text,uuid) FROM PUBLIC;
-- Sem concessões de runtime, provisionamento ou alterações de public.*.
-- O vínculo com instituições será escrito somente por API que valide também o escopo operacional.
