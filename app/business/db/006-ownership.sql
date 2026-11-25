-- 006: participações societárias diretas declaradas, independentes de grupos e supervisão.
CREATE TABLE core.ownership_interests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,
 shareholder_id uuid NOT NULL,
 capital_pct numeric(9,6) NOT NULL CHECK(capital_pct>0 AND capital_pct<=100),
 vote_pct numeric(9,6) CHECK(vote_pct>=0 AND vote_pct<=100),
 declared_control text NOT NULL DEFAULT 'unspecified' CHECK(declared_control IN ('unspecified','individual','joint','none')),
 valid_from date NOT NULL DEFAULT CURRENT_DATE,
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(company_id<>shareholder_id),
 FOREIGN KEY(tenant_id,company_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,shareholder_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,company_id,shareholder_id)
);
ALTER TABLE core.ownership_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ownership_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY ownership_read ON core.ownership_interests FOR SELECT USING (
 tenant_id::text=current_setting('anna.tenant_id',true)
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=ownership_interests.tenant_id AND m.active AND t.kind='internal' AND t.status='active')
);
CREATE POLICY ownership_insert ON core.ownership_interests FOR INSERT WITH CHECK (
 tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND valid_from=CURRENT_DATE
 AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=ownership_interests.tenant_id AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=ownership_interests.tenant_id AND p.id=ownership_interests.company_id AND p.kind='PJ' AND p.status='active')
 AND EXISTS (SELECT 1 FROM core.parties p WHERE p.tenant_id=ownership_interests.tenant_id AND p.id=ownership_interests.shareholder_id AND p.status='active')
);
REVOKE ALL ON core.ownership_interests FROM PUBLIC;
GRANT SELECT,INSERT ON core.ownership_interests TO anna_business_runtime;
-- Executar por API em transação SERIALIZABLE, inclusive para somas concorrentes.
CREATE FUNCTION business.add_ownership_interest(p_company uuid,p_shareholder uuid,p_capital numeric,p_vote numeric,p_control text,p_request uuid)
RETURNS TABLE(interest_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH totals AS (
 SELECT COALESCE(sum(capital_pct),0) AS capital,COALESCE(sum(vote_pct),0) AS votes FROM core.ownership_interests
 WHERE tenant_id=current_setting('anna.tenant_id',true)::uuid AND company_id=p_company
 ), inserted AS (
 INSERT INTO core.ownership_interests(tenant_id,company_id,shareholder_id,capital_pct,vote_pct,declared_control,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_company,p_shareholder,p_capital,p_vote,p_control,current_setting('anna.actor_id',true)::uuid
 FROM totals WHERE p_capital>0 AND p_capital<=100 AND p_capital=round(p_capital,6) AND (p_vote IS NULL OR (p_vote>=0 AND p_vote<=100 AND p_vote=round(p_vote,6)))
 AND totals.capital+p_capital<=100 AND totals.votes+COALESCE(p_vote,0)<=100
 ON CONFLICT(tenant_id,company_id,shareholder_id) DO NOTHING
 RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id)
 SELECT tenant_id,created_by,'ownership_interest',id,'link',p_request FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.add_ownership_interest(uuid,uuid,numeric,numeric,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.add_ownership_interest(uuid,uuid,numeric,numeric,text,uuid) TO anna_business_runtime;
