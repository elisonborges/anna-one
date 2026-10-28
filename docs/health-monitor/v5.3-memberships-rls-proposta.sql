-- AnnA Health Monitor v5.3 — POLÍTICA PROPOSTA / NÃO EXECUTADA
-- Aplicar SOMENTE após revisar definição de public.is_platform_admin(),
-- privilégios existentes e teste com contas de administrador e cliente.
-- Preserva políticas SELECT atuais e não concede acesso a dados de monitoramento.
begin;
alter table public.memberships enable row level security;
-- Permissão de escrita restrita ao administrador da plataforma.
-- A função public.is_platform_admin() já é utilizada no projeto;
-- confirmar seu comportamento e privilégios antes de aplicar.
create policy hm_v53_admin_insert_memberships
on public.memberships for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select public.is_platform_admin())
  and active = true
  and role in ('institution_admin','manager','teacher','technician')
  and exists (select 1 from public.institutions i where i.id = institution_id and i.status = 'active')
);
-- Não permitir alterar ou excluir vínculos nesta etapa.
-- GRANT é independente da RLS; habilitar só após aprovação e testes:
-- grant insert on public.memberships to authenticated;
commit;

-- Plano de validação (ambiente de teste, SEM dados reais):
-- 1. Admin autenticado cria vínculo para usuário existente de organização ativa.
-- 2. Cliente autenticado tenta INSERT em sua organização: deve falhar.
-- 3. Cliente tenta INSERT em organização alheia: deve falhar.
-- 4. Anônimo tenta INSERT: deve falhar.
-- 5. UUID de usuário inexistente deve falhar por FK.
-- 6. Repetição do vínculo deve respeitar chave/unique existente.
-- 7. Verificar SELECT de memberships e institutions com ambas as contas.
-- 8. Revisar grants e funções SECURITY DEFINER com Security Advisor.
