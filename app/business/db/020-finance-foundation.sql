-- 020: obrigações financeiras explícitas e parcelas em BRL.
CREATE TABLE business.financial_obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 direction text NOT NULL CHECK(direction IN ('receivable','payable')),
 company_id uuid NOT NULL,
 counterparty_id uuid NOT NULL,
 company_name text NOT NULL,
 counterparty_name text NOT NULL,
 contract_id uuid,
 contract_revision integer,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 issued_on date NOT NULL,
 first_due date NOT NULL CHECK(first_due>=issued_on),
 installment_count integer NOT NULL CHECK(installment_count BETWEEN 1 AND 24),
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,counterparty_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id) ON DELETE RESTRICT,
 CHECK(company_id<>counterparty_id),
 CHECK((contract_id IS NULL AND contract_revision IS NULL) OR (contract_id IS NOT NULL AND contract_revision IS NOT NULL AND contract_revision>=1 AND direction='receivable')),
 CHECK(amount*100>=installment_count),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,request_id)
);
CREATE UNIQUE INDEX financial_obligations_one_contract ON business.financial_obligations(tenant_id,contract_id) WHERE contract_id IS NOT NULL;
CREATE TABLE business.financial_installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 obligation_id uuid NOT NULL,
 installment_no integer NOT NULL CHECK(installment_no BETWEEN 1 AND 24),
 due_on date NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'open' CHECK(status='open'),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,obligation_id,installment_no),
 UNIQUE(tenant_id,id)
);
CREATE INDEX financial_installments_due ON business.financial_installments(tenant_id,due_on,status);
ALTER TABLE business.financial_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_obligations_read ON business.financial_obligations FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_obligations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_obligations_insert ON business.financial_obligations FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_obligations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_obligations FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_obligations TO anna_business_runtime;
ALTER TABLE business.financial_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_installments FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_installments_read ON business.financial_installments FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_installments.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_installments_insert ON business.financial_installments FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_installments.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND status='open');
REVOKE ALL ON business.financial_installments FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_installments TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.financial_obligations_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_financial_obligation(p_direction text,p_company uuid,p_counterparty uuid,p_contract uuid,p_revision integer,p_title text,p_reference text,p_amount numeric,p_issued date,p_first_due date,p_count integer,p_request uuid)
RETURNS TABLE(obligation_id uuid,obligation_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 source AS (
 SELECT p_direction AS direction,p_company AS company_id,p_counterparty AS counterparty_id,NULL::uuid AS contract_id,NULL::integer AS contract_revision,p_amount AS amount
 WHERE p_contract IS NULL AND p_revision IS NULL
 UNION ALL
 SELECT 'receivable',c.seller_id,c.payer_id,c.id,c.revision,c.total FROM business.contracts c
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.id=p_contract AND c.revision=p_revision AND c.status IN ('signed','active','suspended') AND c.signed_on IS NOT NULL AND p_direction='receivable' AND p_company IS NULL AND p_counterparty IS NULL AND p_amount IS NULL
 ), header AS (
 INSERT INTO business.financial_obligations(tenant_id,direction,company_id,counterparty_id,company_name,counterparty_name,contract_id,contract_revision,title,reference,amount,issued_on,first_due,installment_count,request_id,created_by)
 SELECT own.tenant_id,s.direction,s.company_id,s.counterparty_id,p.legal_name,q.legal_name,s.contract_id,s.contract_revision,btrim(p_title),btrim(p_reference),s.amount,p_issued,p_first_due,p_count,p_request,current_setting('anna.actor_id',true)::uuid
 FROM source s JOIN business.companies own ON own.tenant_id=current_setting('anna.tenant_id',true)::uuid AND own.party_id=s.company_id
 JOIN core.parties p ON p.tenant_id=own.tenant_id AND p.id=s.company_id AND p.status='active'
 JOIN core.parties q ON q.tenant_id=own.tenant_id AND q.id=s.counterparty_id AND q.status='active' CROSS JOIN clock
 WHERE s.company_id<>s.counterparty_id AND s.direction IN ('receivable','payable') AND s.amount>0 AND s.amount=round(s.amount,2) AND s.amount<=9999999999999999.99 AND s.amount*100>=p_count AND p_count BETWEEN 1 AND 24 AND p_issued<=clock.today AND p_first_due>=p_issued AND p_first_due<='9997-12-31'::date
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,code,amount,first_due,installment_count,created_by
 ), installments AS (
 INSERT INTO business.financial_installments(tenant_id,obligation_id,installment_no,due_on,amount)
 SELECT h.tenant_id,h.id,n,(h.first_due+make_interval(months=>n-1))::date,
 (floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100
 FROM header h CROSS JOIN LATERAL generate_series(1,h.installment_count) n
 RETURNING obligation_id,amount
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT h.tenant_id,h.created_by,'financial_obligation',h.id,'create',p_request,jsonb_build_object('direction',p_direction,'contract_id',p_contract,'amount',sum(i.amount),'installments',count(*)) FROM header h JOIN installments i ON i.obligation_id=h.id GROUP BY h.id,h.tenant_id,h.created_by
 ) SELECT id,code FROM header
$$;
REVOKE ALL ON FUNCTION business.create_financial_obligation(text,uuid,uuid,uuid,integer,text,text,numeric,date,date,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_financial_obligation(text,uuid,uuid,uuid,integer,text,text,numeric,date,date,integer,uuid) TO anna_business_runtime;
