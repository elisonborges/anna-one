-- 030: fundação GED, cadastro de metadados privados sem armazenamento de arquivos.
CREATE TABLE business.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES business.tenants(id),
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE, company_id uuid NOT NULL, party_id uuid,
 company_name text NOT NULL, party_name text, category text NOT NULL CHECK(category IN ('corporate','commercial','contract','financial','fiscal','operational','other')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 issued_on date, expires_on date, notes text CHECK(notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 CHECK((party_id IS NULL)=(party_name IS NULL)), CHECK(expires_on IS NULL OR issued_on IS NULL OR expires_on>=issued_on),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,company_id,category,reference)
);
ALTER TABLE business.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_read ON business.documents FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=documents.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY documents_insert ON business.documents FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=documents.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.documents FROM PUBLIC;
GRANT SELECT,INSERT ON business.documents TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.documents_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_document(p_company uuid,p_party uuid,p_category text,p_title text,p_ref text,p_issued date,p_expires date,p_notes text,p_op uuid)
RETURNS TABLE(document_id uuid,document_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.documents(tenant_id,company_id,party_id,company_name,party_name,category,title,reference,issued_on,expires_on,notes,operation_id,created_by)
 SELECT b.tenant_id,b.party_id,p_party,c.legal_name,p.legal_name,p_category,btrim(p_title),btrim(p_ref),p_issued,p_expires,NULLIF(btrim(p_notes),''),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.companies b JOIN core.parties c ON c.tenant_id=b.tenant_id AND c.id=b.party_id AND c.status='active'
 LEFT JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=p_party AND p.status='active'
 JOIN business.tenant_memberships m ON m.tenant_id=b.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner'
 WHERE b.tenant_id=current_setting('anna.tenant_id',true)::uuid AND b.party_id=p_company AND (p_party IS NULL OR p.id IS NOT NULL)
 AND (p_issued IS NULL OR p_issued<=(now() AT TIME ZONE 'America/Fortaleza')::date)
 AND (p_expires IS NULL OR p_issued IS NULL OR p_expires>=p_issued)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,code,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'document',id,'create',p_op,jsonb_build_object('category',p_category,'code',code) FROM inserted
 ) SELECT id,code FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_document(uuid,uuid,text,text,text,date,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_document(uuid,uuid,text,text,text,date,date,text,uuid) TO anna_business_runtime;
