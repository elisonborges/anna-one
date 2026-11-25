-- 021: liquidação, descontos e estornos auditados.
ALTER TABLE business.financial_installments DROP CONSTRAINT financial_installments_status_check;
ALTER TABLE business.financial_installments ADD COLUMN remaining numeric(18,2);
UPDATE business.financial_installments SET remaining=amount;
ALTER TABLE business.financial_installments ALTER COLUMN remaining SET NOT NULL;
ALTER TABLE business.financial_installments ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE business.financial_installments ADD CONSTRAINT financial_installments_balance_check CHECK(remaining BETWEEN 0 AND amount AND ((status='open' AND remaining=amount) OR (status='partial' AND remaining>0 AND remaining<amount) OR (status='settled' AND remaining=0)));
CREATE POLICY financial_installments_update ON business.financial_installments FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_installments.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_installments.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(remaining,revision,status) ON business.financial_installments TO anna_business_runtime;
CREATE TABLE business.financial_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 installment_id uuid NOT NULL,
 principal numeric(18,2) NOT NULL CHECK(principal>0),
 discount numeric(18,2) NOT NULL CHECK(discount BETWEEN 0 AND principal),
 interest numeric(18,2) NOT NULL CHECK(interest>=0),
 fine numeric(18,2) NOT NULL CHECK(fine>=0),
 cash_amount numeric(20,2) GENERATED ALWAYS AS (principal-discount+interest+fine) STORED,
 settled_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('pix','transfer','cash','card','boleto','other','non_cash')),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,installment_id) REFERENCES business.financial_installments(tenant_id,id) ON DELETE RESTRICT,
 CHECK((method='non_cash')=(principal-discount+interest+fine=0)),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_id)
);
CREATE TABLE business.financial_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 settlement_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 reversed_on date NOT NULL,
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,settlement_id) REFERENCES business.financial_settlements(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,settlement_id), UNIQUE(tenant_id,request_id)
);
CREATE INDEX financial_settlements_installment ON business.financial_settlements(tenant_id,installment_id);
ALTER TABLE business.financial_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_settlements_read ON business.financial_settlements FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_settlements.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_settlements_insert ON business.financial_settlements FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_settlements.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_settlements FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_settlements TO anna_business_runtime;
ALTER TABLE business.financial_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_reversals_read ON business.financial_reversals FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_reversals.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_reversals_insert ON business.financial_reversals FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_reversals.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_reversals FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_reversals TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.financial_settlements_code_seq TO anna_business_runtime;
CREATE FUNCTION business.settle_financial_installment(p_id uuid,p_revision integer,p_principal numeric,p_discount numeric,p_interest numeric,p_fine numeric,p_date date,p_method text,p_reference text,p_request uuid)
RETURNS TABLE(settlement_id uuid,settlement_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.financial_installments i SET remaining=i.remaining-p_principal,status=CASE WHEN i.remaining=p_principal THEN 'settled' ELSE 'partial' END,revision=i.revision+1
 FROM business.financial_obligations o
 WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.id=p_id AND i.revision=p_revision AND o.tenant_id=i.tenant_id AND o.id=i.obligation_id
 AND p_principal>0 AND p_principal<=i.remaining AND p_discount BETWEEN 0 AND p_principal AND p_interest BETWEEN 0 AND 9999999999999999.99 AND p_fine BETWEEN 0 AND 9999999999999999.99
 AND p_principal=round(p_principal,2) AND p_discount=round(p_discount,2) AND p_interest=round(p_interest,2) AND p_fine=round(p_fine,2)
 AND p_date BETWEEN o.issued_on AND (now() AT TIME ZONE 'America/Fortaleza')::date
 AND p_method IN ('pix','transfer','cash','card','boleto','other','non_cash') AND (p_method='non_cash')=(p_principal-p_discount+p_interest+p_fine=0)
 AND length(btrim(p_reference)) BETWEEN 1 AND 200
 AND NOT EXISTS (SELECT 1 FROM business.financial_settlements s WHERE s.tenant_id=i.tenant_id AND s.request_id=p_request)
 RETURNING i.id,i.tenant_id,i.remaining
 ), inserted AS (
 INSERT INTO business.financial_settlements(tenant_id,installment_id,principal,discount,interest,fine,settled_on,method,reference,request_id,created_by)
 SELECT tenant_id,id,p_principal,p_discount,p_interest,p_fine,p_date,p_method,btrim(p_reference),p_request,current_setting('anna.actor_id',true)::uuid FROM changed
 RETURNING id,code,tenant_id,created_by,cash_amount
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_settlement',id,'create',p_request,jsonb_build_object('installment_id',p_id,'principal',p_principal,'discount',p_discount,'interest',p_interest,'fine',p_fine,'cash',cash_amount) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.reverse_financial_settlement(p_id uuid,p_revision integer,p_date date,p_reason text,p_request uuid)
RETURNS TABLE(reversal_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH eligible AS MATERIALIZED (
 SELECT s.id,s.tenant_id,s.installment_id,s.principal FROM business.financial_settlements s
 WHERE s.tenant_id=current_setting('anna.tenant_id',true)::uuid AND s.id=p_id AND p_date BETWEEN s.settled_on AND (now() AT TIME ZONE 'America/Fortaleza')::date AND length(btrim(p_reason)) BETWEEN 1 AND 300
 AND NOT EXISTS (SELECT 1 FROM business.financial_reversals r WHERE r.tenant_id=s.tenant_id AND (r.settlement_id=s.id OR r.request_id=p_request))
 ), changed AS (
 UPDATE business.financial_installments i SET remaining=i.remaining+e.principal,status=CASE WHEN i.remaining+e.principal=i.amount THEN 'open' ELSE 'partial' END,revision=i.revision+1
 FROM eligible e WHERE i.tenant_id=e.tenant_id AND i.id=e.installment_id AND i.revision=p_revision AND i.remaining+e.principal<=i.amount
 RETURNING e.id AS settlement_id,i.tenant_id
 ), inserted AS (
 INSERT INTO business.financial_reversals(tenant_id,settlement_id,reason,reversed_on,request_id,created_by)
 SELECT tenant_id,settlement_id,btrim(p_reason),p_date,p_request,current_setting('anna.actor_id',true)::uuid FROM changed
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_reversal',id,'create',p_request,jsonb_build_object('settlement_id',p_id,'reason',btrim(p_reason)) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.settle_financial_installment(uuid,integer,numeric,numeric,numeric,numeric,date,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.settle_financial_installment(uuid,integer,numeric,numeric,numeric,numeric,date,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.reverse_financial_settlement(uuid,integer,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.reverse_financial_settlement(uuid,integer,date,text,uuid) TO anna_business_runtime;

CREATE OR REPLACE FUNCTION business.create_financial_obligation(p_direction text,p_company uuid,p_counterparty uuid,p_contract uuid,p_revision integer,p_title text,p_reference text,p_amount numeric,p_issued date,p_first_due date,p_count integer,p_request uuid)
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
 INSERT INTO business.financial_installments(tenant_id,obligation_id,installment_no,due_on,amount,remaining)
 SELECT h.tenant_id,h.id,n,(h.first_due+make_interval(months=>n-1))::date,
 (floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100,
 (floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100
 FROM header h CROSS JOIN LATERAL generate_series(1,h.installment_count) n
 RETURNING obligation_id,amount
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT h.tenant_id,h.created_by,'financial_obligation',h.id,'create',p_request,jsonb_build_object('direction',p_direction,'contract_id',p_contract,'amount',sum(i.amount),'installments',count(*)) FROM header h JOIN installments i ON i.obligation_id=h.id GROUP BY h.id,h.tenant_id,h.created_by
 ) SELECT id,code FROM header
$$;
