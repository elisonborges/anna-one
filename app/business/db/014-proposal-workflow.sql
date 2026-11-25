-- 014: fluxo comercial controlado, sem faturamento ou contrato automático.
ALTER TABLE business.proposals DROP CONSTRAINT proposals_status_check;
ALTER TABLE business.proposals ADD CONSTRAINT proposals_status_check CHECK(status IN ('draft','submitted','approved','issued','accepted','declined','rejected','converted'));
ALTER TABLE business.proposals ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE business.proposals ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE business.proposals ADD COLUMN emitted_at timestamptz;
CREATE TABLE business.proposal_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 proposal_id uuid NOT NULL,
 from_status text NOT NULL,
 to_status text NOT NULL,
 reference text CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 300),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,proposal_id) REFERENCES business.proposals(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,request_id)
);
CREATE TABLE business.commercial_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 proposal_id uuid NOT NULL,
 total numeric(26,2) NOT NULL CHECK(total>=0),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 status text NOT NULL DEFAULT 'pending_contract' CHECK(status='pending_contract'),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,proposal_id) REFERENCES business.proposals(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,proposal_id)
);
ALTER POLICY proposals_insert ON business.proposals WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposals.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND status='draft' AND revision=1 AND emitted_at IS NULL);
CREATE POLICY proposals_workflow_update ON business.proposals FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposals.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposals.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
GRANT UPDATE(status,revision,updated_at,emitted_at) ON business.proposals TO anna_business_runtime;
ALTER TABLE business.proposal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.proposal_events FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_events_read ON business.proposal_events FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposal_events.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY proposal_events_insert ON business.proposal_events FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposal_events.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.proposal_events FROM PUBLIC;
GRANT SELECT,INSERT ON business.proposal_events TO anna_business_runtime;
ALTER TABLE business.commercial_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.commercial_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_orders_read ON business.commercial_orders FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=commercial_orders.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY commercial_orders_insert ON business.commercial_orders FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=commercial_orders.tenant_id AND m.active AND m.role IN ('owner') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.commercial_orders FROM PUBLIC;
GRANT SELECT,INSERT ON business.commercial_orders TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.commercial_orders_code_seq TO anna_business_runtime;
-- Uma instrução atômica, executada em transação SERIALIZABLE pela API.
CREATE FUNCTION business.advance_proposal(p_id uuid,p_revision integer,p_next text,p_reference text,p_request uuid)
RETURNS TABLE(proposal_id uuid,new_status text,new_revision integer,order_id uuid,order_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT p.id,p.tenant_id,p.status,p.revision,p.opportunity_id,p.customer_id,
 (SELECT sum(l.net) FROM business.proposal_lines l WHERE l.tenant_id=p.tenant_id AND l.proposal_id=p.id) AS total
 FROM business.proposals p WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_id AND p.revision=p_revision
 AND ((p.status='draft' AND p_next='submitted') OR (p.status='submitted' AND p_next IN ('approved','rejected')) OR (p.status='approved' AND p_next='issued') OR (p.status='issued' AND p_next IN ('accepted','declined')) OR (p.status='accepted' AND p_next='converted'))
 AND (p_next IN ('declined','rejected','converted') OR p.valid_until>=CURRENT_DATE)
 AND (p_next NOT IN ('approved','rejected','converted') OR EXISTS (SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=p.tenant_id AND m.user_id=current_setting('anna.actor_id',true)::uuid AND m.role='owner' AND m.active))
 AND (p_next NOT IN ('rejected','accepted','declined') OR length(btrim(p_reference)) BETWEEN 1 AND 300)
 AND (p_next<>'converted' OR p.opportunity_id IS NULL OR EXISTS (SELECT 1 FROM business.opportunities o WHERE o.tenant_id=p.tenant_id AND o.id=p.opportunity_id AND o.party_id=p.customer_id AND o.stage NOT IN ('won','lost')))
 ), changed AS (
 UPDATE business.proposals p SET status=p_next,revision=p.revision+1,updated_at=now(),emitted_at=CASE WHEN p_next='issued' THEN now() ELSE p.emitted_at END
 FROM previous v WHERE p.id=v.id AND p.tenant_id=v.tenant_id AND p.revision=p_revision AND v.total IS NOT NULL
 RETURNING p.id,p.tenant_id,p.status,p.revision,p.opportunity_id,v.status AS old_status,v.total
 ), order_created AS (
 INSERT INTO business.commercial_orders(tenant_id,proposal_id,total,created_by)
 SELECT tenant_id,id,total,current_setting('anna.actor_id',true)::uuid FROM changed WHERE status='converted'
 RETURNING id,code,proposal_id
 ), crm_changed AS (
 UPDATE business.opportunities o SET stage='won',next_followup=NULL,loss_reason=NULL,revision=o.revision+1,updated_at=now()
 FROM changed c JOIN order_created x ON x.proposal_id=c.id
 WHERE o.tenant_id=c.tenant_id AND o.id=c.opportunity_id AND o.stage NOT IN ('won','lost')
 RETURNING o.id,o.tenant_id,o.revision
 ), history AS (
 INSERT INTO business.proposal_events(tenant_id,proposal_id,from_status,to_status,reference,created_by,request_id)
 SELECT tenant_id,id,old_status,status,NULLIF(btrim(p_reference),''),current_setting('anna.actor_id',true)::uuid,p_request FROM changed
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'proposal',id,'update',p_request,jsonb_build_object('old_status',old_status,'new_status',status,'revision',revision) FROM changed
 UNION ALL SELECT c.tenant_id,current_setting('anna.actor_id',true)::uuid,'commercial_order',x.id,'create',p_request,jsonb_build_object('proposal_id',c.id,'total',c.total) FROM changed c JOIN order_created x ON x.proposal_id=c.id
 UNION ALL SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'opportunity',id,'update',p_request,jsonb_build_object('new_stage','won','revision',revision,'source','proposal_conversion') FROM crm_changed
 ) SELECT c.id,c.status,c.revision,x.id,x.code FROM changed c LEFT JOIN order_created x ON x.proposal_id=c.id
$$;
REVOKE ALL ON FUNCTION business.advance_proposal(uuid,integer,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.advance_proposal(uuid,integer,text,text,uuid) TO anna_business_runtime;
