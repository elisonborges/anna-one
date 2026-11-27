-- 061: conciliação administrativa de custos realizados de projetos com contas a pagar.
BEGIN;
CREATE TABLE business.project_finance_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,project_id uuid NOT NULL,cost_id uuid NOT NULL REFERENCES business.project_costs(id),obligation_id uuid NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id,project_id) REFERENCES business.projects(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL)));
CREATE UNIQUE INDEX project_finance_cost_active ON business.project_finance_links(tenant_id,cost_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX project_finance_obligation_active ON business.project_finance_links(tenant_id,obligation_id) WHERE revoked_at IS NULL;
ALTER TABLE business.project_finance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.project_finance_links FORCE ROW LEVEL SECURITY;
CREATE POLICY project_finance_read ON business.project_finance_links FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY project_finance_insert ON business.project_finance_links FOR INSERT WITH CHECK(
 business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM business.project_costs c WHERE c.tenant_id=project_finance_links.tenant_id AND c.company_id=project_finance_links.company_id AND c.project_id=project_finance_links.project_id AND c.id=project_finance_links.cost_id AND c.kind='actual' AND c.voided_at IS NULL AND c.amount=project_finance_links.amount)
 AND EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=project_finance_links.tenant_id AND f.company_id=project_finance_links.company_id AND f.id=project_finance_links.obligation_id AND f.direction='payable' AND f.currency='BRL' AND f.amount=project_finance_links.amount));
CREATE POLICY project_finance_revoke ON business.project_finance_links FOR UPDATE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NULL)
 WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) AND revoked_at IS NOT NULL AND revoked_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.project_finance_links FROM PUBLIC;
GRANT SELECT,INSERT ON business.project_finance_links TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.project_finance_links TO anna_business_runtime;

-- Registro compartilhado: a mesma obrigação não pode ser conciliada simultaneamente a ordem e projeto.
-- Chave única independente de snapshots; trava concorrente via índice único.
CREATE TABLE business.cost_obligation_claims(
 tenant_id uuid NOT NULL,obligation_id uuid NOT NULL,company_id uuid NOT NULL,source text NOT NULL CHECK(source IN ('order','project')),link_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,obligation_id),UNIQUE(source,link_id),
 FOREIGN KEY(tenant_id,obligation_id) REFERENCES business.financial_obligations(tenant_id,id));
INSERT INTO business.cost_obligation_claims(tenant_id,obligation_id,company_id,source,link_id)
 SELECT tenant_id,obligation_id,company_id,'order',id FROM business.ops_finance_links WHERE revoked_at IS NULL;
ALTER TABLE business.cost_obligation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.cost_obligation_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY cost_claim_read ON business.cost_obligation_claims FOR SELECT USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY cost_claim_insert ON business.cost_obligation_claims FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
CREATE POLICY cost_claim_delete ON business.cost_obligation_claims FOR DELETE USING(business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id));
REVOKE ALL ON business.cost_obligation_claims FROM PUBLIC;
-- Registry is only changed by restricted trigger function, not by the runtime.
CREATE FUNCTION business.sync_cost_obligation_claim() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $fn$
DECLARE src text;
BEGIN
 src:=CASE WHEN TG_TABLE_NAME='ops_finance_links' THEN 'order' ELSE 'project' END;
 IF NOT business.hr_admin(NEW.tenant_id) OR NOT business.ops_allowed(NEW.tenant_id,NEW.company_id) THEN RAISE EXCEPTION 'Acesso financeiro operacional necessário' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND NEW.revoked_at IS NULL THEN
  INSERT INTO business.cost_obligation_claims(tenant_id,obligation_id,company_id,source,link_id) VALUES(NEW.tenant_id,NEW.obligation_id,NEW.company_id,src,NEW.id);
 ELSIF TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
  DELETE FROM business.cost_obligation_claims WHERE tenant_id=NEW.tenant_id AND obligation_id=NEW.obligation_id AND source=src AND link_id=NEW.id;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.sync_cost_obligation_claim() FROM PUBLIC;
CREATE TRIGGER ops_finance_claim AFTER INSERT OR UPDATE OF revoked_at ON business.ops_finance_links FOR EACH ROW EXECUTE FUNCTION business.sync_cost_obligation_claim();
CREATE TRIGGER project_finance_claim AFTER INSERT OR UPDATE OF revoked_at ON business.project_finance_links FOR EACH ROW EXECUTE FUNCTION business.sync_cost_obligation_claim();
GRANT SELECT ON business.cost_obligation_claims TO anna_business_runtime;
COMMIT;
