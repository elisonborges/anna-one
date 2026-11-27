-- 069: proteger escritas críticas e serializar diário/fechamento por competência.
BEGIN;
CREATE TABLE business.ledger_period_fences(
 tenant_id uuid NOT NULL,company_id uuid NOT NULL,period_on date NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,company_id,period_on),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 CHECK(extract(day FROM period_on)=1));
ALTER TABLE business.ledger_period_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ledger_period_fences FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_period_fence_scope ON business.ledger_period_fences USING(business.hr_admin(tenant_id)) WITH CHECK(business.hr_admin(tenant_id));
REVOKE ALL ON business.ledger_period_fences FROM PUBLIC,anna_business_runtime;
CREATE FUNCTION business.require_critical_serializable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Operação crítica exige transação serializável' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.require_critical_serializable() FROM PUBLIC;
CREATE TRIGGER financial_installment_serial BEFORE UPDATE ON business.financial_installments FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER financial_settlement_serial BEFORE INSERT ON business.financial_settlements FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER financial_reversal_serial BEFORE INSERT ON business.financial_reversals FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER stock_movement_serial BEFORE INSERT ON business.stock_movements FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER stock_control_serial BEFORE INSERT ON business.stock_controls FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER purchase_request_serial BEFORE UPDATE ON business.purchase_requests FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE TRIGGER purchase_order_serial BEFORE UPDATE ON business.purchase_orders FOR EACH ROW EXECUTE FUNCTION business.require_critical_serializable();
CREATE FUNCTION business.guard_ledger_period_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $fn$
DECLARE v_period date;
BEGIN
 IF NOT COALESCE(business.hr_admin(NEW.tenant_id),false) THEN RAISE EXCEPTION 'Acesso contábil necessário' USING ERRCODE='42501'; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Operação crítica exige transação serializável' USING ERRCODE='40001'; END IF;
 IF TG_TABLE_NAME='ledger_entries' THEN v_period:=date_trunc('month',NEW.posted_on::timestamp)::date; ELSE v_period:=NEW.period_on; END IF;
 INSERT INTO business.ledger_period_fences(tenant_id,company_id,period_on) VALUES(NEW.tenant_id,NEW.company_id,v_period)
 ON CONFLICT(tenant_id,company_id,period_on) DO UPDATE SET revision=business.ledger_period_fences.revision+1;
 IF TG_TABLE_NAME='ledger_entries' AND business.management_period_closed(NEW.tenant_id,NEW.company_id,v_period) THEN RAISE EXCEPTION 'Competência gerencial encerrada' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.guard_ledger_period_write() FROM PUBLIC;
CREATE TRIGGER ledger_period_fence BEFORE INSERT ON business.ledger_entries FOR EACH ROW EXECUTE FUNCTION business.guard_ledger_period_write();
CREATE TRIGGER management_period_fence BEFORE INSERT ON business.management_period_events FOR EACH ROW EXECUTE FUNCTION business.guard_ledger_period_write();
CREATE OR REPLACE FUNCTION business.guard_resource_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'business'
AS $fn$
DECLARE res uuid; conflict_found boolean;
BEGIN
 IF TG_TABLE_NAME='rental_events' THEN
  SELECT resource_id INTO res FROM business.rentals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.rental_id;
 ELSIF TG_TABLE_NAME='field_job_events' THEN
  SELECT resource_id INTO res FROM business.field_jobs WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.job_id;
 ELSE res:=NEW.resource_id; END IF;
 IF res IS NULL THEN RETURN NEW; END IF;
 IF NOT COALESCE(business.ops_allowed(NEW.tenant_id,NEW.company_id),false) THEN RAISE EXCEPTION 'Concessão operacional necessária' USING ERRCODE='42501'; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Operação de recurso exige transação serializável' USING ERRCODE='40001'; END IF;
 INSERT INTO business.resource_write_fences(tenant_id,company_id,resource_id) VALUES(NEW.tenant_id,NEW.company_id,res)
 ON CONFLICT(tenant_id,company_id,resource_id) DO UPDATE SET revision=business.resource_write_fences.revision+1;
 IF TG_TABLE_NAME IN ('ops_allocations','project_allocations','rentals','field_jobs') AND TG_OP='INSERT' THEN
  IF NOT COALESCE(business.resource_available(NEW.tenant_id,NEW.company_id,res,NEW.start_on,NEW.end_on),false) THEN RAISE EXCEPTION 'Recurso indisponível no período' USING ERRCODE='23P01'; END IF;
 ELSIF TG_TABLE_NAME='rental_events' THEN
  IF NEW.status='delivered' THEN
  SELECT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=NEW.tenant_id AND r.company_id=NEW.company_id AND r.resource_id=res AND r.id<>NEW.rental_id AND business.rental_status(r.id)='delivered') OR EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.resource_id=res AND business.field_job_status(j.id)='in_progress') INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'Recurso em utilização' USING ERRCODE='23P01'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='field_job_events' THEN
  IF NEW.status='in_progress' THEN
  SELECT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=NEW.tenant_id AND r.company_id=NEW.company_id AND r.resource_id=res AND business.rental_status(r.id)='delivered') OR EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.resource_id=res AND j.id<>NEW.job_id AND business.field_job_status(j.id)='in_progress') INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'Recurso em utilização' USING ERRCODE='23P01'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $fn$;
COMMIT;
