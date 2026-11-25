-- 015: preparação contratual a partir de pedidos comerciais, sem ativação de direitos.
CREATE TABLE business.contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 order_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 seller_id uuid NOT NULL,
 payer_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 contract_kind text NOT NULL CHECK(contract_kind IN ('sale','service','license','mixed')),
 customer_name text NOT NULL,
 seller_name text NOT NULL,
 payer_name text NOT NULL,
 total numeric(26,2) NOT NULL CHECK(total>=0),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 valid_from date NOT NULL,
 valid_until date,
 payment_terms text CHECK(payment_terms IS NULL OR length(btrim(payment_terms)) BETWEEN 1 AND 300),
 instrument_ref text CHECK(instrument_ref IS NULL OR length(btrim(instrument_ref)) BETWEEN 1 AND 200),
 notes text CHECK(notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 FOREIGN KEY(tenant_id,order_id) REFERENCES business.commercial_orders(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,customer_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,seller_id) REFERENCES business.companies(tenant_id,party_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,payer_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,order_id),
 UNIQUE(tenant_id,id)
);
ALTER TABLE business.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY contracts_read ON business.contracts FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contracts.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY contracts_insert ON business.contracts FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=contracts.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true) AND status='draft');
REVOKE ALL ON business.contracts FROM PUBLIC;
GRANT SELECT,INSERT ON business.contracts TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.contracts_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_contract(p_order uuid,p_payer uuid,p_title text,p_kind text,p_from date,p_until date,p_terms text,p_reference text,p_notes text,p_request uuid)
RETURNS TABLE(contract_id uuid,contract_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (
 INSERT INTO business.contracts(tenant_id,order_id,customer_id,seller_id,payer_id,title,contract_kind,customer_name,seller_name,payer_name,total,valid_from,valid_until,payment_terms,instrument_ref,notes,created_by)
 SELECT o.tenant_id,o.id,p.customer_id,p.seller_id,pay.id,btrim(p_title),p_kind,p.customer_name,p.seller_name,pay.legal_name,o.total,p_from,p_until,COALESCE(NULLIF(btrim(p_terms),''),p.payment_terms),NULLIF(btrim(p_reference),''),NULLIF(btrim(p_notes),''),current_setting('anna.actor_id',true)::uuid
 FROM business.commercial_orders o JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id
 JOIN core.parties pay ON pay.tenant_id=o.tenant_id AND pay.id=COALESCE(p_payer,p.customer_id) AND pay.status='active'
 JOIN core.parties customer ON customer.tenant_id=o.tenant_id AND customer.id=p.customer_id AND customer.status='active'
 JOIN core.parties seller ON seller.tenant_id=o.tenant_id AND seller.id=p.seller_id AND seller.status='active'
 WHERE o.tenant_id=current_setting('anna.tenant_id',true)::uuid AND o.id=p_order AND o.status='pending_contract' AND p.status='converted' AND pay.id<>p.seller_id
 AND p_kind IN ('sale','service','license','mixed') AND p_from IS NOT NULL AND (p_until IS NULL OR p_until>=p_from)
 AND EXISTS (SELECT 1 FROM business.proposal_lines l WHERE l.tenant_id=o.tenant_id AND l.proposal_id=p.id)
 ON CONFLICT(tenant_id,order_id) DO NOTHING
 RETURNING id,code,tenant_id,created_by,order_id,total
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'contract',id,'create',p_request,jsonb_build_object('order_id',order_id,'total',total,'kind',p_kind) FROM inserted
 ) SELECT id,code FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_contract(uuid,uuid,text,text,date,date,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_contract(uuid,uuid,text,text,date,date,text,text,text,uuid) TO anna_business_runtime;
