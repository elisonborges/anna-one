-- 049: integração do acompanhamento de serviços com a fila interna Connect.
BEGIN;
CREATE FUNCTION business.capture_connect_service_update() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_type text;
BEGIN
 v_type:='service.status.'||NEW.status;
 PERFORM business.enqueue_connect_event('business',v_type,'service-update:'||NEW.id::text,NEW.case_id,'portal_service_case:'||NEW.case_id::text,gen_random_uuid());
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION business.capture_connect_service_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.capture_connect_service_update() TO anna_business_runtime;
CREATE TRIGGER connect_service_update AFTER INSERT ON business.portal_service_updates FOR EACH ROW EXECUTE FUNCTION business.capture_connect_service_update();
COMMIT;
