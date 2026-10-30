-- AnnA One v0.9.0 — exemplo de operação auditada, NÃO EXECUTAR SEM BACKEND VALIDADO.
-- Executar somente após provisionar um papel de serviço restrito, sem acesso público.
-- A aplicação servidora deve validar sessão e permissão antes de invocar a operação.
-- actor_user_id deve vir da sessão validada; jamais aceitar o identificador do navegador.
--
-- Este procedimento demonstra atomicidade: alteração e auditoria na mesma transação
-- (uma exceção desfaz ambas). Não disponibilizar em Data API pública.

CREATE OR REPLACE FUNCTION anna_audit.set_institution_status(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_status text,
  p_request_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, anna_audit
AS $$
DECLARE
  v_previous_status text;
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Situação inválida';
  END IF;

  SELECT status INTO v_previous_status
  FROM public.institutions WHERE id = p_institution_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instituição não encontrada';
  END IF;

  IF v_previous_status = p_status THEN
    RETURN false;
  END IF;

  UPDATE public.institutions SET status = p_status WHERE id = p_institution_id;

  INSERT INTO anna_audit.audit_logs
    (actor_user_id, institution_id, action, entity_type, entity_id, details, request_id)
  VALUES
    (p_actor_user_id, p_institution_id, 'institution.status.updated',
     'institution', p_institution_id::text,
     jsonb_build_object('before', v_previous_status, 'after', p_status),
     p_request_id);

  RETURN true;
END;
$$;

-- Obrigatório antes de ativar: impedir EXECUTE público e conceder somente
-- ao papel servidor autenticado e com permissões mínimas.
REVOKE ALL ON FUNCTION anna_audit.set_institution_status(uuid,uuid,text,text) FROM PUBLIC;
-- GRANT USAGE ON SCHEMA anna_audit TO <papel_servidor>;
-- GRANT EXECUTE ON FUNCTION anna_audit.set_institution_status(uuid,uuid,text,text) TO <papel_servidor>;
-- Testar privilégios de UPDATE/INSERT necessários ao SECURITY INVOKER.
