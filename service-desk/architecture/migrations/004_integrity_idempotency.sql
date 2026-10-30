-- AnnA Service Desk — integridade e idempotência (PROPOSTA, NÃO APLICADA)
-- Aplicar somente em banco de teste depois de 001, 002 e 003.
BEGIN;
CREATE TABLE anna_sd.ticket_creation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES anna_sd.tenants(id),
 requester_id uuid NOT NULL REFERENCES anna_sd.platform_users(id),
 request_key uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 ticket_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES anna_sd.tickets(tenant_id,id),
 UNIQUE(tenant_id,requester_id,request_key)
);
CREATE INDEX ticket_creation_requests_age ON anna_sd.ticket_creation_requests(created_at);
ALTER TABLE anna_sd.ticket_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE anna_sd.ticket_creation_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON anna_sd.ticket_creation_requests FROM PUBLIC;
-- Imutabilidade do protocolo e de suas coordenadas. Qualquer reclassificação
-- deve alterar a classificação técnica, nunca o protocolo.
CREATE FUNCTION anna_sd.prevent_protocol_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,anna_sd AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.public_protocol IS DISTINCT FROM OLD.public_protocol
    OR NEW.protocol_year IS DISTINCT FROM OLD.protocol_year
    OR NEW.protocol_sequence IS DISTINCT FROM OLD.protocol_sequence
    OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
 THEN
   RAISE EXCEPTION 'Identidade do chamado e protocolo são imutáveis';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER tickets_protocol_immutable
 BEFORE UPDATE ON anna_sd.tickets
 FOR EACH ROW EXECUTE FUNCTION anna_sd.prevent_protocol_change();
-- Históricos são append-only; impedir UPDATE/DELETE inclusive por papéis
-- que obtenham acesso à tabela no futuro. Administração/retencão exige
-- procedimento excepcional auditado, não via API comum.
CREATE FUNCTION anna_sd.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,anna_sd AS $$
BEGIN
 RAISE EXCEPTION 'Histórico imutável: operação não permitida';
END;
$$;
CREATE TRIGGER ticket_events_append_only
 BEFORE UPDATE OR DELETE ON anna_sd.ticket_events
 FOR EACH ROW EXECUTE FUNCTION anna_sd.reject_history_mutation();
CREATE TRIGGER audit_events_append_only
 BEFORE UPDATE OR DELETE ON anna_sd.audit_events
 FOR EACH ROW EXECUTE FUNCTION anna_sd.reject_history_mutation();
REVOKE ALL ON FUNCTION anna_sd.prevent_protocol_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION anna_sd.reject_history_mutation() FROM PUBLIC;
COMMIT;
-- TODO: validar em PostgreSQL 15+ e configurar privilégios da API;
-- trigger não substitui isolamento, autenticação nem testes de segurança.
