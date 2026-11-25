-- 004: vínculos institucionais do ambiente interno, sem alteração em public.
GRANT SELECT, INSERT ON core.institution_links TO anna_business_runtime;
CREATE POLICY institution_links_owner_insert ON core.institution_links FOR INSERT WITH CHECK (
 tenant_id::text=current_setting('anna.tenant_id',true)
 AND created_by::text=current_setting('anna.actor_id',true)
 AND valid_from=CURRENT_DATE AND valid_until IS NULL
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=institution_links.tenant_id AND m.role='owner' AND m.active AND t.kind='internal' AND t.status='active')
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=institution_links.tenant_id AND p.id=institution_links.party_id AND p.kind='PJ' AND p.status='active')
 AND (establishment_id IS NULL OR EXISTS (SELECT 1 FROM core.establishments e WHERE e.tenant_id=institution_links.tenant_id AND e.id=institution_links.establishment_id AND e.party_id=institution_links.party_id AND e.status='active'))
);
CREATE FUNCTION business.link_institution(p_institution uuid,p_party uuid,p_establishment uuid,p_request uuid)
RETURNS TABLE(link_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.institution_links(tenant_id,institution_id,party_id,establishment_id,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_institution,p_party,p_establishment,current_setting('anna.actor_id',true)::uuid
 WHERE NOT EXISTS (SELECT 1 FROM core.institution_links l WHERE l.tenant_id=current_setting('anna.tenant_id',true)::uuid AND l.institution_id=p_institution AND (l.valid_until IS NULL OR l.valid_until>CURRENT_DATE))
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'institution_link',id,'link',p_request FROM inserted
 )
 SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.link_institution(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.link_institution(uuid,uuid,uuid,uuid) TO anna_business_runtime;
-- A API deve verificar a instituição no Master com o mesmo JWT.
-- Apenas criação de vínculo vigente e consulta. Encerramento e retificação virão em incremento posterior.
