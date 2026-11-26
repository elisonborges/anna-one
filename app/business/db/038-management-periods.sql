-- 038: fechamento gerencial mensal, eventos imutáveis e bloqueios de apropriação/orçamento.
CREATE TABLE business.management_period_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 period_on date NOT NULL CHECK(extract(day FROM period_on)=1 AND period_on BETWEEN date '2000-01-01' AND date '2100-12-01'),
 revision integer NOT NULL CHECK(revision>=1),status text NOT NULL CHECK(status IN ('closed','open')),
 checklist jsonb,snapshot jsonb,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,company_id,period_on,revision),UNIQUE(tenant_id,operation_id),
 CHECK((status='closed' AND checklist IS NOT NULL AND snapshot IS NOT NULL) OR (status='open' AND checklist IS NULL AND snapshot IS NULL))
);
ALTER TABLE business.management_period_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.management_period_events FORCE ROW LEVEL SECURITY;
CREATE POLICY management_period_read ON business.management_period_events FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_period_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY management_period_insert ON business.management_period_events FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=management_period_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.management_period_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.management_period_events TO anna_business_runtime;
CREATE FUNCTION business.management_period_closed(p_tenant uuid,p_company uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT COALESCE((SELECT e.status='closed' FROM business.management_period_events e WHERE e.tenant_id=p_tenant AND e.company_id=p_company AND e.period_on=date_trunc('month',p_date::timestamp)::date ORDER BY e.revision DESC LIMIT 1),false)
$$;
CREATE FUNCTION business.management_allocation_period_allowed(p_tenant uuid,p_obligation uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT EXISTS(SELECT 1 FROM business.financial_obligations o WHERE o.tenant_id=p_tenant AND o.id=p_obligation AND NOT business.management_period_closed(p_tenant,o.company_id,p_date) AND NOT business.management_period_closed(p_tenant,o.company_id,COALESCE((SELECT a.competence_on FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY a.revision DESC LIMIT 1),o.issued_on)))
$$;
CREATE POLICY management_allocation_period_guard ON business.management_allocations AS RESTRICTIVE FOR INSERT WITH CHECK(business.management_allocation_period_allowed(tenant_id,obligation_id,competence_on));
CREATE FUNCTION business.management_budget_period_allowed(p_tenant uuid,p_company uuid,p_year integer,p_lines jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH previous AS (SELECT b.lines FROM business.management_budgets b WHERE b.tenant_id=p_tenant AND b.company_id=p_company AND b.budget_year=p_year ORDER BY b.revision DESC LIMIT 1),
 closed_months AS (SELECT m FROM generate_series(1,12) m WHERE business.management_period_closed(p_tenant,p_company,make_date(p_year,m,1)))
 SELECT NOT EXISTS(SELECT 1 FROM closed_months c WHERE
 COALESCE((SELECT jsonb_agg(jsonb_build_array(l->>'category_id',(l->>'amount')::numeric) ORDER BY l->>'category_id') FROM previous b CROSS JOIN LATERAL jsonb_array_elements(b.lines) l WHERE (l->>'month')::integer=c.m),'[]'::jsonb)
 IS DISTINCT FROM COALESCE((SELECT jsonb_agg(jsonb_build_array(l->>'category_id',(l->>'amount')::numeric) ORDER BY l->>'category_id') FROM jsonb_array_elements(p_lines) l WHERE (l->>'month')::integer=c.m),'[]'::jsonb))
$$;
CREATE POLICY management_budget_period_guard ON business.management_budgets AS RESTRICTIVE FOR INSERT WITH CHECK(business.management_budget_period_allowed(tenant_id,company_id,budget_year,lines));
CREATE FUNCTION business.change_management_period(p_company uuid,p_period date,p_revision integer,p_status text,p_checklist jsonb,p_reason text,p_op uuid)
RETURNS TABLE(event_id uuid,revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH target AS MATERIALIZED (
 SELECT c.tenant_id,c.party_id,COALESCE(e.revision,0) AS prev,COALESCE(e.status,'open') AS prev_status
 FROM business.companies c JOIN business.tenant_memberships m ON m.tenant_id=c.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner'
 LEFT JOIN LATERAL(SELECT e.revision,e.status FROM business.management_period_events e WHERE e.tenant_id=c.tenant_id AND e.company_id=c.party_id AND e.period_on=p_period ORDER BY e.revision DESC LIMIT 1) e ON true
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.party_id=p_company AND p_period BETWEEN date '2000-01-01' AND date '2100-12-01' AND extract(day FROM p_period)=1 AND p_period<date_trunc('month',now() AT TIME ZONE 'America/Fortaleza')::date
 AND p_status IN ('closed','open') AND length(btrim(p_reason)) BETWEEN 1 AND 500
 AND COALESCE(e.revision,0)=p_revision AND COALESCE(e.status,'open')<>p_status
 AND (p_status='open' OR p_checklist='{"documents":true,"reconciliation":true,"allocations":true,"budget":true,"exceptions":true}'::jsonb)
 ), obs AS (
 SELECT o.id,o.direction,o.amount,o.issued_on,a.competence_on,a.lines,a.revision,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND (n.original_id=o.id OR n.replacement_id=o.id)) AS renegotiated
 FROM target t JOIN business.financial_obligations o ON o.tenant_id=t.tenant_id AND o.company_id=t.party_id LEFT JOIN LATERAL(SELECT a.competence_on,a.lines,a.revision FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY a.revision DESC LIMIT 1) a ON true WHERE p_status='closed'
 ), scoped AS (SELECT * FROM obs WHERE COALESCE(competence_on,issued_on)>=p_period AND COALESCE(competence_on,issued_on)<p_period+interval '1 month'),
 budget AS (SELECT b.revision,b.lines FROM target t JOIN business.management_budgets b ON b.tenant_id=t.tenant_id AND b.company_id=t.party_id WHERE b.budget_year=extract(year FROM p_period)::integer ORDER BY b.revision DESC LIMIT 1),
 snap AS (SELECT jsonb_build_object('receivable',COALESCE(sum(amount) FILTER(WHERE direction='receivable' AND lines IS NOT NULL AND NOT renegotiated),0)::text,'payable',COALESCE(sum(amount) FILTER(WHERE direction='payable' AND lines IS NOT NULL AND NOT renegotiated),0)::text,'unclassified',count(*) FILTER(WHERE lines IS NULL AND NOT renegotiated),'renegotiated',count(*) FILTER(WHERE renegotiated),'allocation_revisions',COALESCE(jsonb_agg(jsonb_build_object('obligation_id',id,'revision',revision) ORDER BY id) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated),'[]'::jsonb),'budget_revision',(SELECT b.revision FROM budget b),'budget_lines',COALESCE((SELECT jsonb_agg(l) FROM budget b CROSS JOIN LATERAL jsonb_array_elements(b.lines) l WHERE (l->>'month')::integer=extract(month FROM p_period)),'[]'::jsonb)) AS value FROM scoped),
 inserted AS (
 INSERT INTO business.management_period_events(tenant_id,company_id,period_on,revision,status,checklist,snapshot,reason,operation_id,created_by)
 SELECT t.tenant_id,t.party_id,p_period,t.prev+1,p_status,CASE WHEN p_status='closed' THEN p_checklist END,CASE WHEN p_status='closed' THEN s.value END,btrim(p_reason),p_op,current_setting('anna.actor_id',true)::uuid FROM target t CROSS JOIN snap s
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,management_period_events.revision,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'management_period',id,'create',p_op,jsonb_build_object('company_id',p_company,'period_on',p_period,'status',p_status,'revision',inserted.revision) FROM inserted
 ) SELECT id,inserted.revision FROM inserted
$$;
REVOKE ALL ON FUNCTION business.management_period_closed(uuid,uuid,date),business.management_allocation_period_allowed(uuid,uuid,date),business.management_budget_period_allowed(uuid,uuid,integer,jsonb),business.change_management_period(uuid,date,integer,text,jsonb,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.management_period_closed(uuid,uuid,date),business.management_allocation_period_allowed(uuid,uuid,date),business.management_budget_period_allowed(uuid,uuid,integer,jsonb),business.change_management_period(uuid,date,integer,text,jsonb,text,uuid) TO anna_business_runtime;
