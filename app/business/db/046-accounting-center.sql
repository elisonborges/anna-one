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

-- Pendências contábeis individuais; somente o proprietário registra e encerra.
CREATE TABLE business.accounting_pendencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, grant_id uuid NOT NULL,
 competence date NOT NULL CHECK(extract(day from competence)=1),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 1000),
 due_on date, operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz, closed_by uuid REFERENCES public.app_users(id), closure_reason text, closure_operation_id uuid,
 FOREIGN KEY(tenant_id,grant_id) REFERENCES business.portal_grants(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,closure_operation_id),
 CHECK((closed_at IS NULL AND closed_by IS NULL AND closure_reason IS NULL AND closure_operation_id IS NULL) OR
 (closed_at IS NOT NULL AND closed_by IS NOT NULL AND closure_reason IS NOT NULL AND length(btrim(closure_reason)) BETWEEN 1 AND 500 AND closure_operation_id IS NOT NULL))
);
ALTER TABLE business.accounting_pendencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.accounting_pendencies FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_pendencies_read ON business.accounting_pendencies FOR SELECT USING (
 tenant_id::text=current_setting('anna.tenant_id',true) AND
 (EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=accounting_pendencies.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')
 OR (current_setting('anna.portal_read',true)='yes' AND EXISTS(SELECT 1 FROM business.portal_grants g JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE g.tenant_id=accounting_pendencies.tenant_id AND g.id=accounting_pendencies.grant_id AND g.user_id::text=current_setting('anna.actor_id',true) AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until))));
CREATE POLICY accounting_pendencies_insert ON business.accounting_pendencies FOR INSERT WITH CHECK (
 tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND closed_at IS NULL
 AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=accounting_pendencies.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')
 AND EXISTS(SELECT 1 FROM business.portal_grants g WHERE g.tenant_id=accounting_pendencies.tenant_id AND g.id=accounting_pendencies.grant_id AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until));
CREATE POLICY accounting_pendencies_close ON business.accounting_pendencies FOR UPDATE USING (
 tenant_id::text=current_setting('anna.tenant_id',true) AND closed_at IS NULL AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=accounting_pendencies.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK (
 tenant_id::text=current_setting('anna.tenant_id',true) AND closed_at IS NOT NULL AND closed_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=accounting_pendencies.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.accounting_pendencies FROM PUBLIC;
GRANT SELECT,INSERT ON business.accounting_pendencies TO anna_business_runtime;
GRANT UPDATE(closed_at,closed_by,closure_reason,closure_operation_id) ON business.accounting_pendencies TO anna_business_runtime;
CREATE FUNCTION business.create_accounting_pendency(p_grant uuid,p_competence date,p_title text,p_description text,p_due date,p_op uuid) RETURNS TABLE(pendency_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (INSERT INTO business.accounting_pendencies(tenant_id,grant_id,competence,title,description,due_on,operation_id,created_by)
 SELECT g.tenant_id,g.id,p_competence,btrim(p_title),btrim(p_description),p_due,p_op,current_setting('anna.actor_id',true)::uuid FROM business.portal_grants g WHERE g.tenant_id=current_setting('anna.tenant_id',true)::uuid AND g.id=p_grant AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'accounting_pendency',id,'create',p_op,jsonb_build_object('grant_id',p_grant,'competence',p_competence) FROM inserted) SELECT id FROM inserted
$$;
CREATE FUNCTION business.close_accounting_pendency(p_id uuid,p_reason text,p_op uuid) RETURNS TABLE(pendency_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (UPDATE business.accounting_pendencies p SET closed_at=now(),closed_by=current_setting('anna.actor_id',true)::uuid,closure_reason=btrim(p_reason),closure_operation_id=p_op WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_id AND p.closed_at IS NULL RETURNING id,tenant_id,closed_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,closed_by,'accounting_pendency',id,'update',p_op,jsonb_build_object('status','closed') FROM changed) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_accounting_pendency(uuid,date,text,text,date,uuid),business.close_accounting_pendency(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_accounting_pendency(uuid,date,text,text,date,uuid),business.close_accounting_pendency(uuid,text,uuid) TO anna_business_runtime;

COMMIT;
