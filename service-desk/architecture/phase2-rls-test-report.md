# AnnA Service Desk — teste RLS da migração 005

Projeto de teste: `small-fire-59850118`, branch `main`.

## Alterações executadas
- Criado `anna_sd_api_runtime` como papel `NOLOGIN NOINHERIT NOBYPASSRLS`, sem papéis herdados.
- Concedido apenas `USAGE` no schema e `SELECT` em `memberships` e `tickets`.
- Criadas políticas `api_own_memberships` e `api_own_tickets`.
- Para simulação de testes, o proprietário `neondb_owner` recebeu permissão de `SET ROLE anna_sd_api_runtime`.
- Adicionado vínculo ativo **fictício** do solicitante do chamado de teste anterior.

## Resultados executados
Com `SET LOCAL ROLE anna_sd_api_runtime` e `anna_sd.actor_id` igual ao solicitante fictício: **1 chamado, 1 vínculo**.

Com identidade fictícia diferente: **0 chamados, 0 vínculos**.

**Limitações:** `anna_sd.actor_id` é uma configuração de sessão que pode ser modificada por qualquer conexão SQL autorizada. Portanto, **somente um backend confiável pode configurá-la** depois de validar uma sessão real. Jamais compartilhar credenciais SQL com o navegador. Os testes não incluem duas instituições com chamados próprios, sessão autenticada, concorrência nem endpoints HTTP.

**Estado:** leitura requester validada apenas no banco de testes; nenhuma credencial de login de menor privilégio ou servidor implantado. A API continua sem rotas de chamados e não está ligada ao banco.
