-- RASCUNHO: NÃO EXECUTAR EM PRODUÇÃO SEM REVISÃO E APROVAÇÃO.
-- Dados complementares compartilhados por Agenda, Service Desk e AnnA One.
-- Preserva public.institutions e os cadastros existentes.
CREATE TABLE IF NOT EXISTS public.institution_profiles (
  institution_id uuid PRIMARY KEY REFERENCES public.institutions(id) ON DELETE RESTRICT,
  legal_name text,
  tax_id text,
  email text,
  phone text,
  website text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state text,
  address_postal_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- A validação de CNPJ, permissões de escrita e auditoria será feita no backend.
-- Não armazenar nome ou e-mail do administrador aqui: vínculos ficam em memberships.
