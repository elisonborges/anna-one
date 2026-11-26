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
CREATE FUNCTION business.guard_management_allocation_period() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
 DECLARE company uuid; previous date; BEGIN
 SELECT o.company_id INTO company FROM business.financial_obligations o WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.obligation_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||company::text,47));
 SELECT a.competence_on INTO previous FROM business.management_allocations a WHERE a.tenant_id=NEW.tenant_id AND a.obligation_id=NEW.obligation_id ORDER BY a.revision DESC LIMIT 1;
 IF business.management_period_closed(NEW.tenant_id,company,NEW.competence_on) OR (previous IS NOT NULL AND business.management_period_closed(NEW.tenant_id,company,previous)) THEN RAISE EXCEPTION 'Período gerencial encerrado.' USING ERRCODE='23514'; END IF;
 RETURN NEW; END
$$;
CREATE TRIGGER guard_management_allocation_period BEFORE INSERT ON business.management_allocations FOR EACH ROW EXECUTE FUNCTION business.guard_management_allocation_period();
CREATE FUNCTION business.guard_management_budget_period() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
 DECLARE previous jsonb; m integer; old_lines jsonb; new_lines jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||NEW.company_id::text,47));
 SELECT b.lines INTO previous FROM business.management_budgets b WHERE b.tenant_id=NEW.tenant_id AND b.company_id=NEW.company_id AND b.budget_year=NEW.budget_year ORDER BY b.revision DESC LIMIT 1;
 FOR m IN 1..12 LOOP
 IF business.management_period_closed(NEW.tenant_id,NEW.company_id,make_date(NEW.budget_year,m,1)) THEN
 SELECT COALESCE(jsonb_agg(jsonb_build_array(l->>'category_id',(l->>'amount')::numeric) ORDER BY l->>'category_id'),'[]'::jsonb) INTO old_lines FROM jsonb_array_elements(COALESCE(previous,'[]'::jsonb)) l WHERE (l->>'month')::integer=m;
 SELECT COALESCE(jsonb_agg(jsonb_build_array(l->>'category_id',(l->>'amount')::numeric) ORDER BY l->>'category_id'),'[]'::jsonb) INTO new_lines FROM jsonb_array_elements(NEW.lines) l WHERE (l->>'month')::integer=m;
 IF old_lines<>new_lines THEN RAISE EXCEPTION 'Orçamento do período encerrado não pode ser alterado.' USING ERRCODE='23514'; END IF;
 END IF; END LOOP; RETURN NEW; END
$$;
CREATE TRIGGER guard_management_budget_period BEFORE INSERT ON business.management_budgets FOR EACH ROW EXECUTE FUNCTION business.guard_management_budget_period();
CREATE FUNCTION business.change_management_period(p_company uuid,p_period date,p_revision integer,p_status text,p_checklist jsonb,p_reason text,p_op uuid)
RETURNS TABLE(event_id uuid,revision integer) LANGUAGE plpgsql SECURITY INVOKER AS $$
 DECLARE t uuid:=current_setting('anna.tenant_id',true)::uuid; actor uuid:=current_setting('anna.actor_id',true)::uuid; prev integer; prev_status text; snap jsonb; eid uuid;
 BEGIN
 IF p_period IS NULL OR extract(day FROM p_period)<>1 OR p_period<date '2000-01-01' OR p_period>date '2100-12-01' OR p_period>=date_trunc('month',now() AT TIME ZONE 'America/Fortaleza')::date OR p_status NOT IN ('closed','open') OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM business.companies c WHERE c.tenant_id=t AND c.party_id=p_company) OR NOT EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants te ON te.id=m.tenant_id WHERE m.tenant_id=t AND m.user_id=actor AND m.active AND m.role='owner' AND te.kind='internal' AND te.status='active') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||p_company::text,47));
 SELECT e.revision,e.status INTO prev,prev_status FROM business.management_period_events e WHERE e.tenant_id=t AND e.company_id=p_company AND e.period_on=p_period ORDER BY e.revision DESC LIMIT 1;
 IF COALESCE(prev,0)<>p_revision OR COALESCE(prev_status,'open')=p_status THEN RETURN; END IF;
 IF p_status='closed' THEN
 IF p_checklist IS DISTINCT FROM '{"documents":true,"reconciliation":true,"allocations":true,"budget":true,"exceptions":true}'::jsonb THEN RETURN; END IF;
 WITH obs AS (SELECT o.id,o.direction,o.amount,o.issued_on,a.competence_on,a.lines,a.revision,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND (n.original_id=o.id OR n.replacement_id=o.id)) AS renegotiated FROM business.financial_obligations o LEFT JOIN LATERAL(SELECT a.competence_on,a.lines,a.revision FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY a.revision DESC LIMIT 1) a ON true WHERE o.tenant_id=t AND o.company_id=p_company),
 scoped AS (SELECT * FROM obs WHERE COALESCE(competence_on,issued_on)>=p_period AND COALESCE(competence_on,issued_on)<p_period+interval '1 month'),
 budget AS (SELECT b.revision,b.lines FROM business.management_budgets b WHERE b.tenant_id=t AND b.company_id=p_company AND b.budget_year=extract(year FROM p_period)::integer ORDER BY b.revision DESC LIMIT 1)
 SELECT jsonb_build_object('receivable',COALESCE(sum(amount) FILTER(WHERE direction='receivable' AND lines IS NOT NULL AND NOT renegotiated),0)::text,'payable',COALESCE(sum(amount) FILTER(WHERE direction='payable' AND lines IS NOT NULL AND NOT renegotiated),0)::text,'unclassified',count(*) FILTER(WHERE lines IS NULL AND NOT renegotiated),'renegotiated',count(*) FILTER(WHERE renegotiated),'allocation_revisions',COALESCE(jsonb_agg(jsonb_build_object('obligation_id',id,'revision',revision) ORDER BY id) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated),'[]'::jsonb),'budget_revision',(SELECT b.revision FROM budget b),'budget_lines',COALESCE((SELECT jsonb_agg(l) FROM budget b CROSS JOIN LATERAL jsonb_array_elements(b.lines) l WHERE (l->>'month')::integer=extract(month FROM p_period)),'[]'::jsonb)) INTO snap FROM scoped;
 END IF;
 INSERT INTO business.management_period_events(tenant_id,company_id,period_on,revision,status,checklist,snapshot,reason,operation_id,created_by)
 VALUES(t,p_company,p_period,COALESCE(prev,0)+1,p_status,CASE WHEN p_status='closed' THEN p_checklist END,snap,btrim(p_reason),p_op,actor) ON CONFLICT DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) VALUES(t,actor,'management_period',eid,'create',p_op,jsonb_build_object('company_id',p_company,'period_on',p_period,'status',p_status,'revision',COALESCE(prev,0)+1));
 RETURN QUERY SELECT eid,COALESCE(prev,0)+1;
 END
$$;
REVOKE ALL ON FUNCTION business.management_period_closed(uuid,uuid,date),business.guard_management_allocation_period(),business.guard_management_budget_period(),business.change_management_period(uuid,date,integer,text,jsonb,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.management_period_closed(uuid,uuid,date),business.guard_management_allocation_period(),business.guard_management_budget_period(),business.change_management_period(uuid,date,integer,text,jsonb,text,uuid) TO anna_business_runtime;
