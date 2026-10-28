-- AnnA Health Monitor v5.3 — PROPOSTA NÃO APLICADA
-- Revisão de segurança e testes RLS obrigatórios antes da execução.
-- Reutiliza public.institutions, public.memberships e auth.users.
-- Não altera tabelas históricas existentes nem concede leitura de métricas internas.
create table if not exists public.health_client_monitors (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  monitor_type text not null check (monitor_type in ('https','http')),
  target_url text not null check (target_url ~* '^https?://'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id,institution_id)
);
create table if not exists public.health_client_dashboards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id,institution_id)
);
create table if not exists public.health_client_dashboard_monitors (
  institution_id uuid not null,
  dashboard_id uuid not null,
  monitor_id uuid not null,
  position integer not null default 0,
  primary key (dashboard_id,monitor_id),
  foreign key (dashboard_id,institution_id) references public.health_client_dashboards(id,institution_id) on delete cascade,
  foreign key (monitor_id,institution_id) references public.health_client_monitors(id,institution_id) on delete cascade
);
alter table public.health_client_monitors enable row level security;
alter table public.health_client_dashboards enable row level security;
alter table public.health_client_dashboard_monitors enable row level security;
-- Consulta restrita a membros ativos da organização; administração da plataforma separada.
create policy health_client_monitors_read on public.health_client_monitors for select to authenticated
 using (exists(select 1 from public.memberships m where m.institution_id=health_client_monitors.institution_id and m.user_id=(select auth.uid()) and m.active));
create policy health_client_dashboards_read on public.health_client_dashboards for select to authenticated
 using (exists(select 1 from public.memberships m where m.institution_id=health_client_dashboards.institution_id and m.user_id=(select auth.uid()) and m.active));
create policy health_client_dashboard_monitors_read on public.health_client_dashboard_monitors for select to authenticated
 using (exists(select 1 from public.memberships m where m.institution_id=health_client_dashboard_monitors.institution_id and m.user_id=(select auth.uid()) and m.active));
-- Escrita, provisionamento e validação de endpoints devem ser implementados
-- exclusivamente após revisão do modelo de permissões e proteção contra SSRF.
-- Sem GRANTs para API nesta etapa: tabelas novas permanecem inacessíveis ao frontend.
