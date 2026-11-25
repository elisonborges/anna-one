-- 007: contatos funcionais e representantes declarados de pessoas jurídicas.
CREATE TABLE core.company_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,
 person_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('commercial','administrative','financial','technical','legal_contact','legal_representative','attorney')),
 job_title text CHECK(job_title IS NULL OR length(btrim(job_title)) BETWEEN 1 AND 120),
 email text CHECK(email IS NULL OR (length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
 phone text CHECK(phone IS NULL OR (length(phone) BETWEEN 7 AND 40 AND phone ~ '^[+0-9() .-]+$' AND length(regexp_replace(phone,'[^0-9]','','g')) BETWEEN 7 AND 15)),
 document_ref text CHECK(document_ref IS NULL OR length(btrim(document_ref)) BETWEEN 1 AND 200),
 authority_scope text CHECK(authority_scope IS NULL OR length(btrim(authority_scope)) BETWEEN 1 AND 500),
 valid_from date NOT NULL,
 valid_until date,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 CHECK(role NOT IN ('legal_representative','attorney') OR (document_ref IS NOT NULL AND authority_scope IS NOT NULL)),
 CHECK(role IN ('legal_representative','attorney') OR (document_ref IS NULL AND authority_scope IS NULL)),
 FOREIGN KEY(tenant_id,company_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,person_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,company_id,person_id,role,valid_from)
);
CREATE INDEX company_contacts_lookup ON core.company_contacts(tenant_id,company_id,person_id,role);
ALTER TABLE core.company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.company_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY company_contacts_read ON core.company_contacts FOR SELECT USING (
 tenant_id::text=current_setting('anna.tenant_id',true)
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=company_contacts.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')
);
CREATE POLICY company_contacts_insert ON core.company_contacts FOR INSERT WITH CHECK (
 tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true)
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=company_contacts.tenant_id AND m.active AND (m.role='owner' OR (m.role='registry_editor' AND company_contacts.role NOT IN ('legal_representative','attorney'))) AND t.kind='internal' AND t.status='active')
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=company_contacts.tenant_id AND p.id=company_contacts.company_id AND p.kind='PJ' AND p.status='active')
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=company_contacts.tenant_id AND p.id=company_contacts.person_id AND p.kind='PF' AND p.status='active')
);
REVOKE ALL ON core.company_contacts FROM PUBLIC;
GRANT SELECT,INSERT ON core.company_contacts TO anna_business_runtime;
-- Executar em transação SERIALIZABLE pela API para impedir vigências sobrepostas concorrentes.
CREATE FUNCTION business.add_company_contact(p_company uuid,p_person uuid,p_role text,p_title text,p_email text,p_phone text,p_ref text,p_scope text,p_from date,p_until date,p_request uuid)
RETURNS TABLE(contact_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO core.company_contacts(tenant_id,company_id,person_id,role,job_title,email,phone,document_ref,authority_scope,valid_from,valid_until,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_company,p_person,p_role,NULLIF(btrim(p_title),''),NULLIF(btrim(p_email),''),NULLIF(btrim(p_phone),''),NULLIF(btrim(p_ref),''),NULLIF(btrim(p_scope),''),p_from,p_until,current_setting('anna.actor_id',true)::uuid
 WHERE NOT EXISTS (SELECT 1 FROM core.company_contacts c WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.company_id=p_company AND c.person_id=p_person AND c.role=p_role AND (c.valid_until IS NULL OR c.valid_until>=p_from) AND (p_until IS NULL OR c.valid_from<=p_until))
 ON CONFLICT(tenant_id,company_id,person_id,role,valid_from) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'company_contact',id,'link',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.add_company_contact(uuid,uuid,text,text,text,text,text,text,date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_company_contact(uuid,uuid,text,text,text,text,text,text,date,date,uuid) TO anna_business_runtime;
