# AnnA Service Desk — Neon exclusivo: homologação de autenticação

## Confirmado no banco isolado

- Projeto Neon: `small-fire-59850118`, banco `neondb`.
- `anna_sd.local_credentials`: RLS ENABLE + FORCE; nenhuma credencial cadastrada.
- `anna_sd_identity_runtime`: NOLOGIN, consulta credenciais e vínculos ativos.
- `anna_sd_api_runtime`: NOLOGIN, leitura RLS de chamados do solicitante.
- `anna_sd_app_login`: LOGIN, NOINHERIT, NOCREATEROLE, NOBYPASSRLS, sem senha. Somente as duas associações restritas, ambas com SET TRUE; nenhum SELECT direto em tickets ou credenciais.
- Rota `POST /api/v1/auth/login` implementada; token 15 minutos; cinco erros bloqueiam por 15 minutos; exige membership ativo.
- Testes unitários registrados; não alegar teste real de login ou implantação.

## Procedimento restante — sem colocar senhas no chat/GitHub

1. Na interface segura do Neon, definir senha aleatória forte para `anna_sd_app_login`. **Não** usar a API de criação de roles do Neon que concedeu `neon_superuser` em tentativa anterior. Auditar novamente as associações após configurar a senha.
2. No host privado da API, salvar `DATABASE_URL` em secret manager (usuário `anna_sd_app_login`, TLS `sslmode=verify-full`), mais `SD_JWT_SECRET` aleatório >=32 bytes, `SD_JWT_ISSUER` e `SD_JWT_AUDIENCE`. Nunca usar `neondb_owner` ou publicar URL.
3. Provisionar o primeiro usuário por procedimento administrativo controlado: gerar UUID, hash com `hashPassword`, inserir em `anna_sd.platform_users` e `anna_sd.local_credentials` e criar membership ativo no tenant correto. Não habilitar cadastro público antes de implementar confirmação de e-mail e recuperação de senha.
4. Executar `node preflight.cjs`, `npm test` e teste HTTP real: login válido -> 200/token; inválido -> 401; sem vínculo -> 401; GET /tickets sem token -> 401; com token -> somente chamados permitidos; segundo tenant -> isolamento.
5. Antes de abrir para a internet: HTTPS, rate limiting por IP/usuário, auditoria de login, política de recuperação de senha, gerenciamento de sessão/revogação e deploy explicitamente aprovado.

## Limites

O Neon é o único banco e provedor de identidade persistente do Service Desk. Nenhum projeto Supabase deve ser reutilizado. **Sem credencial secreta armazenada com segurança e sem host de API definido, não declarar integração ponta a ponta concluída.**
