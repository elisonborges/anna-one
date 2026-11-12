-- AnnA One: controle individual por instituição e login
-- Aplicada no Neon anna-one em 2026-11-11, sem alterar autorizações existentes.
CREATE TABLE IF NOT EXISTS public.user_module_permissions (
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id,user_id,module_id),
  FOREIGN KEY (institution_id,user_id) REFERENCES public.memberships(institution_id,user_id) ON DELETE CASCADE
);
-- A autorização efetiva deve exigir simultaneamente:
-- (1) instituição e membership ativos;
-- (2) módulo available e autorizado pela instituição;
-- (3) user_module_permissions.enabled=true;
-- (4) o código Service Desk continua com controle próprio.
-- Controle de acesso e auditoria devem ocorrer no Cloudflare Worker.
