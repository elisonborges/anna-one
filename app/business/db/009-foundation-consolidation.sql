-- 009: manutenção cadastral, encerramentos com histórico e leitura restrita de auditoria.
-- Identificadores, documentos, códigos, criadores e estrutura jurídica permanecem imutáveis.
CREATE POLICY parties_maintenance_update ON core.parties FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=parties.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=parties.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE (legal_name,display_name) ON core.parties TO anna_business_runtime;
CREATE POLICY establishments_maintenance_update ON core.establishments FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=establishments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=establishments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE (name) ON core.establishments TO anna_business_runtime;
CREATE POLICY institution_links_maintenance_update ON core.institution_links FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=institution_links.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=institution_links.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE (valid_until) ON core.institution_links TO anna_business_runtime;
CREATE POLICY company_contacts_maintenance_update ON core.company_contacts FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=company_contacts.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=company_contacts.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE (valid_until) ON core.company_contacts TO anna_business_runtime;
CREATE POLICY franchise_relationships_maintenance_update ON core.franchise_relationships FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_relationships.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=franchise_relationships.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE (valid_until) ON core.franchise_relationships TO anna_business_runtime;
GRANT SELECT ON business.audit_events TO anna_business_runtime;
CREATE FUNCTION business.update_party_name(p_id uuid,p_old_name text,p_old_display text,p_name text,p_display text,p_request uuid)
RETURNS TABLE(party_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT id,tenant_id,legal_name,display_name FROM core.parties
 WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id
 AND legal_name=p_old_name AND display_name IS NOT DISTINCT FROM p_old_display
 AND (legal_name IS DISTINCT FROM btrim(p_name) OR display_name IS DISTINCT FROM NULLIF(btrim(p_display),''))
 ), changed AS (
 UPDATE core.parties x SET legal_name=btrim(p_name),display_name=NULLIF(btrim(p_display),'')
 FROM previous p WHERE x.id=p.id AND x.tenant_id=p.tenant_id
 RETURNING x.id,x.tenant_id,x.legal_name,x.display_name,p.legal_name AS old_name,p.display_name AS old_display
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'party',id,'update',p_request,jsonb_build_object('old_name',old_name,'new_name',legal_name,'old_display',old_display,'new_display',display_name) FROM changed
 ) SELECT id FROM changed
$$;
CREATE FUNCTION business.update_establishment_name(p_id uuid,p_old_name text,p_name text,p_request uuid)
RETURNS TABLE(establishment_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT id,tenant_id,name FROM core.establishments WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND name=p_old_name AND name IS DISTINCT FROM btrim(p_name)
 ), changed AS (
 UPDATE core.establishments x SET name=btrim(p_name) FROM previous p WHERE x.id=p.id AND x.tenant_id=p.tenant_id
 RETURNING x.id,x.tenant_id,x.name,p.name AS old_name
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'establishment',id,'update',p_request,jsonb_build_object('old_name',old_name,'new_name',name) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.update_party_name(uuid,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.update_establishment_name(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.update_party_name(uuid,text,text,text,text,uuid) TO anna_business_runtime;
GRANT EXECUTE ON FUNCTION business.update_establishment_name(uuid,text,text,uuid) TO anna_business_runtime;
-- Encerramento usa o último dia de vigência informado pelo usuário.
-- institution_links tem fim exclusivo, contatos e franquias têm fim inclusivo.
-- Nunca reabrir ou estender uma vigência por este comando.
-- Usar transação SERIALIZABLE pela API. Não excluir registros.
CREATE FUNCTION business.close_institution_link(p_id uuid,p_last_day date,p_reason text,p_request uuid,p_scope uuid[])
RETURNS TABLE(closed_id uuid,valid_until date) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT x.id,x.tenant_id,x.valid_until FROM core.institution_links x WHERE x.tenant_id=current_setting('anna.tenant_id',true)::uuid AND x.id=p_id AND x.institution_id=ANY(p_scope)
 AND p_last_day>=x.valid_from AND p_last_day<='9999-12-30'::date AND (x.valid_until IS NULL OR p_last_day+1<x.valid_until)
 AND length(btrim(p_reason)) BETWEEN 1 AND 300
 ), changed AS (
 UPDATE core.institution_links x SET valid_until=p_last_day+1 FROM previous p WHERE x.id=p.id AND x.tenant_id=p.tenant_id
 RETURNING x.id,x.tenant_id,x.valid_until,p.valid_until AS old_until
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'institution_link',id,'unlink',p_request,jsonb_build_object('old_valid_until',old_until,'new_valid_until',valid_until,'last_day',p_last_day,'reason',btrim(p_reason)) FROM changed
 ) SELECT id,valid_until FROM changed
$$;
REVOKE ALL ON FUNCTION business.close_institution_link(uuid,date,text,uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.close_institution_link(uuid,date,text,uuid,uuid[]) TO anna_business_runtime;
CREATE FUNCTION business.close_company_contact(p_id uuid,p_last_day date,p_reason text,p_request uuid)
RETURNS TABLE(closed_id uuid,valid_until date) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT x.id,x.tenant_id,x.valid_until FROM core.company_contacts x WHERE x.tenant_id=current_setting('anna.tenant_id',true)::uuid AND x.id=p_id 
 AND p_last_day>=x.valid_from AND p_last_day<='9999-12-30'::date AND (x.valid_until IS NULL OR p_last_day<x.valid_until)
 AND length(btrim(p_reason)) BETWEEN 1 AND 300
 ), changed AS (
 UPDATE core.company_contacts x SET valid_until=p_last_day FROM previous p WHERE x.id=p.id AND x.tenant_id=p.tenant_id
 RETURNING x.id,x.tenant_id,x.valid_until,p.valid_until AS old_until
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'company_contact',id,'unlink',p_request,jsonb_build_object('old_valid_until',old_until,'new_valid_until',valid_until,'last_day',p_last_day,'reason',btrim(p_reason)) FROM changed
 ) SELECT id,valid_until FROM changed
$$;
REVOKE ALL ON FUNCTION business.close_company_contact(uuid,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.close_company_contact(uuid,date,text,uuid) TO anna_business_runtime;
CREATE FUNCTION business.close_franchise_relationship(p_id uuid,p_last_day date,p_reason text,p_request uuid)
RETURNS TABLE(closed_id uuid,valid_until date) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT x.id,x.tenant_id,x.valid_until FROM core.franchise_relationships x WHERE x.tenant_id=current_setting('anna.tenant_id',true)::uuid AND x.id=p_id 
 AND p_last_day>=x.valid_from AND p_last_day<='9999-12-30'::date AND (x.valid_until IS NULL OR p_last_day<x.valid_until)
 AND length(btrim(p_reason)) BETWEEN 1 AND 300
 ), changed AS (
 UPDATE core.franchise_relationships x SET valid_until=p_last_day FROM previous p WHERE x.id=p.id AND x.tenant_id=p.tenant_id
 RETURNING x.id,x.tenant_id,x.valid_until,p.valid_until AS old_until
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'franchise_relationship',id,'unlink',p_request,jsonb_build_object('old_valid_until',old_until,'new_valid_until',valid_until,'last_day',p_last_day,'reason',btrim(p_reason)) FROM changed
 ) SELECT id,valid_until FROM changed
$$;
REVOKE ALL ON FUNCTION business.close_franchise_relationship(uuid,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.close_franchise_relationship(uuid,date,text,uuid) TO anna_business_runtime;
