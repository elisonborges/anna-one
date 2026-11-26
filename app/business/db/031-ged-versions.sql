-- 031: versões privadas de PDF no Neon, com limites conservadores.
CREATE TABLE business.document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, document_id uuid NOT NULL,
 version_no integer NOT NULL CHECK(version_no BETWEEN 1 AND 100),
 filename text NOT NULL CHECK(length(btrim(filename)) BETWEEN 5 AND 180 AND lower(right(filename,4))='.pdf'),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 5 AND 1048576 AND substring(content FROM 1 FOR 5)=decode('255044462d','hex')),
 size_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED,
 sha256_hex text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,document_id,version_no), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,document_id,sha256_hex)
);
ALTER TABLE business.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY document_versions_read ON business.document_versions FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=document_versions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY document_versions_insert ON business.document_versions FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=document_versions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.document_versions FROM PUBLIC;
GRANT SELECT,INSERT ON business.document_versions TO anna_business_runtime;
CREATE FUNCTION business.create_document_version(p_doc uuid,p_filename text,p_content text,p_note text,p_operation uuid)
RETURNS TABLE(version_id uuid,version_no integer,sha256_hex text) LANGUAGE sql SECURITY INVOKER AS $$
 WITH payload AS MATERIALIZED (SELECT decode(p_content,'base64') AS bytes WHERE length(p_content) BETWEEN 8 AND 1398104),
 inserted AS (
 INSERT INTO business.document_versions(tenant_id,document_id,version_no,filename,content,note,operation_id,created_by)
 SELECT d.tenant_id,d.id,COALESCE((SELECT max(v.version_no) FROM business.document_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id),0)+1,btrim(p_filename),p.bytes,btrim(p_note),p_operation,current_setting('anna.actor_id',true)::uuid
 FROM business.documents d CROSS JOIN payload p WHERE d.tenant_id=current_setting('anna.tenant_id',true)::uuid AND d.id=p_doc
 AND octet_length(p.bytes) BETWEEN 5 AND 1048576 AND substring(p.bytes FROM 1 FOR 5)=decode('255044462d','hex')
 AND COALESCE((SELECT sum(v.size_bytes) FROM business.document_versions v WHERE v.tenant_id=d.tenant_id),0)+octet_length(p.bytes)<=33554432
 AND (SELECT count(*) FROM business.document_versions v WHERE v.tenant_id=d.tenant_id AND v.document_id=d.id)<100
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,document_versions.version_no,document_versions.sha256_hex,size_bytes
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'document_version',id,'create',p_operation,jsonb_build_object('document_id',p_doc,'version',version_no,'sha256',sha256_hex,'size',size_bytes) FROM inserted
 ) SELECT id,version_no,sha256_hex FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_document_version(uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_document_version(uuid,text,text,text,uuid) TO anna_business_runtime;
