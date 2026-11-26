-- 047: AnnA Connect. Registro interno/outbox, sem transmissão externa automática.
BEGIN;
CREATE TABLE business.connect_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES business.tenants(id),
 source text NOT NULL CHECK(source IN ('business','master','service_desk','teamhub','accounting','payments','mail','other')),
 event_type text NOT NULL CHECK(event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
 event_key text NOT NULL CHECK(length(btrim(event_key)) BETWEEN 1 AND 180),
 entity_id uuid, reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','failed','reconciled')),
 attempt integer NOT NULL DEFAULT 1 CHECK(attempt BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES public.app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), result_reference text,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,source,event_key),
 CHECK((status='queued' AND result_reference IS NULL) OR (status IN ('failed','reconciled') AND result_reference IS NOT NULL AND length(btrim(result_reference)) BETWEEN 1 AND 300))
);
CREATE TABLE business.connect_event_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,event_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('enqueue','fail','retry','reconcile')),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 100),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 300),
 operation_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,event_id) REFERENCES business.connect_events(tenant_id,id),
 UNIQUE(tenant_id,operation_id)
);
CREATE INDEX connect_events_status ON business.connect_events(tenant_id,status,created_at DESC);
CREATE INDEX connect_actions_event ON business.connect_event_actions(tenant_id,event_id,created_at,id);
ALTER TABLE business.connect_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.connect_events FORCE ROW LEVEL SECURITY;
ALTER TABLE business.connect_event_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.connect_event_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY connect_events_owner ON business.connect_events FOR SELECT USING(
 tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY connect_events_create ON business.connect_events FOR INSERT WITH CHECK(
 tenant_id::text=current_setting('anna.tenant_id',true) AND created_by::text=current_setting('anna.actor_id',true) AND status='queued' AND attempt=1 AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY connect_events_change ON business.connect_events FOR UPDATE USING(
 tenant_id::text=current_setting('anna.tenant_id',true) AND status<>'reconciled' AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active')) WITH CHECK(
 tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_events.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY connect_actions_owner ON business.connect_event_actions FOR SELECT USING(
 tenant_id::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_event_actions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
CREATE POLICY connect_actions_insert ON business.connect_event_actions FOR INSERT WITH CHECK(
 tenant_id::text=current_setting('anna.tenant_id',true) AND actor_id::text=current_setting('anna.actor_id',true) AND EXISTS(SELECT 1 FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=connect_event_actions.tenant_id AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner' AND t.kind='internal' AND t.status='active'));
REVOKE ALL ON business.connect_events,business.connect_event_actions FROM PUBLIC;
GRANT SELECT,INSERT ON business.connect_events,business.connect_event_actions TO anna_business_runtime;
GRANT UPDATE(status,attempt,updated_at,result_reference) ON business.connect_events TO anna_business_runtime;
CREATE FUNCTION business.enqueue_connect_event(p_source text,p_type text,p_key text,p_entity uuid,p_reference text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH inserted AS (INSERT INTO business.connect_events(tenant_id,source,event_type,event_key,entity_id,reference,created_by)
 SELECT current_setting('anna.tenant_id',true)::uuid,p_source,p_type,btrim(p_key),p_entity,btrim(p_reference),current_setting('anna.actor_id',true)::uuid
 WHERE NOT EXISTS(SELECT 1 FROM business.connect_event_actions a WHERE a.tenant_id=current_setting('anna.tenant_id',true)::uuid AND a.operation_id=p_op)
 ON CONFLICT DO NOTHING RETURNING id,tenant_id,created_by),
 logged AS (INSERT INTO business.connect_event_actions(tenant_id,event_id,action,attempt,note,operation_id,actor_id) SELECT tenant_id,id,'enqueue',1,'Evento registrado; nenhuma transmissão automática',p_op,created_by FROM inserted)
 SELECT id FROM inserted
$$;
CREATE FUNCTION business.transition_connect_event(p_id uuid,p_action text,p_note text,p_op uuid) RETURNS TABLE(event_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
 WITH changed AS (UPDATE business.connect_events e SET status=CASE p_action WHEN 'fail' THEN 'failed' WHEN 'retry' THEN 'queued' WHEN 'reconcile' THEN 'reconciled' END,
 attempt=e.attempt+CASE WHEN p_action='retry' THEN 1 ELSE 0 END,updated_at=now(),result_reference=CASE WHEN p_action='retry' THEN NULL ELSE btrim(p_note) END
 WHERE e.tenant_id=current_setting('anna.tenant_id',true)::uuid AND e.id=p_id
 AND ((e.status='queued' AND p_action IN ('fail','reconcile')) OR (e.status='failed' AND p_action='retry' AND e.attempt<100))
 AND length(btrim(p_note)) BETWEEN 1 AND 300
 AND NOT EXISTS(SELECT 1 FROM business.connect_event_actions a WHERE a.tenant_id=e.tenant_id AND a.operation_id=p_op)
 RETURNING e.id,e.tenant_id,e.attempt),
 logged AS (INSERT INTO business.connect_event_actions(tenant_id,event_id,action,attempt,note,operation_id,actor_id) SELECT tenant_id,id,p_action,attempt,btrim(p_note),p_op,current_setting('anna.actor_id',true)::uuid FROM changed)
 SELECT id FROM changed
$$;
REVOKE ALL ON FUNCTION business.enqueue_connect_event(text,text,text,uuid,text,uuid),business.transition_connect_event(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.enqueue_connect_event(text,text,text,uuid,text,uuid),business.transition_connect_event(uuid,text,text,uuid) TO anna_business_runtime;

-- Outbox de eventos de documentos e pendências: somente identificadores opacos.
CREATE FUNCTION business.capture_connect_portal_event() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_type text;
BEGIN
 IF TG_TABLE_NAME='portal_publications' THEN
  IF TG_OP='INSERT' THEN v_type:='portal.document.published';
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN v_type:='portal.document.revoked';
  ELSE RETURN NEW;
  END IF;
 ELSIF TG_TABLE_NAME='accounting_pendencies' THEN
  IF TG_OP='INSERT' THEN v_type:='accounting.pendency.created';
  ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN v_type:='accounting.pendency.closed';
  ELSE RETURN NEW;
  END IF;
 ELSE RETURN NEW;
 END IF;
 PERFORM business.enqueue_connect_event('business',v_type,v_type||':'||NEW.id::text,NEW.id,TG_TABLE_NAME||':'||NEW.id::text,gen_random_uuid());
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION business.capture_connect_portal_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.capture_connect_portal_event() TO anna_business_runtime;
CREATE TRIGGER connect_portal_publication AFTER INSERT OR UPDATE OF revoked_at ON business.portal_publications FOR EACH ROW EXECUTE FUNCTION business.capture_connect_portal_event();
CREATE TRIGGER connect_accounting_pendency AFTER INSERT OR UPDATE OF closed_at ON business.accounting_pendencies FOR EACH ROW EXECUTE FUNCTION business.capture_connect_portal_event();

COMMIT;
