-- 013: propostas comerciais em BRL com snapshots e totais calculados no banco.
CREATE TABLE business.proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES business.tenants(id) ON DELETE RESTRICT,
 code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 customer_id uuid NOT NULL,
 seller_id uuid NOT NULL,
 list_id uuid NOT NULL,
 opportunity_id uuid,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 customer_name text NOT NULL,
 seller_name text NOT NULL,
 list_name text NOT NULL,
 payment_terms text CHECK(payment_terms IS NULL OR length(btrim(payment_terms)) BETWEEN 1 AND 300),
 notes text CHECK(notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
 issued_on date NOT NULL DEFAULT CURRENT_DATE,
 valid_until date NOT NULL CHECK(valid_until>=issued_on),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft')),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES core.parties(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,seller_id) REFERENCES business.companies(tenant_id,party_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,list_id) REFERENCES business.price_lists(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES business.opportunities(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id)
);
CREATE TABLE business.proposal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 proposal_id uuid NOT NULL,
 price_entry_id uuid NOT NULL REFERENCES business.price_entries(id) ON DELETE RESTRICT,
 item_id uuid NOT NULL,
 item_code bigint NOT NULL,
 item_name text NOT NULL,
 unit text NOT NULL,
 quantity numeric(9,3) NOT NULL CHECK(quantity>0),
 unit_price numeric(14,2) NOT NULL CHECK(unit_price>=0),
 discount_pct numeric(5,2) NOT NULL CHECK(discount_pct BETWEEN 0 AND 100),
 gross numeric(24,2) GENERATED ALWAYS AS (round(quantity*unit_price,2)) STORED,
 discount numeric(24,2) GENERATED ALWAYS AS (round(round(quantity*unit_price,2)*discount_pct/100,2)) STORED,
 net numeric(24,2) GENERATED ALWAYS AS (round(quantity*unit_price,2)-round(round(quantity*unit_price,2)*discount_pct/100,2)) STORED,
 FOREIGN KEY(tenant_id,proposal_id) REFERENCES business.proposals(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,item_id) REFERENCES business.catalog_items(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,proposal_id,item_id)
);
ALTER TABLE business.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY proposals_read ON business.proposals FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposals.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY proposals_insert ON business.proposals FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposals.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.proposals FROM PUBLIC;
GRANT SELECT,INSERT ON business.proposals TO anna_business_runtime;
ALTER TABLE business.proposal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.proposal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_lines_read ON business.proposal_lines FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposal_lines.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY proposal_lines_insert ON business.proposal_lines FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=proposal_lines.tenant_id AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active') AND EXISTS (SELECT 1 FROM business.proposals p WHERE p.tenant_id=proposal_lines.tenant_id AND p.id=proposal_lines.proposal_id AND p.created_by::text=current_setting('anna.actor_id',true) AND p.status='draft'));
REVOKE ALL ON business.proposal_lines FROM PUBLIC;
GRANT SELECT,INSERT ON business.proposal_lines TO anna_business_runtime;
GRANT USAGE,SELECT ON SEQUENCE business.proposals_code_seq TO anna_business_runtime;
CREATE FUNCTION business.create_proposal(p_customer uuid,p_list uuid,p_opportunity uuid,p_title text,p_until date,p_terms text,p_notes text,p_lines jsonb,p_request uuid)
RETURNS TABLE(proposal_id uuid,proposal_code bigint) LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_tenant uuid := current_setting('anna.tenant_id',true)::uuid;
 v_actor uuid := current_setting('anna.actor_id',true)::uuid;
 v_id uuid;
 v_code bigint;
 v_count integer;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Quantidade de itens inválida' USING ERRCODE='22023'; END IF;
 IF p_until IS NULL OR p_until<CURRENT_DATE THEN RAISE EXCEPTION 'Validade inválida' USING ERRCODE='22023'; END IF;
 INSERT INTO business.proposals(tenant_id,customer_id,seller_id,list_id,opportunity_id,title,customer_name,seller_name,list_name,payment_terms,notes,valid_until,created_by)
 SELECT v_tenant,c.id,l.seller_id,l.id,p_opportunity,btrim(p_title),c.legal_name,s.legal_name,l.name,NULLIF(btrim(p_terms),''),NULLIF(btrim(p_notes),''),p_until,v_actor
 FROM business.price_lists l JOIN core.parties s ON s.tenant_id=l.tenant_id AND s.id=l.seller_id JOIN core.parties c ON c.tenant_id=l.tenant_id AND c.id=p_customer
 WHERE l.tenant_id=v_tenant AND l.id=p_list AND s.status='active' AND c.status='active' AND s.id<>c.id
 AND (p_opportunity IS NULL OR EXISTS (SELECT 1 FROM business.opportunities o WHERE o.tenant_id=v_tenant AND o.id=p_opportunity AND o.party_id=c.id AND o.stage NOT IN ('won','lost')))
 RETURNING id,code INTO v_id,v_code;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Cliente, empresa, tabela ou oportunidade incompatível' USING ERRCODE='22023'; END IF;
 INSERT INTO business.proposal_lines(tenant_id,proposal_id,price_entry_id,item_id,item_code,item_name,unit,quantity,unit_price,discount_pct)
 SELECT v_tenant,v_id,e.id,i.id,i.code,i.name,e.unit,x.quantity,e.unit_price,x.discount_pct
 FROM jsonb_to_recordset(p_lines) AS x(price_entry_id uuid,quantity numeric,discount_pct numeric)
 JOIN business.price_entries e ON e.tenant_id=v_tenant AND e.id=x.price_entry_id AND e.list_id=p_list
 JOIN business.catalog_items i ON i.tenant_id=e.tenant_id AND i.id=e.item_id AND i.status='active' AND i.unit=e.unit
 WHERE e.valid_from<=CURRENT_DATE AND (e.valid_until IS NULL OR e.valid_until>=CURRENT_DATE)
 AND x.quantity>0 AND x.quantity<=999999.999 AND x.quantity=round(x.quantity,3)
 AND x.discount_pct BETWEEN 0 AND 100 AND x.discount_pct=round(x.discount_pct,2);
 GET DIAGNOSTICS v_count = ROW_COUNT;
 IF v_count<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'Item, preço ou quantidade inválida ou fora da vigência' USING ERRCODE='22023'; END IF;
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT v_tenant,v_actor,'proposal',v_id,'create',p_request,jsonb_build_object('lines',v_count,'total',sum(net)) FROM business.proposal_lines WHERE tenant_id=v_tenant AND proposal_id=v_id;
 RETURN QUERY SELECT v_id,v_code;
END
$$;
REVOKE ALL ON FUNCTION business.create_proposal(uuid,uuid,uuid,text,date,text,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_proposal(uuid,uuid,uuid,text,date,text,text,jsonb,uuid) TO anna_business_runtime;
