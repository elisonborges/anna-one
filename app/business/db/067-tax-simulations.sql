-- 067: simulação percentual explícita, sem apuração oficial.
BEGIN;
CREATE TABLE business.tax_simulations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 rule_id uuid NOT NULL,reference_on date NOT NULL,
 base_amount numeric(18,2) NOT NULL CHECK(base_amount>=0),
 rate_percent numeric(9,6) NOT NULL CHECK(rate_percent BETWEEN 0 AND 100),
 result_amount numeric(18,2) GENERATED ALWAYS AS (round(base_amount*rate_percent/100,2)) STORED,
 formula_version text NOT NULL DEFAULT 'percentage-v1' CHECK(formula_version='percentage-v1'),
 assumptions text NOT NULL CHECK(length(btrim(assumptions)) BETWEEN 1 AND 1000),
 rule_code text NOT NULL,rule_effective_on date NOT NULL,rule_source text NOT NULL,
 review_evidence text NOT NULL,operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES business.tax_rule_versions(tenant_id,id),
 UNIQUE(tenant_id,operation_id));
ALTER TABLE business.tax_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.tax_simulations FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_sim_read ON business.tax_simulations FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY tax_sim_insert ON business.tax_simulations FOR INSERT WITH CHECK(
 business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true)
 AND EXISTS(SELECT 1 FROM business.tax_rule_versions v JOIN business.tax_rule_reviews a ON a.tenant_id=v.tenant_id AND a.rule_id=v.id AND a.decision='reviewed'
 WHERE v.tenant_id=tax_simulations.tenant_id AND v.id=tax_simulations.rule_id
 AND v.effective_on<=tax_simulations.reference_on AND (v.valid_until IS NULL OR v.valid_until>=tax_simulations.reference_on)
 AND v.rule_code=tax_simulations.rule_code AND v.effective_on=tax_simulations.rule_effective_on AND v.source_reference=tax_simulations.rule_source AND a.evidence=tax_simulations.review_evidence
 AND NOT EXISTS(SELECT 1 FROM business.tax_rule_versions x WHERE x.tenant_id=v.tenant_id AND x.rule_code=v.rule_code AND x.id<>v.id AND x.effective_on<=tax_simulations.reference_on AND (x.valid_until IS NULL OR x.valid_until>=tax_simulations.reference_on))));
REVOKE ALL ON business.tax_simulations FROM PUBLIC;
GRANT SELECT,INSERT ON business.tax_simulations TO anna_business_runtime;
COMMIT;
