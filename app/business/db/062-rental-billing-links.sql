-- 062: vínculo contratual e financeiro administrativo de locações.
BEGIN;
CREATE TABLE business.rental_billing_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,rental_id uuid NOT NULL,contract_id uuid NOT NULL,contract_revision integer NOT NULL CHECK(contract_revision>=1),obligation_id uuid,
 amount numeric(18,2) NOT NULL CHECK(amount>=0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id,rental_id) REFERENCES business.rentals(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES business.contracts(tenant_id,id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK(obligation_id IS NULL OR amount>0),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL)));
CREATE UNIQUE INDEX rental_billing_rental_active ON business.rental_billing_links(tenant_id,rental_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX rental_billing_contract_active ON business.rental_billing_links(tenant_id,contract_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX rental_billing_obligation_active ON business.rental_billing_links(tenant_id,obligation_id) WHERE revoked_at IS NULL AND obligation_id IS NOT NULL;
ALTER TABLE business.rental_billing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.rental_billing_links FORCE ROW LEVEL SECURITY;
CREATE POLICY rental_billing_read ON business.rental_billing_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY rental_billing_insert ON business.rental_billing_links FOR INSERT WITH CHECK(
 business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM business.rentals r JOIN business.contracts c ON c.tenant_id=r.tenant_id AND c.seller_id=r.company_id AND c.customer_id=r.customer_id
 WHERE r.tenant_id=rental_billing_links.tenant_id AND r.company_id=rental_billing_links.company_id AND r.id=rental_billing_links.rental_id
 AND c.id=rental_billing_links.contract_id AND c.revision=rental_billing_links.contract_revision AND c.status='active' AND c.signed_on IS NOT NULL AND c.contract_kind IN ('service','mixed') AND c.currency='BRL'
 AND c.valid_from<=r.start_on AND (c.valid_until IS NULL OR c.valid_until>=r.end_on) AND c.total=r.agreed_amount AND r.agreed_amount=rental_billing_links.amount AND business.rental_status(r.id)<>'cancelled'
 AND (rental_billing_links.obligation_id IS NULL OR EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=r.tenant_id AND f.company_id=r.company_id AND f.id=rental_billing_links.obligation_id AND f.direction='receivable' AND f.currency='BRL' AND f.contract_id=c.id AND f.contract_revision=c.revision AND f.counterparty_id=c.payer_id AND f.amount=r.agreed_amount))));
CREATE POLICY rental_billing_revoke ON business.rental_billing_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL)
 WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.rental_billing_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.rental_billing_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.rental_billing_links TO anna_business_runtime;
COMMIT;
