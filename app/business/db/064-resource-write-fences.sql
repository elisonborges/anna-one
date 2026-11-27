-- 064: serialização obrigatória de reservas e eventos de utilização.
BEGIN;
CREATE TABLE business.resource_write_fences(
 tenant_id uuid NOT NULL,company_id uuid NOT NULL,resource_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,company_id,resource_id),
 FOREIGN KEY(tenant_id,company_id,resource_id) REFERENCES business.ops_resources(tenant_id,company_id,id));
ALTER TABLE business.resource_write_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.resource_write_fences FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_fence_scope ON business.resource_write_fences USING(business.ops_allowed(tenant_id,company_id)) WITH CHECK(business.ops_allowed(tenant_id,company_id));
REVOKE ALL ON business.resource_write_fences FROM PUBLIC;
CREATE FUNCTION business.guard_resource_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $fn$
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
 ELSIF TG_TABLE_NAME='rental_events' AND NEW.status='delivered' THEN
  SELECT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=NEW.tenant_id AND r.company_id=NEW.company_id AND r.resource_id=res AND r.id<>NEW.rental_id AND business.rental_status(r.id)='delivered') OR EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.resource_id=res AND business.field_job_status(j.id)='in_progress') INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'Recurso em utilização' USING ERRCODE='23P01'; END IF;
 ELSIF TG_TABLE_NAME='field_job_events' AND NEW.status='in_progress' THEN
  SELECT EXISTS(SELECT 1 FROM business.rentals r WHERE r.tenant_id=NEW.tenant_id AND r.company_id=NEW.company_id AND r.resource_id=res AND business.rental_status(r.id)='delivered') OR EXISTS(SELECT 1 FROM business.field_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.resource_id=res AND j.id<>NEW.job_id AND business.field_job_status(j.id)='in_progress') INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'Recurso em utilização' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.guard_resource_write() FROM PUBLIC;
CREATE TRIGGER ops_allocation_fence BEFORE INSERT OR UPDATE OF voided_at ON business.ops_allocations FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
CREATE TRIGGER project_allocation_fence BEFORE INSERT OR UPDATE OF voided_at ON business.project_allocations FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
CREATE TRIGGER rental_fence BEFORE INSERT ON business.rentals FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
CREATE TRIGGER field_job_fence BEFORE INSERT ON business.field_jobs FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
CREATE TRIGGER rental_event_fence BEFORE INSERT ON business.rental_events FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
CREATE TRIGGER field_event_fence BEFORE INSERT ON business.field_job_events FOR EACH ROW EXECUTE FUNCTION business.guard_resource_write();
COMMIT;
