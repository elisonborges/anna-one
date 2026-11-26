-- 029: obrigação a pagar por recebimento conferido, sem pagamento.
ALTER TABLE business.financial_obligations ADD COLUMN purchase_receipt_id uuid;
ALTER TABLE business.financial_obligations ADD CONSTRAINT financial_purchase_receipt_fk FOREIGN KEY(tenant_id,purchase_receipt_id) REFERENCES business.purchase_receipts(tenant_id,id);
ALTER TABLE business.financial_obligations ADD CONSTRAINT financial_purchase_receipt_direction CHECK(purchase_receipt_id IS NULL OR (direction='payable' AND contract_id IS NULL));
CREATE UNIQUE INDEX financial_purchase_receipt_once ON business.financial_obligations(tenant_id,purchase_receipt_id) WHERE purchase_receipt_id IS NOT NULL;
CREATE FUNCTION business.create_purchase_payable(p_receipt uuid,p_due date,p_count integer,p_operation uuid)
RETURNS TABLE(obligation_id uuid,obligation_code bigint) LANGUAGE sql SECURITY INVOKER AS $$
 WITH header AS (
 INSERT INTO business.financial_obligations(tenant_id,direction,company_id,counterparty_id,company_name,counterparty_name,purchase_receipt_id,title,reference,amount,issued_on,first_due,installment_count,request_id,created_by)
 SELECT r.tenant_id,'payable',o.company_id,o.supplier_id,o.company_name,o.supplier_name,r.id,'Compra PC-'||o.code::text||' / REC-'||r.code::text,r.reference,r.document_total,r.received_on,p_due,p_count,p_operation,current_setting('anna.actor_id',true)::uuid
 FROM business.purchase_receipts r JOIN business.purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
 JOIN business.tenant_memberships m ON m.tenant_id=r.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner'
 WHERE r.tenant_id=current_setting('anna.tenant_id',true)::uuid AND r.id=p_receipt AND r.status='matched' AND o.status='approved'
 AND r.document_total=r.expected_total AND r.document_total BETWEEN 0.01 AND 9999999999999999.99 AND p_count BETWEEN 1 AND 24 AND r.document_total*100>=p_count AND p_due BETWEEN r.received_on AND '9997-12-31'::date
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,code,amount,first_due,installment_count,created_by
 ), installments AS (
 INSERT INTO business.financial_installments(tenant_id,obligation_id,installment_no,due_on,amount,remaining)
 SELECT h.tenant_id,h.id,n,(h.first_due+make_interval(months=>n-1))::date,(floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100,(floor(h.amount*100/h.installment_count)+CASE WHEN n=h.installment_count THEN mod(h.amount*100,h.installment_count) ELSE 0 END)/100 FROM header h CROSS JOIN LATERAL generate_series(1,h.installment_count) n RETURNING obligation_id,amount
 ), logged AS (
 INSERT INTO business.audit_events(tenant_id,actor_id,entity_type,entity_id,action,request_id,details)
 SELECT h.tenant_id,h.created_by,'financial_obligation',h.id,'create',p_operation,jsonb_build_object('direction','payable','purchase_receipt_id',p_receipt,'amount',sum(i.amount),'installments',count(*)) FROM header h JOIN installments i ON i.obligation_id=h.id GROUP BY h.id,h.tenant_id,h.created_by
 ) SELECT id,code FROM header
$$;
REVOKE ALL ON FUNCTION business.create_purchase_payable(uuid,date,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.create_purchase_payable(uuid,date,integer,uuid) TO anna_business_runtime;
