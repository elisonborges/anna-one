-- 033: registro declaratório de documentos fiscais já emitidos externamente.
CREATE TABLE business.fiscal_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, establishment_id uuid NOT NULL,
 fiscal_profile_id uuid NOT NULL, document_id uuid NOT NULL, counterparty_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('incoming','outgoing')),
 kind text NOT NULL CHECK(kind IN ('nfe','nfse','nfce','cte','other')),
 number text NOT NULL CHECK(length(btrim(number)) BETWEEN 1 AND 60),
 series text NOT NULL CHECK(length(btrim(series)) BETWEEN 1 AND 40),
 external_key text CHECK(external_key IS NULL OR length(btrim(external_key)) BETWEEN 1 AND 120),
 issued_on date NOT NULL, total numeric(18,2) NOT NULL CHECK(total>=0),
 declared_status text NOT NULL CHECK(declared_status IN ('issued','cancelled','other')),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 FOREIGN KEY(tenant_id,fiscal_profile_id) REFERENCES business.fiscal_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,counterparty_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,document_id),
 CHECK(company_id<>counterparty_id)
);
CREATE UNIQUE INDEX fiscal_documents_identity ON business.fiscal_documents(tenant_id,establishment_id,direction,kind,number,series,(CASE WHEN direction='incoming' THEN counterparty_id ELSE company_id END));
CREATE UNIQUE INDEX fiscal_documents_key ON business.fiscal_documents(tenant_id,external_key) WHERE external_key IS NOT NULL AND kind IN ('nfe','nfce','cte');
ALTER TABLE business.fiscal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.fiscal_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_documents_read ON business.fiscal_documents FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_documents.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY fiscal_documents_insert ON business.fiscal_documents FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_documents.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.fiscal_documents FROM PUBLIC;
GRANT SELECT,INSERT ON business.fiscal_documents TO anna_business_runtime;
CREATE FUNCTION business.create_fiscal_document(p_establishment uuid,p_doc uuid,p_counterparty uuid,p_direction text,p_kind text,p_number text,p_series text,p_key text,p_issued date,p_total numeric,p_status text,p_source text,p_op uuid)
RETURNS TABLE(fiscal_document_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.fiscal_documents(tenant_id,company_id,establishment_id,fiscal_profile_id,document_id,counterparty_id,direction,kind,number,series,external_key,issued_on,total,declared_status,source_reference,operation_id,created_by)
 SELECT d.tenant_id,d.company_id,e.id,f.id,d.id,p.id,p_direction,p_kind,btrim(p_number),btrim(p_series),NULLIF(btrim(p_key),''),p_issued,p_total,p_status,btrim(p_source),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.documents d JOIN core.establishments e ON e.tenant_id=d.tenant_id AND e.party_id=d.company_id AND e.id=p_establishment
 JOIN core.parties p ON p.tenant_id=d.tenant_id AND p.id=p_counterparty AND p.status='active'
 JOIN LATERAL (SELECT id FROM business.fiscal_profiles f WHERE f.tenant_id=d.tenant_id AND f.establishment_id=e.id AND f.effective_on<=p_issued ORDER BY f.effective_on DESC LIMIT 1) f ON true
 WHERE d.tenant_id=current_setting('anna.tenant_id',true)::uuid AND d.id=p_doc AND d.category='fiscal' AND d.company_id<>p.id
 AND (d.party_id IS NULL OR d.party_id=p.id) AND (d.issued_on IS NULL OR d.issued_on=p_issued)
 AND p_issued<=(now() AT TIME ZONE 'America/Fortaleza')::date AND p_total BETWEEN 0 AND 9999999999999999.99 AND p_total=round(p_total,2)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'fiscal_document',id,'create',p_op,jsonb_build_object('document_id',p_doc,'kind',p_kind,'direction',p_direction) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_fiscal_document(uuid,uuid,uuid,text,text,text,text,text,date,numeric,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_fiscal_document(uuid,uuid,uuid,text,text,text,text,text,date,numeric,text,text,uuid) TO anna_business_runtime;
