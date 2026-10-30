# AnnA Service Desk — alerta de segurança da conexão de teste

**Status: BLOQUEADO para integração.**

Em 30/10/2026, no projeto Neon de testes isolados `small-fire-59850118`, foi criada a identidade `anna_sd_api_probe` para verificar conectividade. O teste `SELECT 1` funcionou, mas a consulta de permissões confirmou que a identidade **herda `neon_superuser`** e possui leitura em `anna_sd.tickets`. Portanto **não é uma credencial de menor privilégio e não pode ser usada na API**.

Tentativas de `REVOKE neon_superuser FROM anna_sd_api_probe` e `ALTER ROLE anna_sd_api_probe NOLOGIN` retornaram permissão negada. Nenhuma string de conexão ou senha foi adicionada ao repositório ou à API.

## Ação necessária antes da integração
1. No painel administrativo do Neon, **revogar/desativar ou excluir `anna_sd_api_probe`**; confirmar que a credencial não permanece utilizável. Não reutilizar sua senha.
2. Criar um usuário de conexão sem herança de `neon_superuser` ou outros privilégios elevados; confirmar `SELECT current_user` e `has_table_privilege` antes de configurar `DATABASE_URL`.
3. Validar ausência de acesso direto a tabelas sensíveis, políticas RLS por identidade e testes de isolamento entre instituições.
4. Somente então configurar o segredo no ambiente de execução privado e iniciar API real.

**Verificação de conectividade:** o projeto Neon responde a consultas, mas a API Node.js não foi implantada nem configurada com credenciais. O portal segue demonstrativo.
