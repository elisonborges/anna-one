-- 026: cotações integrais por requisição aprovada, sem adjudicação ou compromisso.
CREATE TABLE business.purchase_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, request_id uuid NOT NULL, supplier_id uuid NOT NULL,
 supplier_name text NOT NULL, reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 valid_until date NOT NULL, delivery_days integer NOT NULL CHECK(delivery_days BETWEEN 0 AND 3650),
 payment_terms text NOT NULL CHECK(length(btrim(payment_terms)) BETWEEN 1 AND 300),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), total numeric(24,2) NOT NULL CHECK(total>=0),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,request_id) REFERENCES business.purchase_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,operation_id), UNIQUE(tenant_id,request_id,supplier_id,reference)
);
ALTER TABLE business.purchase_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.purchase_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_quotes_read ON business.purchase_quotes FOR SELECT USING (tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_quotes.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
CREATE POLICY purchase_quotes_insert ON business.purchase_quotes FOR INSERT WITH CHECK (tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND EXISTS (SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=purchase_quotes.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.purchase_quotes FROM PUBLIC;
GRANT SELECT,INSERT ON business.purchase_quotes TO anna_business_runtime;
CREATE FUNCTION business.create_purchase_quote(p_request uuid,p_supplier uuid,p_reference text,p_valid date,p_days integer,p_terms text,p_lines jsonb,p_operation uuid)
RETURNS TABLE(quote_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH input AS MATERIALIZED (SELECT line_id,unit_price FROM jsonb_to_recordset(p_lines) AS x(line_id uuid,unit_price numeric)),
 eligible AS MATERIALIZED (SELECT l.id,l.item_name,l.quantity,l.unit,x.unit_price,round(l.quantity*x.unit_price,2) AS subtotal FROM business.purchase_request_lines l JOIN input x ON x.line_id=l.id WHERE l.tenant_id=current_setting('anna.tenant_id',true)::uuid AND l.request_id=p_request AND x.unit_price BETWEEN 0 AND 999999999999.99 AND x.unit_price=round(x.unit_price,2)),
 inserted AS (
 INSERT INTO business.purchase_quotes(tenant_id,request_id,supplier_id,supplier_name,reference,valid_until,delivery_days,payment_terms,lines,total,operation_id,created_by)
 SELECT r.tenant_id,r.id,s.id,s.legal_name,btrim(p_reference),p_valid,p_days,btrim(p_terms),
 (SELECT jsonb_agg(jsonb_build_object('line_id',e.id,'item_name',e.item_name,'quantity',e.quantity::text,'unit',e.unit,'unit_price',e.unit_price::text,'subtotal',e.subtotal::text) ORDER BY e.id) FROM eligible e),
 (SELECT sum(subtotal) FROM eligible),p_operation,current_setting('anna.actor_id',true)::uuid
 FROM business.purchase_requests r JOIN core.parties s ON s.tenant_id=r.tenant_id AND s.id=p_supplier AND s.status='active'
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_request AND r.status='approved' AND s.id<>r.company_id
 AND EXISTS(SELECT 1 FROM business.party_roles pr WHERE pr.tenant_id=r.tenant_id AND pr.party_id=s.id AND pr.role='supplier' AND pr.active)
 AND p_valid >= (now() AT TIME ZONE 'America/Fortaleza')::date
 AND (SELECT count(*) FROM input) BETWEEN 1 AND 20 AND (SELECT count(*) FROM eligible)=(SELECT count(*) FROM input)
 AND (SELECT count(DISTINCT id) FROM eligible)=(SELECT count(*) FROM input)
 AND (SELECT count(*) FROM business.purchase_request_lines l WHERE l.tenant_id=r.tenant_id AND l.request_id=r.id)=(SELECT count(*) FROM input)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by,total
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT tenant_id,created_by,'purchase_quote',id,'create',p_operation,jsonb_build_object('purchase_request',p_request,'total',total) FROM inserted
 ) SELECT id FROM inserted
$$;
REVOKE ALL ON FUNCTION business.create_purchase_quote(uuid,uuid,text,date,integer,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_purchase_quote(uuid,uuid,text,date,integer,text,jsonb,uuid) TO anna_business_runtime;
