-- 017: aditivos e renovações com condições anteriores e posteriores imutáveis.
CREATE TABLE business.contract_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 contract_id uuid NOT NULL,
 base_revision integer NOT NULL CHECK(base_revision>=1),
 kind text NOT NULL CHECK(kind IN ('amendment','renewal')),
 old_total numeric(26,2) NOT NULL CHECK(old_total>=0),
 new_total numeric(26,2) NOT NULL CHECK(new_total>=0),
 old_terms text,
 new_terms text CHECK(new_terms IS NULL OR length(btrim(new_terms)) BETWEEN 1 AND 300),
 old_until date,
 new_until date,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','applied','rejected')),
 signed_on date,
 signature_ref text CHECK(signature_ref IS NULL OR length(btrim(signature_ref)) BETWEEN 1 AND 200),
 effective_on date,
 decision_reason text CHECK(decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 300),
 decided_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
 decided_at timestamptz,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id) ON DELETE RESTRICT,
 CHECK((status='draft' AND decided_by IS NULL AND decided_at IS NULL AND signed_on IS NULL AND signature_ref IS NULL AND effective_on IS NULL AND decision_reason IS NULL) OR (status='applied' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND signed_on IS NOT NULL AND signature_ref IS NOT NULL AND effective_on IS NOT NULL AND decision_reason IS NULL) OR (status='rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND signed_on IS NULL AND signature_ref IS NULL AND effective_on IS NULL)),
 CHECK(kind<>'renewal' OR (old_until IS NOT NULL AND new_until IS NOT NULL AND new_until>old_until))
);
CREATE UNIQUE INDEX contract_amendments_one_draft ON business.contract_amendments(tenant_id,contract_id) WHERE status='draft';
ALTER TABLE business.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.contract_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_amendments_read ON business.contract_amendments FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY contract_amendments_insert ON business.contract_amendments FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND status='draft' AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY contract_amendments_update ON business.contract_amendments FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role='owner')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=contract_amendments.tenant_id AND m.active AND m.role='owner'));
REVOKE ALL ON business.contract_amendments FROM PUBLIC;
GRANT SELECT,INSERT ON business.contract_amendments TO anna_business_runtime;
GRANT UPDATE(status,signed_on,signature_ref,effective_on,decision_reason,decided_by,decided_at) ON business.contract_amendments TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.contract_amendments_code_seq TO anna_business_runtime;
GRANT UPDATE(total,payment_terms,valid_until) ON business.contracts TO anna_business_runtime;
CREATE FUNCTION business.create_contract_amendment(p_contract uuid,p_revision integer,p_kind text,p_total numeric,p_terms text,p_until date,p_reason text,p_request uuid)
RETURNS TABLE(amendment_id uuid,amendment_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 inserted AS (
 INSERT INTO business.contract_amendments(tenant_id,contract_id,base_revision,kind,old_total,new_total,old_terms,new_terms,old_until,new_until,reason,created_by)
 SELECT c.tenant_id,c.id,c.revision,p_kind,c.total,p_total,c.payment_terms,NULLIF(btrim(p_terms),''),c.valid_until,p_until,btrim(p_reason),current_setting('anna.actor_id',true)::uuid
 FROM business.contracts c CROSS JOIN clock
 WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.id=p_contract AND c.revision=p_revision AND c.status IN ('signed','active','suspended') AND c.signed_on IS NOT NULL
 AND (c.valid_until IS NULL OR c.valid_until>=clock.today) AND (p_until IS NULL OR p_until>=GREATEST(c.valid_from,clock.today))
 AND p_total>=0 AND p_total=round(p_total,2) AND (p_kind='amendment' OR (p_kind='renewal' AND c.valid_until IS NOT NULL AND p_until>c.valid_until))
 AND (c.total,c.payment_terms,c.valid_until) IS DISTINCT FROM (p_total,NULLIF(btrim(p_terms),''),p_until)
 ON CONFLICT(tenant_id,contract_id) WHERE status='draft' DO NOTHING
 RETURNING id,code,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'contract_amendment',id,'create',p_request,jsonb_build_object('contract_id',p_contract,'base_revision',p_revision,'kind',p_kind) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.decide_contract_amendment(p_id uuid,p_decision text,p_reference text,p_signed_on date,p_request uuid)
RETURNS TABLE(amendment_id uuid,new_status text,contract_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 eligible AS MATERIALIZED (
 SELECT a.*,clock.today FROM business.contract_amendments a JOIN business.contracts c ON c.tenant_id=a.tenant_id AND c.id=a.contract_id CROSS JOIN clock
 WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.id=p_id AND a.status='draft'
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=a.tenant_id AND m.active AND m.role='owner' AND m.user_id=current_setting('anna.actor_id',true)::uuid)
 AND ((p_decision='rejected' AND p_signed_on IS NULL AND length(btrim(p_reference)) BETWEEN 1 AND 300) OR
 (p_decision='applied' AND length(btrim(p_reference)) BETWEEN 1 AND 200 AND p_signed_on BETWEEN c.signed_on AND clock.today AND c.revision=a.base_revision AND c.status IN ('signed','active','suspended') AND (c.valid_until IS NULL OR c.valid_until>=clock.today) AND (a.new_until IS NULL OR a.new_until>=GREATEST(c.valid_from,clock.today))
 AND (c.total,c.payment_terms,c.valid_until) IS NOT DISTINCT FROM (a.old_total,a.old_terms,a.old_until)))
 ), changed_contract AS (
 UPDATE business.contracts c SET total=e.new_total,payment_terms=e.new_terms,valid_until=e.new_until,revision=c.revision+1,updated_at=now()
 FROM eligible e WHERE p_decision='applied' AND c.tenant_id=e.tenant_id AND c.id=e.contract_id AND c.revision=e.base_revision
 RETURNING c.id,c.tenant_id,c.revision
 ), changed AS (
 UPDATE business.contract_amendments a SET status=p_decision,signed_on=CASE WHEN p_decision='applied' THEN p_signed_on END,signature_ref=CASE WHEN p_decision='applied' THEN btrim(p_reference) END,effective_on=CASE WHEN p_decision='applied' THEN e.today END,decision_reason=CASE WHEN p_decision='rejected' THEN btrim(p_reference) END,decided_by=current_setting('anna.actor_id',true)::uuid,decided_at=now()
 FROM eligible e WHERE a.id=e.id AND a.tenant_id=e.tenant_id AND a.status='draft' AND (p_decision='rejected' OR EXISTS (SELECT 1 FROM changed_contract c WHERE c.id=e.contract_id AND c.tenant_id=e.tenant_id))
 RETURNING a.id,a.status,a.tenant_id,a.contract_id,a.decided_by,a.old_total,a.new_total,a.old_until,a.new_until
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,decided_by,'contract_amendment',id,'update',p_request,jsonb_build_object('status',status,'contract_id',contract_id,'old_total',old_total,'new_total',new_total,'old_until',old_until,'new_until',new_until) FROM changed
 UNION ALL SELECT c.tenant_id,current_setting('anna.actor_id',true)::uuid,'contract',c.id,'update',p_request,jsonb_build_object('source','amendment','revision',c.revision) FROM changed_contract c
 ) SELECT id,status,contract_id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_contract_amendment(uuid,integer,text,numeric,text,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_contract_amendment(uuid,integer,text,numeric,text,date,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.decide_contract_amendment(uuid,text,text,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.decide_contract_amendment(uuid,text,text,date,uuid) TO anna_business_runtime;
