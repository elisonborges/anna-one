-- AnnA One Master v1.0 — migração PROPOSTA (NÃO EXECUTADA)
-- A chamada deve ser feita apenas por identidade autenticada validada no backend.
-- Não conceder EXECUTE a PUBLIC nem expor diretamente na Data API.
BEGIN;
CREATE OR REPLACE FUNCTION anna_audit.master_create_institution(
  p_actor uuid, p_name text, p_slug text, p_request_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, anna_audit AS $$
DECLARE v_id uuid; v_name text := btrim(p_name); v_slug text := btrim(p_slug);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_actor) THEN
    RAISE EXCEPTION 'Acesso Master negado' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 160 OR
     v_slug IS NULL OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug)>80 THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.institutions(name, slug, status)
    VALUES (v_name,v_slug,'active') RETURNING id INTO v_id;
  INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details,request_id)
    VALUES (p_actor,v_id,'institution.created','institution',v_id::text,
      jsonb_build_object('name',v_name,'slug',v_slug,'status','active'),p_request_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION anna_audit.master_create_institution(uuid,text,text,text) FROM PUBLIC;
COMMIT;
-- Atenção: SECURITY INVOKER não é autorização suficiente isoladamente.
-- O backend deve vincular p_actor ao JWT validado e usar credencial de banco
-- com privilégios mínimos; jamais aceitar p_actor fornecido pelo navegador.
