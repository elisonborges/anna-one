-- 023: reparcelamento de saldo e recorrências mensais explícitas.
ALTER TABLE business.financial_installments DROP CONSTRAINT financial_installments_balance_check;
ALTER TABLE business.financial_installments ADD CONSTRAINT financial_installments_balance_check CHECK(remaining BETWEEN 0 AND amount AND ((status='open' AND remaining=amount) OR (status='partial' AND remaining>0 AND remaining<amount) OR (status IN ('settled','renegotiated') AND remaining=0)));
CREATE TABLE business.financial_renegotiations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 original_id uuid NOT NULL, replacement_id uuid NOT NULL,
 principal numeric(18,2) NOT NULL CHECK(principal>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array'),
 request_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,original_id) REFERENCES business.financial_obligations(tenant_id,id),
 FOREIGN KEY(tenant_id,replacement_id) REFERENCES business.financial_obligations(tenant_id,id),
 CHECK(original_id<>replacement_id), UNIQUE(tenant_id,original_id), UNIQUE(tenant_id,replacement_id), UNIQUE(tenant_id,request_id)
);
CREATE TABLE business.financial_recurring_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 direction text NOT NULL CHECK(direction IN ('receivable','payable')),
 company_id uuid NOT NULL,counterparty_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 first_due date NOT NULL,periods integer NOT NULL CHECK(periods BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 close_reason text CHECK(close_reason IS NULL OR length(btrim(close_reason)) BETWEEN 1 AND 300),
 request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,counterparty_id) REFERENCES core.parties(tenant_id,id),
 CHECK(company_id<>counterparty_id),CHECK((status='closed')=(close_reason IS NOT NULL)),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_id)
);
CREATE TABLE business.financial_recurring_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,rule_id uuid NOT NULL,
 period_no integer NOT NULL CHECK(period_no BETWEEN 1 AND 120),obligation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES business.financial_recurring_rules(tenant_id,id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,rule_id,period_no),UNIQUE(tenant_id,obligation_id)
);
ALTER TABLE business.financial_renegotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_renegotiations FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_renegotiations_read ON business.financial_renegotiations FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_renegotiations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_renegotiations_insert ON business.financial_renegotiations FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_renegotiations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_renegotiations FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_renegotiations TO anna_business_runtime;
ALTER TABLE business.financial_recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_recurring_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_recurring_rules_read ON business.financial_recurring_rules FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_rules.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_recurring_rules_insert ON business.financial_recurring_rules FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_rules.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_recurring_rules FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_recurring_rules TO anna_business_runtime;
ALTER TABLE business.financial_recurring_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.financial_recurring_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_recurring_occurrences_read ON business.financial_recurring_occurrences FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_occurrences.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY financial_recurring_occurrences_insert ON business.financial_recurring_occurrences FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_occurrences.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.financial_recurring_occurrences FROM PUBLIC;
GRANT SELECT,INSERT ON business.financial_recurring_occurrences TO anna_business_runtime;
CREATE POLICY financial_recurring_rules_update ON business.financial_recurring_rules FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_rules.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=financial_recurring_rules.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(status,close_reason) ON business.financial_recurring_rules TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.financial_recurring_rules_code_seq TO anna_business_runtime;
CREATE FUNCTION business.renegotiate_financial_obligation(p_id uuid,p_expected numeric,p_due date,p_count integer,p_reason text,p_ref text,p_request uuid)
RETURNS TABLE(obligation_id uuid,obligation_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 src AS MATERIALIZED (SELECT i.id,i.installment_no,i.remaining,i.revision,i.due_on FROM business.financial_installments i WHERE i.tenant_id=current_setting('anna.tenant_id',true)::uuid AND i.obligation_id=p_id AND i.remaining>0 AND i.status IN ('open','partial')),
 totals AS (SELECT sum(remaining) AS principal,jsonb_agg(jsonb_build_object('id',id,'installment_no',installment_no,'remaining',remaining,'due_on',due_on,'revision',revision) ORDER BY installment_no) AS sources FROM src),
 header AS (
 INSERT INTO business.financial_obligations(tenant_id,direction,company_id,counterparty_id,company_name,counterparty_name,title,reference,amount,issued_on,first_due,installment_count,request_id,created_by)
 SELECT o.tenant_id,o.direction,o.company_id,o.counterparty_id,o.company_name,o.counterparty_name,left('Renegociação: '||o.title,200),btrim(p_ref),t.principal,clock.today,p_due,p_count,p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.financial_obligations o CROSS JOIN totals t CROSS JOIN clock WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_id AND t.principal=p_expected AND t.principal>0 AND p_count BETWEEN 1 AND 24 AND t.principal*100>=p_count AND p_due BETWEEN clock.today AND '9997-12-31'::date AND length(btrim(p_reason)) BETWEEN 1 AND 300 AND length(btrim(p_ref)) BETWEEN 1 AND 200
 AND NOT EXISTS (SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND n.original_id=o.id)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,code,amount,first_due,installment_count,created_by
 ), closed AS (
 UPDATE business.financial_installments i SET remaining=0,status='renegotiated',revision=i.revision+1 FROM src s CROSS JOIN header h WHERE i.tenant_id=h.tenant_id AND i.id=s.id AND i.revision=s.revision RETURNING i.id
 ), installments AS (
 INSERT INTO business.financial_installments(tenant_id,obligation_id,installment_no,due_on,amount,remaining)
 SELECT h.tenant_id,h.id,n,(h.first_due+make_interval(months=>n-1))::date,(floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100,(floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100 FROM header h CROSS JOIN LATERAL generate_series(1,h.installment_count) n
 ), relation AS (
 INSERT INTO business.financial_renegotiations(tenant_id,original_id,replacement_id,principal,reason,reference,sources,request_id,created_by)
 SELECT h.tenant_id,p_id,h.id,h.amount,btrim(p_reason),btrim(p_ref),t.sources,p_request,h.created_by FROM header h CROSS JOIN totals t
 RETURNING id,tenant_id,created_by,replacement_id
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_renegotiation',id,'create',p_request,jsonb_build_object('original_id',p_id,'replacement_id',replacement_id,'principal',p_expected) FROM relation
 ) SELECT id,code FROM header
$$;
CREATE FUNCTION business.create_financial_recurring_rule(p_direction text,p_company uuid,p_counterparty uuid,p_title text,p_ref text,p_amount numeric,p_due date,p_periods integer,p_request uuid)
RETURNS TABLE(rule_id uuid,rule_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.financial_recurring_rules(tenant_id,direction,company_id,counterparty_id,title,reference,amount,first_due,periods,request_id,created_by)
 SELECT b.tenant_id,p_direction,b.party_id,q.id,btrim(p_title),btrim(p_ref),p_amount,p_due,p_periods,p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id AND p.status='active' JOIN core.parties q ON q.tenant_id=b.tenant_id AND q.id=p_counterparty AND q.status='active'
 WHERE b.tenant_id=current_setting('anna.tenant_id',true)::uuid AND b.party_id=p_company AND q.id<>b.party_id AND p_direction IN ('receivable','payable') AND p_amount BETWEEN 0.01 AND 9999999999999999.99 AND p_amount=round(p_amount,2) AND p_periods BETWEEN 1 AND 120 AND p_due BETWEEN (now() AT TIME ZONE 'America/Fortaleza')::date AND '9988-12-31'::date
 ON CONFLICT DO NOTHING RETURNING id,code,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_recurring_rule',id,'create',p_request,jsonb_build_object('amount',p_amount,'periods',p_periods,'first_due',p_due) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.generate_financial_occurrence(p_rule uuid,p_period integer,p_issued date,p_request uuid)
RETURNS TABLE(obligation_id uuid,obligation_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH eligible AS MATERIALIZED (
 SELECT r.*,(r.first_due+make_interval(months=>p_period-1))::date AS due
 FROM business.financial_recurring_rules r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_rule AND r.status='active' AND p_period BETWEEN 1 AND r.periods AND p_period=1+(SELECT count(*) FROM business.financial_recurring_occurrences x WHERE x.tenant_id=r.tenant_id AND x.rule_id=r.id)
 ), generated AS MATERIALIZED (
 SELECT e.id AS rule_id,e.tenant_id,v.obligation_id,v.obligation_code FROM eligible e CROSS JOIN LATERAL business.create_financial_obligation(e.direction,e.company_id,e.counterparty_id,NULL,NULL,e.title,e.reference,e.amount,p_issued,e.due,1,p_request) v
 ), recorded AS (
 INSERT INTO business.financial_recurring_occurrences(tenant_id,rule_id,period_no,obligation_id,created_by)
 SELECT tenant_id,rule_id,p_period,obligation_id,current_setting('anna.actor_id',true)::uuid FROM generated RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'financial_recurring_occurrence',id,'create',p_request,jsonb_build_object('rule_id',p_rule,'period',p_period) FROM recorded
 ) SELECT obligation_id,obligation_code FROM generated
$$;
CREATE FUNCTION business.close_financial_recurring_rule(p_rule uuid,p_reason text,p_request uuid)
RETURNS TABLE(rule_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.financial_recurring_rules SET status='closed',close_reason=btrim(p_reason) WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_rule AND status='active' AND length(btrim(p_reason)) BETWEEN 1 AND 300 RETURNING id,tenant_id
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'financial_recurring_rule',id,'deactivate',p_request,jsonb_build_object('reason',btrim(p_reason)) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.renegotiate_financial_obligation(uuid,numeric,date,integer,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.renegotiate_financial_obligation(uuid,numeric,date,integer,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.create_financial_recurring_rule(text,uuid,uuid,text,text,numeric,date,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_financial_recurring_rule(text,uuid,uuid,text,text,numeric,date,integer,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.generate_financial_occurrence(uuid,integer,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.generate_financial_occurrence(uuid,integer,date,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.close_financial_recurring_rule(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.close_financial_recurring_rule(uuid,text,uuid) TO anna_business_runtime;
CREATE OR REPLACE FUNCTION business.reverse_financial_settlement(p_id uuid,p_revision integer,p_date date,p_reason text,p_request uuid)
RETURNS TABLE(reversal_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH eligible AS MATERIALIZED (
 SELECT s.id,s.tenant_id,s.installment_id,s.principal FROM business.financial_settlements s
 WHERE s.tenant_id=current_setting('anna.tenant_id',true)::uuid AND s.id=p_id AND p_date BETWEEN s.settled_on AND (now() AT TIME ZONE 'America/Fortaleza')::date AND length(btrim(p_reason)) BETWEEN 1 AND 300
 AND NOT EXISTS (SELECT 1 FROM business.financial_reversals r WHERE r.tenant_id=s.tenant_id AND (r.settlement_id=s.id OR r.request_id=p_request))
 ), changed AS (
 UPDATE business.financial_installments i SET remaining=i.remaining+e.principal,status=CASE WHEN i.remaining+e.principal=i.amount THEN 'open' ELSE 'partial' END,revision=i.revision+1
 FROM eligible e WHERE i.tenant_id=e.tenant_id AND i.id=e.installment_id AND i.revision=p_revision AND i.remaining+e.principal<=i.amount AND NOT EXISTS (SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=i.tenant_id AND n.original_id=i.obligation_id)
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
