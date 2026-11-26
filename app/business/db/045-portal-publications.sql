-- 045: publicação explícita de uma versão GED para uma única concessão.
CREATE TABLE business.portal_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,grant_id uuid NOT NULL,document_id uuid NOT NULL,version_id uuid NOT NULL,
 company_name text NOT NULL,party_name text NOT NULL,category text NOT NULL,title text NOT NULL,reference text NOT NULL,version_no integer NOT NULL,
 filename text NOT NULL CHECK(length(btrim(filename)) BETWEEN 5 AND 180 AND lower(right(filename,4))='.pdf'),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 5 AND 1048576 AND substring(content FROM 1 FOR 5)=decode('255044462d','hex')),
 size_bytes integer GENERATED ALWAYS AS(octet_length(content)) STORED,sha256_hex text GENERATED ALWAYS AS(encode(sha256(content),'hex')) STORED,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revocation_reason text,revocation_operation_id uuid,
 FOREIGN KEY(tenant_id,grant_id) REFERENCES business.portal_grants(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,version_id) REFERENCES business.document_versions(tenant_id,id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revocation_operation_id),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND revocation_operation_id IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(revocation_reason)) BETWEEN 1 AND 500 AND revocation_operation_id IS NOT NULL))
);
CREATE UNIQUE INDEX portal_publications_one_live ON business.portal_publications(tenant_id,grant_id,version_id) WHERE revoked_at IS NULL;
ALTER TABLE business.portal_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.portal_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_publications_read ON business.portal_publications FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND (EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=portal_publications.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active') OR (current_setting('anna.portal_read',true)='yes' AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM business.portal_grants g JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE g.tenant_id=portal_publications.tenant_id AND g.id=portal_publications.grant_id AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until))));
CREATE POLICY portal_publications_insert ON business.portal_publications FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=portal_publications.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY portal_publications_revoke ON business.portal_publications FOR UPDATE USING(tenant_id::text=current_setting('anna.tenant_id',true) AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=portal_publications.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=portal_publications.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.portal_publications FROM PUBLIC;
GRANT SELECT,INSERT ON business.portal_publications TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revocation_reason,revocation_operation_id) ON business.portal_publications TO anna_business_runtime;
CREATE FUNCTION business.publish_portal_document(p_grant uuid,p_version uuid,p_reason text,p_op uuid)
RETURNS TABLE(publication_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.portal_publications(tenant_id,grant_id,document_id,version_id,company_name,party_name,category,title,reference,version_no,filename,content,reason,operation_id,created_by)
 SELECT g.tenant_id,g.id,d.id,v.id,d.company_name,pa.legal_name,d.category,d.title,d.reference,v.version_no,v.filename,v.content,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.portal_grants g JOIN core.parties pa ON pa.tenant_id=g.tenant_id AND pa.id=g.party_id AND pa.status='active'
 JOIN business.document_versions v ON v.tenant_id=g.tenant_id AND v.id=p_version
 JOIN business.documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id AND d.company_id=g.company_id
 WHERE g.tenant_id=current_setting('anna.tenant_id',true)::uuid AND g.id=p_grant AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until
 AND ((g.portal_role='customer' AND d.party_id=g.party_id AND d.category IN ('commercial','contract','financial','fiscal','operational')) OR (g.portal_role='accountant' AND d.category IN ('fiscal','financial','contract','corporate')))
 AND COALESCE((SELECT sum(p.size_bytes) FROM business.portal_publications p WHERE p.tenant_id=g.tenant_id),0)+v.size_bytes<=16777216
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,sha256_hex,size_bytes
 ), logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'portal_publication',id,'create',p_op,jsonb_build_object('grant_id',p_grant,'version_id',p_version,'sha256',sha256_hex,'size',size_bytes) FROM inserted)
 SELECT id FROM inserted
$$;
CREATE FUNCTION business.revoke_portal_document(p_publication uuid,p_reason text,p_op uuid) RETURNS TABLE(publication_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (UPDATE business.portal_publications p SET revoked_at=now(),revoked_by=current_setting('anna.actor_id',true)::uuid,revocation_reason=btrim(p_reason),revocation_operation_id=p_op WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_publication AND p.revoked_at IS NULL RETURNING p.id,p.tenant_id,p.revoked_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,revoked_by,'portal_publication',id,'update',p_op,jsonb_build_object('status','revoked') FROM changed)
 SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.publish_portal_document(uuid,uuid,text,uuid),business.revoke_portal_document(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.publish_portal_document(uuid,uuid,text,uuid),business.revoke_portal_document(uuid,text,uuid) TO anna_business_runtime;
