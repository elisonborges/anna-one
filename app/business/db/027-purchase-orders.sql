-- 027: pedido interno originado de cotação, sem obrigação financeira.
ALTER TABLE business.purchase_quotes ADD CONSTRAINT purchase_quotes_scope_key UNIQUE(tenant_id,request_id,id);
CREATE TABLE business.purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, request_id uuid NOT NULL, quote_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE, company_id uuid NOT NULL, supplier_id uuid NOT NULL, company_name text NOT NULL, supplier_name text NOT NULL,
 quote_reference text NOT NULL, valid_until date NOT NULL, delivery_days integer NOT NULL, payment_terms text NOT NULL,
 lines jsonb NOT NULL, total numeric(24,2) NOT NULL CHECK(total>=0), justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), revision integer NOT NULL DEFAULT 1,
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES public.app_users(id), decided_at timestamptz, decision_reason text, decision_operation uuid,
 FOREIGN KEY(tenant_id,request_id,quote_id) REFERENCES business.purchase_quotes(tenant_id,request_id,id),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,decision_operation),
 CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_operation IS NULL AND decision_reason IS NULL AND revision=1) OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_operation IS NOT NULL AND length(btrim(decision_reason)) BETWEEN 1 AND 1000 AND revision=2))
);
CREATE UNIQUE INDEX purchase_orders_one_live ON business.purchase_orders(tenant_id,request_id) WHERE status IN ('pending','approved');
ALTER TABLE business.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_read ON business.purchase_orders FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_orders.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_orders_insert ON business.purchase_orders FOR INSERT WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND status='pending' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_orders.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_orders_update ON business.purchase_orders FOR UPDATE USING(tenant_id::text=current_setting('anna.tenant_id',true) AND status='pending' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_orders.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK(tenant_id::text=current_setting('anna.tenant_id',true) AND status IN ('approved','rejected') AND decided_by::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_orders.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.purchase_orders FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_orders TO anna_business_runtime;
GRANT UPDATE(status,revision,decided_by,decided_at,decision_reason,decision_operation) ON business.purchase_orders TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.purchase_orders_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_purchase_order(p_request uuid,p_quote uuid,p_why text,p_op uuid)
RETURNS TABLE(order_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.purchase_orders(tenant_id,request_id,quote_id,company_id,supplier_id,company_name,supplier_name,quote_reference,valid_until,delivery_days,payment_terms,lines,total,justification,operation_id,created_by)
 SELECT r.tenant_id,r.id,q.id,r.company_id,q.supplier_id,r.company_name,q.supplier_name,q.reference,q.valid_until,q.delivery_days,q.payment_terms,q.lines,q.total,btrim(p_why),p_op,current_setting('anna.actor_id',true)::uuid
 FROM business.purchase_requests r JOIN business.purchase_quotes q ON q.tenant_id=r.tenant_id AND q.request_id=r.id JOIN core.parties s ON s.tenant_id=q.tenant_id AND s.id=q.supplier_id AND s.status='active'
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_request AND r.status='approved' AND q.id=p_quote AND q.valid_until >= (now() AT TIME ZONE 'America/Fortaleza')::date
 AND EXISTS(SELECT 1 FROM business.party_roles pr WHERE pr.tenant_id=q.tenant_id AND pr.party_id=q.supplier_id AND pr.role='supplier' AND pr.active)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,total
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'purchase_order',id,'create',p_op,jsonb_build_object('quote',p_quote,'total',total,'justification',p_why) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.decide_purchase_order(p_order uuid,p_revision integer,p_status text,p_reason text,p_op uuid)
RETURNS TABLE(order_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (
 UPDATE business.purchase_orders o SET status=p_status,revision=o.revision+1,decided_by=current_setting('anna.actor_id',true)::uuid,decided_at=now(),decision_reason=btrim(p_reason),decision_operation=p_op
 WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND o.status='pending' AND o.revision=p_revision AND p_status IN ('approved','rejected')
 AND (p_status='rejected' OR (o.valid_until >= (now() AT TIME ZONE 'America/Fortaleza')::date AND EXISTS(SELECT 1 FROM core.parties s JOIN business.party_roles pr ON pr.tenant_id=s.tenant_id AND pr.party_id=s.id WHERE s.tenant_id=o.tenant_id AND s.id=o.supplier_id AND s.status='active' AND pr.role='supplier' AND pr.active)))
 RETURNING o.id,o.tenant_id,o.decided_by,o.status
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,decided_by,'purchase_order',id,'update',p_op,jsonb_build_object('status',status,'reason',p_reason) FROM changed
 ) SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.create_purchase_order(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.decide_purchase_order(uuid,integer,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_purchase_order(uuid,uuid,text,uuid) TO anna_business_runtime;
GRANT EXECUTE ON FUNCTION business.decide_purchase_order(uuid,integer,text,text,uuid) TO anna_business_runtime;
