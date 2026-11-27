-- 066: catálogo declarativo de regras tributárias, sem cálculo oficial.
BEGIN;
CREATE TABLE business.tax_rule_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES business.tenants(id),
 rule_code text NOT NULL CHECK(rule_code ~ '^[A-Z0-9_-]{2,40}$'),
 effective_on date NOT NULL,valid_until date CHECK(valid_until IS NULL OR valid_until>=effective_on),
 tax_name text NOT NULL CHECK(length(btrim(tax_name)) BETWEEN 1 AND 100),
 jurisdiction text NOT NULL CHECK(jurisdiction IN ('federal','state','municipal')),
 locality text NOT NULL CHECK(length(btrim(locality)) BETWEEN 1 AND 100),
 applicability text NOT NULL CHECK(length(btrim(applicability)) BETWEEN 1 AND 500),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 500),
 notes text NOT NULL CHECK(length(btrim(notes)) BETWEEN 1 AND 1000),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,rule_code,effective_on),UNIQUE(tenant_id,operation_id));
CREATE TABLE business.tax_rule_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,rule_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('reviewed','rejected')),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 500),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES business.tax_rule_versions(tenant_id,id),
 UNIQUE(tenant_id,rule_id),UNIQUE(tenant_id,operation_id));
ALTER TABLE business.tax_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.tax_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE business.tax_rule_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.tax_rule_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_rule_read ON business.tax_rule_versions FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY tax_rule_create ON business.tax_rule_versions FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY tax_review_read ON business.tax_rule_reviews FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY tax_review_create ON business.tax_rule_reviews FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.tax_rule_versions,business.tax_rule_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON business.tax_rule_versions,business.tax_rule_reviews TO anna_business_runtime;
COMMIT;
