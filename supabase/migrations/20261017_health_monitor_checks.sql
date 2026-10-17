-- AnnA One Health Monitor v0.5
-- Execute no SQL Editor do projeto AnnA One (tnvghprwltbziivlxeod).
-- Historico consultavel apenas por administradores gerais autenticados.
create table if not exists public.health_monitor_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null,
  service_code text not null check (service_code in ('anna_one','projetos_escolares')),
  healthy boolean not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  details text,
  created_at timestamptz not null default now(),
  unique (checked_at, service_code)
);
create index if not exists health_monitor_checks_service_time_idx
  on public.health_monitor_checks(service_code, checked_at desc);
alter table public.health_monitor_checks enable row level security;
revoke all on public.health_monitor_checks from anon;
grant select on public.health_monitor_checks to authenticated;
drop policy if exists platform_admin_read_health_checks on public.health_monitor_checks;
create policy platform_admin_read_health_checks
  on public.health_monitor_checks for select to authenticated
  using (exists (
    select 1 from public.platform_admins p
    where p.user_id = (select auth.uid())
  ));
-- Nao criar politica de INSERT para anon/authenticated.
-- Escrita do monitor sera realizada futuramente por mecanismo servidor autorizado.
