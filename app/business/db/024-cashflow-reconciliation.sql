-- 024: conferência documental de lançamentos escriturais.
CREATE VIEW business.treasury_movements WITH (security_invoker=true) AS
 SELECT l.tenant_id,l.account_id,s.id AS source_id,'settlement'::text AS kind,s.settled_on AS occurred_on,CASE WHEN o.direction='receivable' THEN s.cash_amount ELSE -s.cash_amount END AS amount,'BXA-'||s.code::text AS reference
 FROM business.treasury_settlement_links l JOIN business.financial_settlements s ON s.tenant_id=l.tenant_id AND s.id=l.settlement_id JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id
 UNION ALL SELECT l.tenant_id,l.account_id,s.id,'reversal',v.reversed_on,CASE WHEN o.direction='receivable' THEN -s.cash_amount ELSE s.cash_amount END,'BXA-'||s.code::text FROM business.treasury_settlement_links l JOIN business.financial_settlements s ON s.tenant_id=l.tenant_id AND s.id=l.settlement_id JOIN business.financial_reversals v ON v.tenant_id=s.tenant_id AND v.settlement_id=s.id JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id
 UNION ALL SELECT tenant_id,source_id,id,'transfer',occurred_on,-amount,reference FROM business.treasury_transfers
 UNION ALL SELECT tenant_id,destination_id,id,'transfer',occurred_on,amount,reference FROM business.treasury_transfers;
REVOKE ALL ON business.treasury_movements FROM PUBLIC;
GRANT SELECT ON business.treasury_movements TO anna_business_runtime;
CREATE TABLE business.treasury_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 account_id uuid NOT NULL,source_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('settlement','reversal','transfer')),
 book_date date NOT NULL,book_amount numeric(20,2) NOT NULL CHECK(book_amount<>0),
 statement_date date NOT NULL,statement_amount numeric(20,2) NOT NULL,
 statement_ref text NOT NULL CHECK(length(btrim(statement_ref)) BETWEEN 1 AND 200),
 note text CHECK(note IS NULL OR length(btrim(note)) BETWEEN 1 AND 300),
 result text NOT NULL CHECK(result IN ('matched','difference')),
 request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.treasury_accounts(tenant_id,id),
 CHECK((result='matched')=(book_amount=statement_amount)),
 CHECK(result<>'difference' OR note IS NOT NULL),
 UNIQUE(tenant_id,request_id),UNIQUE(tenant_id,id)
);
CREATE INDEX treasury_reconciliations_movement ON business.treasury_reconciliations(tenant_id,account_id,kind,source_id,created_at DESC);
CREATE TABLE business.treasury_reconciliation_voids (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reconciliation_id uuid NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES business.treasury_reconciliations(tenant_id,id),UNIQUE(tenant_id,reconciliation_id),UNIQUE(tenant_id,request_id)
);
ALTER TABLE business.treasury_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.treasury_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY treasury_reconciliations_read ON business.treasury_reconciliations FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_reconciliations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY treasury_reconciliations_insert ON business.treasury_reconciliations FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_reconciliations.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.treasury_reconciliations FROM PUBLIC;
GRANT SELECT,INSERT ON business.treasury_reconciliations TO anna_business_runtime;
ALTER TABLE business.treasury_reconciliation_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.treasury_reconciliation_voids FORCE ROW LEVEL SECURITY;
CREATE POLICY treasury_reconciliation_voids_read ON business.treasury_reconciliation_voids FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_reconciliation_voids.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY treasury_reconciliation_voids_insert ON business.treasury_reconciliation_voids FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_reconciliation_voids.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.treasury_reconciliation_voids FROM PUBLIC;
GRANT SELECT,INSERT ON business.treasury_reconciliation_voids TO anna_business_runtime;
CREATE FUNCTION business.reconcile_treasury_movement(p_account uuid,p_source uuid,p_kind text,p_date date,p_amount numeric,p_ref text,p_note text,p_request uuid)
RETURNS TABLE(reconciliation_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.treasury_reconciliations(tenant_id,account_id,source_id,kind,book_date,book_amount,statement_date,statement_amount,statement_ref,note,result,request_id,created_by)
 SELECT m.tenant_id,m.account_id,m.source_id,m.kind,m.occurred_on,m.amount,p_date,p_amount,btrim(p_ref),NULLIF(btrim(p_note),''),CASE WHEN m.amount=p_amount THEN 'matched' ELSE 'difference' END,p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.treasury_movements m JOIN business.treasury_accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
 WHERE m.tenant_id=current_setting('anna.tenant_id',true)::uuid AND m.account_id=p_account AND m.source_id=p_source AND m.kind=p_kind AND p_date BETWEEN a.opening_on AND (now() AT TIME ZONE 'America/Fortaleza')::date AND p_amount=round(p_amount,2) AND abs(p_amount)<=999999999999999999.99 AND length(btrim(p_ref)) BETWEEN 1 AND 200 AND (m.amount=p_amount OR length(btrim(p_note)) BETWEEN 1 AND 300)
 AND NOT EXISTS (SELECT 1 FROM business.treasury_reconciliations r WHERE r.tenant_id=m.tenant_id AND NOT EXISTS(SELECT 1 FROM business.treasury_reconciliation_voids v WHERE v.tenant_id=r.tenant_id AND v.reconciliation_id=r.id) AND ((r.account_id=m.account_id AND r.source_id=m.source_id AND r.kind=m.kind) OR (r.account_id=m.account_id AND lower(btrim(r.statement_ref))=lower(btrim(p_ref)))))
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,result
 ), logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'treasury_reconciliation',id,'create',p_request,jsonb_build_object('result',result,'account_id',p_account) FROM inserted)
 SELECT id FROM inserted
$$;
CREATE FUNCTION business.void_treasury_reconciliation(p_id uuid,p_reason text,p_request uuid)
RETURNS TABLE(void_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (INSERT INTO business.treasury_reconciliation_voids(tenant_id,reconciliation_id,reason,request_id,created_by)
 SELECT r.tenant_id,r.id,btrim(p_reason),p_request,current_setting('anna.actor_id',true)::uuid FROM business.treasury_reconciliations r WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_id AND length(btrim(p_reason)) BETWEEN 1 AND 300 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by),
 logged AS (INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details) SELECT tenant_id,created_by,'treasury_reconciliation_void',id,'create',p_request,jsonb_build_object('reconciliation_id',p_id) FROM inserted)
 SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.reconcile_treasury_movement(uuid,uuid,text,date,numeric,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.reconcile_treasury_movement(uuid,uuid,text,date,numeric,text,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.void_treasury_reconciliation(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.void_treasury_reconciliation(uuid,text,uuid) TO anna_business_runtime;
