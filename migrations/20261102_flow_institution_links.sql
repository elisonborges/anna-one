-- AnnA Flow: associação explícita Portal (UUID) ↔ Flow (BIGINT).
-- Aplicar no Neon do PORTAL somente após aprovação e conferência do cliente no Neon Flow.
-- Não altera cadastros existentes nem concede acesso por si só.
CREATE TABLE IF NOT EXISTS public.flow_institution_links (
  institution_id uuid PRIMARY KEY REFERENCES public.institutions(id) ON DELETE RESTRICT,
  flow_client_id bigint NOT NULL UNIQUE CHECK (flow_client_id > 0),
  linked_by uuid NOT NULL REFERENCES public.app_users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.flow_institution_links IS 'Mapeamento explícito Portal AnnA One → cliente no banco Neon AnnA Flow; não substitui verificação de acesso no backend Flow.';
