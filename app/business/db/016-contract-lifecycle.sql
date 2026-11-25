-- 016: ciclo de vida contratual declaratório e auditado.
ALTER TABLE business.contracts DROP CONSTRAINT contracts_status_check;
ALTER TABLE business.contracts ADD CONSTRAINT contracts_status_check CHECK(status IN ('draft','submitted','approved','rejected','signed','active','suspended','terminated','expired'));
ALTER TABLE business.contracts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE business.contracts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE business.contracts ADD COLUMN signed_on date;
ALTER TABLE business.contracts ADD COLUMN signature_ref text CHECK(signature_ref IS NULL OR length(btrim(signature_ref)) BETWEEN 1 AND 200);
ALTER TABLE business.contracts ADD COLUMN activated_at timestamptz;
ALTER TABLE business.contracts ADD COLUMN ended_on date;
ALTER TABLE business.contracts ADD CONSTRAINT contracts_signature_consistency CHECK((signed_on IS NULL)=(signature_ref IS NULL));
ALTER TABLE business.commercial_orders DROP CONSTRAINT commercial_orders_status_check;
ALTER TABLE business.commercial_orders ADD CONSTRAINT commercial_orders_status_check CHECK(status IN ('pending_contract','contract_formalized'));
CREATE POLICY contracts_lifecycle_update ON business.contracts FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contracts.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contracts.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(status,revision,updated_at,signed_on,signature_ref,activated_at,ended_on) ON business.contracts TO anna_business_runtime;
CREATE POLICY commercial_orders_contract_update ON business.commercial_orders FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=commercial_orders.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=commercial_orders.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(status) ON business.commercial_orders TO anna_business_runtime;
CREATE TABLE business.contract_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 from_status text NOT NULL,
 to_status text NOT NULL,
 reference text CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 300),
 effective_on date NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,request_id)
);
ALTER TABLE business.contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.contract_events FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_events_read ON business.contract_events FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_events.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY contract_events_insert ON business.contract_events FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contract_events.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.contract_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.contract_events TO anna_business_runtime;
CREATE FUNCTION business.advance_contract(p_id uuid,p_revision integer,p_next text,p_reference text,p_signed_on date,p_request uuid)
RETURNS TABLE(contract_id uuid,new_status text,new_revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 previous AS MATERIALIZED (
 SELECT c.*,clock.today FROM business.contracts c CROSS JOIN clock WHERE c.tenant_id=current_setting('anna.tenant_id',true)::uuid AND c.id=p_id AND c.revision=p_revision
 AND ((c.status='draft' AND p_next='submitted') OR (c.status='submitted' AND p_next IN ('approved','rejected')) OR (c.status='approved' AND p_next='signed') OR (c.status='signed' AND p_next IN ('active','terminated','expired')) OR (c.status='active' AND p_next IN ('suspended','terminated','expired')) OR (c.status='suspended' AND p_next IN ('active','terminated','expired')))
 AND (p_next='submitted' OR EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=c.tenant_id AND m.user_id=current_setting('anna.actor_id',true)::uuid AND m.active AND m.role='owner'))
 AND (p_next NOT IN ('rejected','signed','suspended','terminated') OR length(btrim(p_reference)) BETWEEN 1 AND CASE WHEN p_next='signed' THEN 200 ELSE 300 END)
 AND ((p_next='signed' AND p_signed_on IS NOT NULL AND p_signed_on<=clock.today AND (c.valid_until IS NULL OR p_signed_on<=c.valid_until)) OR (p_next<>'signed' AND p_signed_on IS NULL))
 AND (p_next<>'active' OR (c.signed_on IS NOT NULL AND clock.today>=c.valid_from AND (c.valid_until IS NULL OR clock.today<=c.valid_until)))
 AND (p_next<>'expired' OR (c.valid_until IS NOT NULL AND clock.today>c.valid_until))
 AND (p_next NOT IN ('submitted','approved','signed','suspended') OR c.valid_until IS NULL OR clock.today<=c.valid_until)
 ), changed AS (
 UPDATE business.contracts c SET status=p_next,revision=c.revision+1,updated_at=now(),
 signed_on=CASE WHEN p_next='signed' THEN p_signed_on ELSE c.signed_on END,
 signature_ref=CASE WHEN p_next='signed' THEN btrim(p_reference) ELSE c.signature_ref END,
 activated_at=CASE WHEN p_next='active' THEN COALESCE(c.activated_at,now()) ELSE c.activated_at END,
 ended_on=CASE WHEN p_next='expired' THEN v.valid_until WHEN p_next='terminated' THEN v.today ELSE c.ended_on END
 FROM previous v WHERE c.id=v.id AND c.tenant_id=v.tenant_id AND c.revision=p_revision
 RETURNING c.id,c.tenant_id,c.status,c.revision,c.order_id,v.status AS old_status,v.today
 ), order_changed AS (
 UPDATE business.commercial_orders o SET status='contract_formalized' FROM changed c WHERE c.status='signed' AND o.tenant_id=c.tenant_id AND o.id=c.order_id AND o.status='pending_contract'
 RETURNING o.id,o.tenant_id
 ), history AS (
 INSERT INTO business.contract_events(tenant_id,contract_id,from_status,to_status,reference,effective_on,created_by,request_id)
 SELECT tenant_id,id,old_status,status,NULLIF(btrim(p_reference),''),CASE WHEN status='signed' THEN p_signed_on ELSE today END,current_setting('anna.actor_id',true)::uuid,p_request FROM changed
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'contract',id,'update',p_request,jsonb_build_object('old_status',old_status,'new_status',status,'revision',revision) FROM changed
 UNION ALL SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'commercial_order',id,'update',p_request,jsonb_build_object('new_status','contract_formalized') FROM order_changed
 ) SELECT id,status,revision FROM changed
$$;
REVOKE ALL ON FUNCTION business.advance_contract(uuid,integer,text,text,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.advance_contract(uuid,integer,text,text,date,uuid) TO anna_business_runtime;
