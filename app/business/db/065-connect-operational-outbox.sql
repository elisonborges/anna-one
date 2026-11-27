-- 065: outbox transacional para vínculos operacionais; sem transmissão externa.
BEGIN;
CREATE FUNCTION business.capture_connect_work_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,business AS $fn$
DECLARE v_type text; v_id uuid;
BEGIN
 IF NOT business.hr_admin(NEW.tenant_id) OR NOT business.ops_allowed(NEW.tenant_id,NEW.company_id) THEN
  RAISE EXCEPTION 'Concessão necessária para evento operacional' USING ERRCODE='42501';
 END IF;
 v_type:=CASE TG_TABLE_NAME WHEN 'ops_asset_links' THEN 'operations.asset' WHEN 'project_finance_links' THEN 'project.finance' WHEN 'ops_finance_links' THEN 'operations.finance' WHEN 'rental_billing_links' THEN 'rental.billing' WHEN 'external_work_links' THEN 'operations.external' END;
 IF v_type IS NULL THEN RAISE EXCEPTION 'Origem de evento inválida'; END IF;
 IF TG_OP='INSERT' THEN v_type:=v_type||'.linked';
 ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN v_type:=v_type||'.revoked';
 ELSE RETURN NEW; END IF;
 SELECT event_id INTO v_id FROM business.enqueue_connect_event('business',v_type,v_type||':'||NEW.id::text,NEW.id,TG_TABLE_NAME||':'||NEW.id::text,gen_random_uuid());
 IF v_id IS NULL THEN RAISE EXCEPTION 'Não foi possível registrar evento operacional' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.capture_connect_work_link() FROM PUBLIC;
CREATE TRIGGER connect_asset_link AFTER INSERT OR UPDATE OF revoked_at ON business.ops_asset_links FOR EACH ROW EXECUTE FUNCTION business.capture_connect_work_link();
CREATE TRIGGER connect_project_finance AFTER INSERT OR UPDATE OF revoked_at ON business.project_finance_links FOR EACH ROW EXECUTE FUNCTION business.capture_connect_work_link();
CREATE TRIGGER connect_order_finance AFTER INSERT OR UPDATE OF revoked_at ON business.ops_finance_links FOR EACH ROW EXECUTE FUNCTION business.capture_connect_work_link();
CREATE TRIGGER connect_rental_billing AFTER INSERT OR UPDATE OF revoked_at ON business.rental_billing_links FOR EACH ROW EXECUTE FUNCTION business.capture_connect_work_link();
CREATE TRIGGER connect_external_work AFTER INSERT OR UPDATE OF revoked_at ON business.external_work_links FOR EACH ROW EXECUTE FUNCTION business.capture_connect_work_link();
COMMIT;
