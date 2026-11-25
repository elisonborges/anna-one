-- 010: CRM comercial inicial, oportunidades e interações.
CREATE TABLE business.opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 party_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 stage text NOT NULL DEFAULT 'prospecting' CHECK(stage IN ('prospecting','qualified','proposal','negotiation','won','lost')),
 estimated_value numeric(14,2) CHECK(estimated_value>=0),
 expected_close date,
 next_followup date,
 loss_reason text CHECK(loss_reason IS NULL OR length(btrim(loss_reason)) BETWEEN 1 AND 300),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((stage='lost' AND loss_reason IS NOT NULL) OR (stage<>'lost' AND loss_reason IS NULL)),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id)
);
CREATE INDEX opportunities_by_stage ON business.opportunities(tenant_id,stage,next_followup);
CREATE TABLE business.crm_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 opportunity_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('phone','email','meeting','message','visit','other')),
 interaction_date date NOT NULL,
 summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES business.opportunities(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX crm_interactions_by_opportunity ON business.crm_interactions(tenant_id,opportunity_id,interaction_date DESC);
ALTER TABLE business.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.opportunities FORCE ROW LEVEL SECURITY;
ALTER TABLE business.crm_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.crm_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunities_read ON business.opportunities FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=opportunities.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor')));
CREATE POLICY opportunities_insert ON business.opportunities FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=opportunities.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor')) AND created_by::text=current_setting('anna.actor_id',true) AND stage='prospecting' AND revision=1 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=opportunities.tenant_id AND p.id=opportunities.party_id AND p.status='active'));
CREATE POLICY opportunities_update ON business.opportunities FOR UPDATE USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=opportunities.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor'))) WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=opportunities.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor')));
CREATE POLICY crm_interactions_read ON business.crm_interactions FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=crm_interactions.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor')));
CREATE POLICY crm_interactions_insert ON business.crm_interactions FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=crm_interactions.tenant_id AND m.active AND t.kind='internal' AND t.status='active' AND m.role IN ('owner','registry_editor')) AND created_by::text=current_setting('anna.actor_id',true) AND interaction_date<=CURRENT_DATE);
REVOKE ALL ON business.opportunities,business.crm_interactions FROM PUBLIC;
GRANT SELECT,INSERT ON business.opportunities,business.crm_interactions TO anna_business_runtime;
GRANT UPDATE(stage,estimated_value,expected_close,next_followup,loss_reason,revision,updated_at,title) ON business.opportunities TO anna_business_runtime;
CREATE FUNCTION business.create_opportunity(p_party uuid,p_title text,p_value numeric,p_close date,p_followup date,p_request uuid)
RETURNS TABLE(opportunity_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.opportunities(tenant_id,party_id,title,estimated_value,expected_close,next_followup,created_by)
 VALUES(current_setting('anna.tenant_id',true)::uuid,p_party,btrim(p_title),p_value,p_close,p_followup,current_setting('anna.actor_id',true)::uuid)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'opportunity',id,'create',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.update_opportunity(p_id uuid,p_revision integer,p_title text,p_stage text,p_value numeric,p_close date,p_followup date,p_loss text,p_request uuid)
RETURNS TABLE(opportunity_id uuid,new_revision integer) LANGUAGE sql SECURITY INVOKER AS $$
 WITH previous AS MATERIALIZED (
 SELECT * FROM business.opportunities WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND id=p_id AND revision=p_revision
 AND stage NOT IN ('won','lost')
 ), changed AS (
 UPDATE business.opportunities o SET title=btrim(p_title),stage=p_stage,estimated_value=p_value,expected_close=p_close,next_followup=CASE WHEN p_stage IN ('won','lost') THEN NULL ELSE p_followup END,loss_reason=NULLIF(btrim(p_loss),''),revision=o.revision+1,updated_at=now()
 FROM previous p WHERE o.id=p.id AND o.tenant_id=p.tenant_id AND o.revision=p_revision
 RETURNING o.id,o.tenant_id,o.revision,o.stage,p.stage AS old_stage,p.estimated_value AS old_value,o.estimated_value
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,current_setting('anna.actor_id',true)::uuid,'opportunity',id,'update',p_request,jsonb_build_object('old_stage',old_stage,'new_stage',stage,'old_value',old_value,'new_value',estimated_value,'revision',revision) FROM changed
 ) SELECT id,revision FROM changed
$$;
CREATE FUNCTION business.add_crm_interaction(p_opportunity uuid,p_channel text,p_date date,p_summary text,p_request uuid)
RETURNS TABLE(interaction_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.crm_interactions(tenant_id,opportunity_id,channel,interaction_date,summary,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_opportunity,p_channel,p_date,btrim(p_summary),current_setting('anna.actor_id',true)::uuid
 WHERE EXISTS (SELECT 1 FROM business.opportunities o WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_opportunity)
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'crm_interaction',id,'create',p_request,jsonb_build_object('opportunity_id',p_opportunity,'channel',p_channel) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_opportunity(uuid,text,numeric,date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_opportunity(uuid,text,numeric,date,date,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.update_opportunity(uuid,integer,text,text,numeric,date,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.update_opportunity(uuid,integer,text,text,numeric,date,date,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.add_crm_interaction(uuid,text,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_crm_interaction(uuid,text,date,text,uuid) TO anna_business_runtime;
