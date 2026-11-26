-- 046: metadados contábeis explícitos; publicações anteriores permanecem válidas.
BEGIN;
ALTER TABLE business.portal_publications ADD COLUMN accounting_competence date, ADD COLUMN accounting_kind text,
 ADD CONSTRAINT portal_accounting_metadata CHECK ((accounting_competence IS NULL AND accounting_kind IS NULL) OR (accounting_competence IS NOT NULL AND extract(day from accounting_competence)=1 AND accounting_kind IS NOT NULL AND accounting_kind IN ('document','statement','reconciliation','pending')));
CREATE FUNCTION business.publish_accounting_document(p_grant uuid,p_version uuid,p_reason text,p_op uuid,p_competence date,p_kind text)
RETURNS TABLE(publication_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.portal_publications(tenant_id,grant_id,document_id,version_id,company_name,party_name,category,title,reference,version_no,filename,content,reason,operation_id,created_by,accounting_competence,accounting_kind)
 SELECT g.tenant_id,g.id,d.id,v.id,d.company_name,pa.legal_name,d.category,d.title,d.reference,v.version_no,v.filename,v.content,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid,p_competence,p_kind
 FROM business.portal_grants g JOIN core.parties pa ON pa.tenant_id=g.tenant_id AND pa.id=g.party_id AND pa.status='active'
 JOIN business.document_versions v ON v.tenant_id=g.tenant_id AND v.id=p_version
 JOIN business.documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id AND d.company_id=g.company_id
 WHERE g.tenant_id=current_setting('anna.tenant_id',true)::uuid AND g.id=p_grant AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until
 AND g.portal_role='accountant' AND p_competence IS NOT NULL AND extract(day from p_competence)=1 AND p_kind IN ('document','statement','reconciliation','pending') AND ((g.portal_role='customer' AND d.party_id=g.party_id AND d.category IN ('commercial','contract','financial','fiscal','operational')) OR (g.portal_role='accountant' AND d.category IN ('fiscal','financial','contract','corporate')))
 AND COALESCE((SELECT sum(p.size_bytes) FROM business.portal_publications p WHERE p.tenant_id=g.tenant_id),0)+v.size_bytes<=16777216
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,sha256_hex,size_bytes
 ), logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'portal_publication',id,'create',p_op,jsonb_build_object('grant_id',p_grant,'version_id',p_version,'sha256',sha256_hex,'size',size_bytes,'competence',p_competence,'kind',p_kind) FROM inserted)
 SELECT id FROM inserted
$$;

REVOKE ALL ON FUNCTION business.publish_accounting_document(uuid,uuid,text,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.publish_accounting_document(uuid,uuid,text,uuid,date,text) TO anna_business_runtime;
COMMIT;
