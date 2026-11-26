-- 052: folha processada externa, importação de totais por obrigação (sem holerites).
BEGIN;
CREATE TABLE business.payroll_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES business.tenant_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 300 AND revoke_op IS NOT NULL))
);
CREATE UNIQUE INDEX payroll_live_grant ON business.payroll_grants(tenant_id,company_id,user_id) WHERE revoked_at IS NULL;
ALTER TABLE business.payroll_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.payroll_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_grant_read ON business.payroll_grants FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY payroll_grant_insert ON business.payroll_grants FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY payroll_grant_revoke ON business.payroll_grants FOR UPDATE USING(business.hr_admin(tenant_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
CREATE FUNCTION business.payroll_allowed(p_tenant uuid,p_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT business.hr_admin(p_tenant) AND EXISTS(SELECT 1 FROM business.payroll_grants g WHERE g.tenant_id=p_tenant AND g.company_id=p_company AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL)
$fn$;
CREATE TABLE business.payroll_periods(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,competence date NOT NULL CHECK(extract(day from competence)=1),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,competence),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.payroll_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,period_id uuid NOT NULL,
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 120),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
 total numeric(18,2) NOT NULL CHECK(total>0),
 status text NOT NULL DEFAULT 'imported' CHECK(status IN ('imported','cancelled','approved','integrated')),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 decision_by uuid REFERENCES public.app_users(id),decision_at timestamptz,decision_reason text,decision_op uuid,
 integrated_at timestamptz,integrated_by uuid REFERENCES public.app_users(id),integration_op uuid,
 FOREIGN KEY(tenant_id,company_id,period_id) REFERENCES business.payroll_periods(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,decision_op),UNIQUE(tenant_id,integration_op),
 CHECK((status='imported' AND decision_by IS NULL AND decision_at IS NULL AND decision_reason IS NULL AND decision_op IS NULL) OR (status<>'imported' AND decision_by IS NOT NULL AND decision_at IS NOT NULL AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) BETWEEN 1 AND 300 AND decision_op IS NOT NULL)),
 CHECK((status='integrated' AND integrated_at IS NOT NULL AND integrated_by IS NOT NULL AND integration_op IS NOT NULL) OR (status<>'integrated' AND integrated_at IS NULL AND integrated_by IS NULL AND integration_op IS NULL))
);
CREATE UNIQUE INDEX payroll_one_batch ON business.payroll_batches(tenant_id,period_id) WHERE status<>'cancelled';
CREATE TABLE business.payroll_finance_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,batch_id uuid NOT NULL,
 line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 100),obligation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,batch_id) REFERENCES business.payroll_batches(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,batch_id,line_no),UNIQUE(tenant_id,obligation_id)
);
CREATE TABLE business.payroll_accounting_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,batch_id uuid NOT NULL,grant_id uuid NOT NULL,pendency_id uuid NOT NULL,operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,batch_id) REFERENCES business.payroll_batches(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES business.portal_grants(tenant_id,id),
 FOREIGN KEY(tenant_id,pendency_id) REFERENCES business.accounting_pendencies(tenant_id,id),
 UNIQUE(tenant_id,batch_id,grant_id),UNIQUE(tenant_id,operation_id)
);
ALTER TABLE business.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.payroll_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_periods_read ON business.payroll_periods FOR SELECT USING(business.payroll_allowed(tenant_id,company_id));
CREATE POLICY payroll_periods_insert ON business.payroll_periods FOR INSERT WITH CHECK(business.payroll_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.payroll_periods FROM PUBLIC;
GRANT SELECT,INSERT ON business.payroll_periods TO anna_business_runtime;
ALTER TABLE business.payroll_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.payroll_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_batches_read ON business.payroll_batches FOR SELECT USING(business.payroll_allowed(tenant_id,company_id));
CREATE POLICY payroll_batches_insert ON business.payroll_batches FOR INSERT WITH CHECK(business.payroll_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.payroll_batches FROM PUBLIC;
GRANT SELECT,INSERT ON business.payroll_batches TO anna_business_runtime;
ALTER TABLE business.payroll_finance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.payroll_finance_links FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_finance_links_read ON business.payroll_finance_links FOR SELECT USING(business.payroll_allowed(tenant_id,company_id));
CREATE POLICY payroll_finance_links_insert ON business.payroll_finance_links FOR INSERT WITH CHECK(business.payroll_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.payroll_finance_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.payroll_finance_links TO anna_business_runtime;
ALTER TABLE business.payroll_accounting_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.payroll_accounting_links FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_accounting_links_read ON business.payroll_accounting_links FOR SELECT USING(business.payroll_allowed(tenant_id,company_id));
CREATE POLICY payroll_accounting_links_insert ON business.payroll_accounting_links FOR INSERT WITH CHECK(business.payroll_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.payroll_accounting_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.payroll_accounting_links TO anna_business_runtime;
CREATE POLICY payroll_batches_change ON business.payroll_batches FOR UPDATE USING(business.payroll_allowed(tenant_id,company_id) AND status IN ('imported','approved')) WITH CHECK(business.payroll_allowed(tenant_id,company_id));
REVOKE ALL ON business.payroll_grants FROM PUBLIC;
GRANT SELECT,INSERT ON business.payroll_grants TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.payroll_grants TO anna_business_runtime;
GRANT UPDATE(status,decision_by,decision_at,decision_reason,decision_op,integrated_at,integrated_by,integration_op) ON business.payroll_batches TO anna_business_runtime;
CREATE FUNCTION business.import_payroll_batch(p_period uuid,p_ref text,p_hash text,p_lines jsonb,p_op uuid) RETURNS TABLE(batch_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_period business.payroll_periods%ROWTYPE; v_line jsonb; v_total numeric:=0; v_amount numeric; v_id uuid;
BEGIN
 SELECT * INTO v_period FROM business.payroll_periods WHERE id=p_period AND tenant_id=current_setting('anna.tenant_id',true)::uuid;
 IF NOT FOUND OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RETURN; END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' OR NOT (v_line ?& ARRAY['kind','payee_id','amount','issued_on','due_on']) OR (v_line - ARRAY['kind','payee_id','amount','issued_on','due_on'])<>'{}'::jsonb OR COALESCE(v_line->>'kind','') NOT IN ('net_pay','tax','social_charge','benefit','other') OR COALESCE(v_line->>'amount','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$' OR COALESCE(v_line->>'payee_id','') !~ '^[a-fA-F0-9-]{36}$' OR COALESCE(v_line->>'issued_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR COALESCE(v_line->>'due_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN; END IF;
  v_amount:=(v_line->>'amount')::numeric;
  IF v_amount<=0 OR (v_line->>'issued_on')::date>(now() AT TIME ZONE 'America/Fortaleza')::date OR (v_line->>'due_on')::date<(v_line->>'issued_on')::date OR (v_line->>'due_on')::date<v_period.competence OR (v_line->>'due_on')::date>'9997-12-31'::date OR NOT EXISTS(SELECT 1 FROM core.parties p WHERE p.tenant_id=v_period.tenant_id AND p.id=(v_line->>'payee_id')::uuid AND p.kind='PJ' AND p.status='active' AND p.id<>v_period.company_id) THEN RETURN; END IF;
  v_total:=v_total+v_amount;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x GROUP BY x->>'kind',x->>'payee_id',x->>'due_on' HAVING count(*)>1) THEN RETURN; END IF;
 INSERT INTO business.payroll_batches(tenant_id,company_id,period_id,source_reference,source_hash,lines,total,operation_id,created_by) VALUES(v_period.tenant_id,v_period.company_id,v_period.id,btrim(p_ref),p_hash,p_lines,v_total,p_op,current_setting('anna.actor_id',true)::uuid) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN RETURN QUERY SELECT v_id; END IF;
END;
$fn$;
CREATE FUNCTION business.decide_payroll_batch(p_id uuid,p_status text,p_reason text,p_op uuid) RETURNS TABLE(batch_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH changed AS (UPDATE business.payroll_batches SET status=p_status,decision_by=current_setting('anna.actor_id',true)::uuid,decision_at=now(),decision_reason=btrim(p_reason),decision_op=p_op WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND status='imported' AND p_status IN ('approved','cancelled') RETURNING id) SELECT id FROM changed
$fn$;
CREATE FUNCTION business.integrate_payroll_batch(p_id uuid,p_op uuid) RETURNS TABLE(batch_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_batch business.payroll_batches%ROWTYPE; v_period date; v_line jsonb; v_obligation uuid; v_no integer:=0;
BEGIN
 UPDATE business.payroll_batches SET status='integrated',integrated_at=now(),integrated_by=current_setting('anna.actor_id',true)::uuid,integration_op=p_op WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND status='approved' RETURNING * INTO v_batch;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT competence INTO v_period FROM business.payroll_periods WHERE id=v_batch.period_id AND tenant_id=v_batch.tenant_id;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_batch.lines) LOOP
  v_no:=v_no+1; v_obligation:=NULL;
  SELECT obligation_id INTO v_obligation FROM business.create_financial_obligation('payable',v_batch.company_id,(v_line->>'payee_id')::uuid,NULL,NULL,'Folha processada - '||to_char(v_period,'YYYY-MM'),'FOLHA-'||v_batch.id::text||'-'||v_no,(v_line->>'amount')::numeric,(v_line->>'issued_on')::date,(v_line->>'due_on')::date,1,gen_random_uuid());
  IF v_obligation IS NULL THEN RAISE EXCEPTION 'Obrigação indisponível; integração integral revertida'; END IF;
  INSERT INTO business.payroll_finance_links(tenant_id,company_id,batch_id,line_no,obligation_id,created_by) VALUES(v_batch.tenant_id,v_batch.company_id,v_batch.id,v_no,v_obligation,current_setting('anna.actor_id',true)::uuid);
 END LOOP;
 RETURN QUERY SELECT v_batch.id;
END;
$fn$;
CREATE FUNCTION business.handoff_payroll_batch(p_batch uuid,p_grant uuid,p_op uuid) RETURNS TABLE(link_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_batch business.payroll_batches%ROWTYPE; v_period date; v_pendency uuid; v_id uuid;
BEGIN
 SELECT * INTO v_batch FROM business.payroll_batches WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_batch AND status='integrated';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM business.portal_grants g WHERE g.tenant_id=v_batch.tenant_id AND g.id=p_grant AND g.company_id=v_batch.company_id AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until) OR EXISTS(SELECT 1 FROM business.payroll_accounting_links WHERE tenant_id=v_batch.tenant_id AND batch_id=p_batch AND grant_id=p_grant) THEN RETURN; END IF;
 SELECT competence INTO v_period FROM business.payroll_periods WHERE id=v_batch.period_id AND tenant_id=v_batch.tenant_id;
 SELECT pendency_id INTO v_pendency FROM business.create_accounting_pendency(p_grant,v_period,'Conferência de folha processada','Conferir lançamento agregado da competência '||to_char(v_period,'YYYY-MM')||'. Referência interna: '||p_batch::text||'. Nenhum valor individual ou documento foi compartilhado.',NULL,p_op);
 IF v_pendency IS NULL THEN RETURN; END IF;
 INSERT INTO business.payroll_accounting_links(tenant_id,company_id,batch_id,grant_id,pendency_id,operation_id,created_by) VALUES(v_batch.tenant_id,v_batch.company_id,p_batch,p_grant,v_pendency,p_op,current_setting('anna.actor_id',true)::uuid) RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION business.payroll_allowed(uuid,uuid),business.import_payroll_batch(uuid,text,text,jsonb,uuid),business.decide_payroll_batch(uuid,text,text,uuid),business.integrate_payroll_batch(uuid,uuid),business.handoff_payroll_batch(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.payroll_allowed(uuid,uuid),business.import_payroll_batch(uuid,text,text,jsonb,uuid),business.decide_payroll_batch(uuid,text,text,uuid),business.integrate_payroll_batch(uuid,uuid),business.handoff_payroll_batch(uuid,uuid,uuid) TO anna_business_runtime;
COMMIT;
