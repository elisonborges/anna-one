-- 070: processamento automático local, sem transmitir dados a terceiros.
BEGIN;
CREATE TABLE business.connect_local_receipts(
 tenant_id uuid NOT NULL,event_id uuid NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 100),
 processed_by uuid NOT NULL REFERENCES public.app_users(id),processed_at timestamptz NOT NULL DEFAULT now(),
 mode text NOT NULL CHECK(mode IN ('automatic','batch')),
 PRIMARY KEY(tenant_id,event_id,attempt),
 FOREIGN KEY(tenant_id,event_id) REFERENCES business.connect_events(tenant_id,id));
ALTER TABLE business.connect_local_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.connect_local_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY connect_receipt_read ON business.connect_local_receipts FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY connect_receipt_write ON business.connect_local_receipts FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND processed_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.connect_local_receipts FROM PUBLIC,anna_business_runtime;
GRANT SELECT ON business.connect_local_receipts TO anna_business_runtime;
CREATE FUNCTION business.capture_connect_local_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $fn$
BEGIN
 IF NEW.status<>'queued' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN IF OLD.status='queued' AND OLD.attempt=NEW.attempt THEN RETURN NEW; END IF; END IF;
 IF NOT COALESCE(business.hr_admin(NEW.tenant_id),false) THEN RAISE EXCEPTION 'Acesso Connect necessário' USING ERRCODE='42501'; END IF;
 INSERT INTO business.connect_local_receipts(tenant_id,event_id,attempt,processed_by,mode)
 VALUES(NEW.tenant_id,NEW.id,NEW.attempt,current_setting('anna.actor_id',true)::uuid,'automatic')
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION business.capture_connect_local_receipt() FROM PUBLIC;
CREATE TRIGGER connect_local_receipt AFTER INSERT OR UPDATE OF status,attempt ON business.connect_events FOR EACH ROW EXECUTE FUNCTION business.capture_connect_local_receipt();
CREATE FUNCTION business.process_connect_local_batch(p_limit integer) RETURNS TABLE(event_id uuid,attempt integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $fn$
DECLARE v_tenant uuid:=current_setting('anna.tenant_id',true)::uuid;v_actor uuid:=current_setting('anna.actor_id',true)::uuid;
BEGIN
 IF NOT COALESCE(business.hr_admin(v_tenant),false) THEN RAISE EXCEPTION 'Acesso Connect necessário' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limite inválido' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH pending AS (
 SELECT e.id,e.attempt FROM business.connect_events e WHERE e.tenant_id=v_tenant AND e.status='queued'
 AND NOT EXISTS(SELECT 1 FROM business.connect_local_receipts r WHERE r.tenant_id=e.tenant_id AND r.event_id=e.id AND r.attempt=e.attempt)
 ORDER BY e.created_at,e.id LIMIT p_limit FOR UPDATE OF e SKIP LOCKED
 ), inserted AS (
 INSERT INTO business.connect_local_receipts AS r(tenant_id,event_id,attempt,processed_by,mode)
 SELECT v_tenant,p.id,p.attempt,v_actor,'batch' FROM pending p ON CONFLICT ON CONSTRAINT connect_local_receipts_pkey DO NOTHING
 RETURNING r.event_id,r.attempt)
 SELECT i.event_id,i.attempt FROM inserted i;
END $fn$;
REVOKE ALL ON FUNCTION business.process_connect_local_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.process_connect_local_batch(integer) TO anna_business_runtime;
COMMIT;
