# AnnA Service Desk — verificação após exclusão de credencial

**Data:** 2026-10-29 (verificação de continuidade).

No projeto de teste Neon `small-fire-59850118`, branch `main` (`br-snowy-hill-b6ng7c1q`), a lista de papéis confirma a ausência de `anna_sd_api_probe`.

Papéis restantes: `neondb_owner` (login e BYPASSRLS), `anna_sd_reader` (NOLOGIN, sem BYPASSRLS) e `anna_sd_writer` (NOLOGIN, sem BYPASSRLS). Todas as 15 tabelas `anna_sd` continuam com RLS habilitado e forçado. Consulta de concessões explícitas às funções reader/writer não encontrou privilégios de tabela.

**Conclusão:** o risco específico da credencial de teste foi removido. Não existe ainda usuário de conexão de privilégio mínimo para a API, nem configuração `DATABASE_URL` em servidor de execução. Não criar novos logins com a ferramenta de criação de roles sem verificar se herdam `neon_superuser`.

**Próxima implementação:** definir estratégia de autorização server-side, criar papel de aplicação realmente restrito por procedimento administrativo que permita controlar herança, testar isolamento e somente depois ativar endpoints de chamados. Nenhuma alteração em produção.
