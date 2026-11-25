-- EXEMPLO DE PROVISIONAMENTO. Não é migração automática.
-- Criar a role anna_business_runtime LOGIN NOINHERIT NOBYPASSRLS
-- NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION com senha forte
-- em sessão administrativa privada. Não usar role neon_superuser.
-- Confirmar que a role não é membro de outras roles privilegiadas e não possui tabelas.
GRANT USAGE ON SCHEMA core,business TO anna_business_runtime;
GRANT SELECT ON business.tenants,business.tenant_memberships,business.companies,core.parties,core.establishments TO anna_business_runtime;
GRANT INSERT ON core.parties,core.establishments,business.audit_events TO anna_business_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core TO anna_business_runtime;
GRANT EXECUTE ON FUNCTION business.create_party(text,text,text,text,text,uuid),business.create_establishment(uuid,text,text,text,uuid) TO anna_business_runtime;
-- Provisionamento explícito pelo administrador (não pelo runtime).
-- INSERT INTO business.tenants(code,name,kind) VALUES ('ANNA_INTERNAL','AnnA One','internal') RETURNING id;
-- INSERT INTO business.tenant_memberships(tenant_id,user_id,role) VALUES ('UUID_TENANT_CONFIRMADO','UUID_APP_USER_CONFIRMADO','owner');
-- Substituir os valores de exemplo apenas após confirmar identidade e autorização.
