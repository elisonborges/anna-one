-- 034: agenda fiscal declarada, sem cálculo, transmissão ou pagamento.
CREATE TABLE business.fiscal_obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, establishment_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('tax','declaration','certificate','registration','other')),
 period text NOT NULL CHECK(length(btrim(period)) BETWEEN 1 AND 60),
 due_on date NOT NULL, source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 document_id uuid, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','cancelled')),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 closed_on date, closed_by uuid REFERENCES public.app_users(id), closure_note text, evidence_id uuid, closure_operation_id uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,establishment_id,company_id) REFERENCES core.establishments(tenant_id,id,party_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES business.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES business.documents(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,closure_operation_id),
 UNIQUE(tenant_id,establishment_id,kind,title,period),
 CHECK((status='pending' AND closed_on IS NULL AND closed_by IS NULL AND closure_note IS NULL AND evidence_id IS NULL AND closure_operation_id IS NULL) OR
 (status IN ('fulfilled','cancelled') AND closed_on IS NOT NULL AND closed_by IS NOT NULL AND closure_note IS NOT NULL AND length(btrim(closure_note)) BETWEEN 1 AND 1000 AND closure_operation_id IS NOT NULL))
);
ALTER TABLE business.fiscal_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.fiscal_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_obligations_read ON business.fiscal_obligations FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_obligations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY fiscal_obligations_insert ON business.fiscal_obligations FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND status='pending' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_obligations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY fiscal_obligations_close ON business.fiscal_obligations FOR UPDATE USING(tenant_id::text=current_setting('anna.tenant_id',true) AND status='pending' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_obligations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND status IN ('fulfilled','cancelled') AND closed_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=fiscal_obligations.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.fiscal_obligations FROM PUBLIC;
GRANT SELECT,INSERT ON business.fiscal_obligations TO anna_business_runtime;
GRANT UPDATE(status,closed_on,closed_by,closure_note,evidence_id,closure_operation_id) ON business.fiscal_obligations TO anna_business_runtime;
CREATE INDEX fiscal_obligations_due ON business.fiscal_obligations(tenant_id,status,due_on);
CREATE FUNCTION business.create_fiscal_obligation(p_est uuid,p_title text,p_kind text,p_period text,p_due date,p_source text,p_doc uuid,p_op uuid)
RETURNS TABLE(obligation_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.fiscal_obligations(tenant_id,company_id,establishment_id,title,kind,period,due_on,source_reference,document_id,operation_id,created_by)
 SELECT e.tenant_id,e.party_id,e.id,btrim(p_title),p_kind,btrim(p_period),p_due,btrim(p_source),p_doc,p_op,current_setting('anna.actor_id',true)::uuid
 FROM core.establishments e JOIN business.companies c ON c.tenant_id=e.tenant_id AND c.party_id=e.party_id JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id AND p.status='active'
 WHERE e.tenant_id=current_setting('anna.tenant_id',true)::uuid AND e.id=p_est AND e.status='active'
 AND (p_doc IS NULL OR EXISTS(SELECT 1 FROM business.documents d WHERE d.tenant_id=e.tenant_id AND d.id=p_doc AND d.company_id=e.party_id AND d.category='fiscal'))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'fiscal_obligation',id,'create',p_op,jsonb_build_object('establishment_id',p_est,'due_on',p_due,'kind',p_kind) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.close_fiscal_obligation(p_id uuid,p_status text,p_date date,p_note text,p_evidence uuid,p_op uuid)
RETURNS TABLE(obligation_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.fiscal_obligations o SET status=p_status,closed_on=p_date,closed_by=current_setting('anna.actor_id',true)::uuid,closure_note=btrim(p_note),evidence_id=p_evidence,closure_operation_id=p_op
 WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_id AND o.status='pending' AND p_status IN ('fulfilled','cancelled')
 AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND length(btrim(p_note)) BETWEEN 1 AND 1000
 AND (p_evidence IS NULL OR EXISTS(SELECT 1 FROM business.documents d WHERE d.tenant_id=o.tenant_id AND d.id=p_evidence AND d.company_id=o.company_id AND d.category='fiscal'))
 RETURNING o.id,o.tenant_id,o.closed_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,closed_by,'fiscal_obligation',id,'update',p_op,jsonb_build_object('status',p_status,'closed_on',p_date,'evidence_id',p_evidence) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_fiscal_obligation(uuid,text,text,text,date,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.close_fiscal_obligation(uuid,text,date,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_fiscal_obligation(uuid,text,text,text,date,text,uuid,uuid) TO anna_business_runtime;
GRANT EXECUTE ON FUNCTION business.close_fiscal_obligation(uuid,text,date,text,uuid,uuid) TO anna_business_runtime;
