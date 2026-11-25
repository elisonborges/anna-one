-- 022: tesouraria declaratoria, sem integracao bancaria.
CREATE TABLE business.treasury_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 company_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('bank','cash')),
 opening_on date NOT NULL,
 opening_balance numeric(20,2) NOT NULL,
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_id)
);
CREATE UNIQUE INDEX treasury_accounts_name ON business.treasury_accounts(tenant_id,company_id,lower(btrim(name)));
CREATE TABLE business.treasury_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 source_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 amount numeric(20,2) NOT NULL CHECK(amount>0),
 occurred_on date NOT NULL,
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_id<>destination_id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES business.treasury_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,destination_id) REFERENCES business.treasury_accounts(tenant_id,id),
 UNIQUE(tenant_id,request_id), UNIQUE(tenant_id,id)
);
CREATE TABLE business.treasury_settlement_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 settlement_id uuid NOT NULL,
 account_id uuid NOT NULL,
 request_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,settlement_id) REFERENCES business.financial_settlements(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.treasury_accounts(tenant_id,id),
 UNIQUE(tenant_id,settlement_id), UNIQUE(tenant_id,request_id)
);
ALTER TABLE business.treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.treasury_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY treasury_accounts_read ON business.treasury_accounts FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_accounts.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY treasury_accounts_insert ON business.treasury_accounts FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_accounts.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.treasury_accounts FROM PUBLIC;
GRANT SELECT,INSERT ON business.treasury_accounts TO anna_business_runtime;
ALTER TABLE business.treasury_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.treasury_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY treasury_transfers_read ON business.treasury_transfers FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_transfers.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY treasury_transfers_insert ON business.treasury_transfers FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_transfers.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.treasury_transfers FROM PUBLIC;
GRANT SELECT,INSERT ON business.treasury_transfers TO anna_business_runtime;
ALTER TABLE business.treasury_settlement_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.treasury_settlement_links FORCE ROW LEVEL SECURITY;
CREATE POLICY treasury_settlement_links_read ON business.treasury_settlement_links FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_settlement_links.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active'));
CREATE POLICY treasury_settlement_links_insert ON business.treasury_settlement_links FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=treasury_settlement_links.tenant_id AND m.active AND m.role='owner' AND m.user_id::text=current_setting('anna.actor_id',true) AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.treasury_settlement_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.treasury_settlement_links TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.treasury_accounts_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_treasury_account(p_company uuid,p_name text,p_kind text,p_date date,p_balance numeric,p_reference text,p_request uuid)
RETURNS TABLE(account_id uuid,account_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.treasury_accounts(tenant_id,company_id,name,kind,opening_on,opening_balance,reference,request_id,created_by)
 SELECT b.tenant_id,b.party_id,btrim(p_name),p_kind,p_date,p_balance,btrim(p_reference),p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id AND p.status='active'
 WHERE b.tenant_id=current_setting('anna.tenant_id',true)::uuid AND b.party_id=p_company AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND p_balance=round(p_balance,2) AND abs(p_balance)<=999999999999999999.99
 ON CONFLICT DO NOTHING RETURNING id,code,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'treasury_account',id,'create',p_request,jsonb_build_object('opening_balance',p_balance,'opening_on',p_date) FROM inserted
 ) SELECT id,code FROM inserted
$$;
CREATE FUNCTION business.record_treasury_transfer(p_source uuid,p_destination uuid,p_amount numeric,p_date date,p_reference text,p_request uuid)
RETURNS TABLE(transfer_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.treasury_transfers(tenant_id,source_id,destination_id,amount,occurred_on,reference,request_id,created_by)
 SELECT a.tenant_id,a.id,b.id,p_amount,p_date,btrim(p_reference),p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.treasury_accounts a JOIN business.treasury_accounts b ON b.tenant_id=a.tenant_id AND b.company_id=a.company_id
 WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.id=p_source AND b.id=p_destination AND a.id<>b.id AND p_amount>0 AND p_amount=round(p_amount,2) AND p_amount<=999999999999999999.99 AND p_date BETWEEN GREATEST(a.opening_on,b.opening_on) AND (now() AT TIME ZONE 'America/Fortaleza')::date
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'treasury_transfer',id,'create',p_request,jsonb_build_object('source_id',p_source,'destination_id',p_destination,'amount',p_amount) FROM inserted
 ) SELECT id FROM inserted
$$;
CREATE FUNCTION business.link_treasury_settlement(p_settlement uuid,p_account uuid,p_request uuid)
RETURNS TABLE(link_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.treasury_settlement_links(tenant_id,settlement_id,account_id,request_id,created_by)
 SELECT a.tenant_id,s.id,a.id,p_request,current_setting('anna.actor_id',true)::uuid
 FROM business.treasury_accounts a JOIN business.financial_settlements s ON s.tenant_id=a.tenant_id JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id AND o.company_id=a.company_id
 WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.id=p_account AND s.id=p_settlement AND s.cash_amount>0 AND s.settled_on>=a.opening_on
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'treasury_link',id,'create',p_request,jsonb_build_object('settlement_id',p_settlement,'account_id',p_account) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_treasury_account(uuid,text,text,date,numeric,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_treasury_account(uuid,text,text,date,numeric,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.record_treasury_transfer(uuid,uuid,numeric,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.record_treasury_transfer(uuid,uuid,numeric,date,text,uuid) TO anna_business_runtime;
REVOKE ALL ON FUNCTION business.link_treasury_settlement(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.link_treasury_settlement(uuid,uuid,uuid) TO anna_business_runtime;
