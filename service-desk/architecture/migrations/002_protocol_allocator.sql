-- AnnA Service Desk — proposta de geração atômica de protocolo.
-- NÃO APLICAR em produção sem autenticação, auditoria e testes de integração.
-- Função SECURITY INVOKER: a API confiável deve chamar dentro da transação
-- que cria o ticket, com permissões mínimas; nunca expor a usuários finais.
CREATE OR REPLACE FUNCTION anna_sd.next_protocol(
  p_tenant_id uuid,
  p_year integer,
  p_category_code text
) RETURNS TABLE(protocol_year integer, protocol_sequence bigint, public_protocol text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, anna_sd
AS $$
DECLARE
  v_code text;
  v_seq bigint;
BEGIN
  IF p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Ano inválido';
  END IF;
  IF p_category_code !~ '^[A-Z0-9_-]{2,20}$' THEN
    RAISE EXCEPTION 'Categoria inválida';
  END IF;
  SELECT code INTO v_code FROM anna_sd.tenants
  WHERE id = p_tenant_id AND active = true;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Instituição inexistente ou inativa';
  END IF;
  INSERT INTO anna_sd.protocol_counters (tenant_id, year, last_sequence)
  VALUES (p_tenant_id,p_year,1)
  ON CONFLICT (tenant_id,year) DO UPDATE
    SET last_sequence = anna_sd.protocol_counters.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN QUERY SELECT p_year,v_seq,
    v_code || '-' || p_category_code || '-' || p_year::text || '-' ||
    lpad(v_seq::text,8,'0');
END;
$$;
REVOKE ALL ON FUNCTION anna_sd.next_protocol(uuid,integer,text) FROM PUBLIC;
-- ATENÇÃO: sem GRANT de EXECUTE ou acesso às tabelas; integração futura via
-- backend de confiança e operação transacional com INSERT em tickets.
