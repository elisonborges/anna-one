# AnnA Service Desk — teste de isolamento entre duas instituições

**Ambiente:** Neon isolado `small-fire-59850118`; nenhuma alteração em produção.

## Preparação
Criada instituição **TESTB** com unidade, usuário, vínculo requester ativo e chamado inteiramente fictícios. A instituição TESTLAB já possuía um chamado e vínculo fictícios.

## Execução e resultados
Em transações separadas, foi executado `SET LOCAL ROLE anna_sd_api_runtime`, seguido de `set_config('anna_sd.actor_id', identidade, true)` e leitura de `anna_sd.tickets`.

- Identidade TESTLAB: retornou apenas `TESTLAB-HD-2026-00000001`.
- Identidade TESTB: retornou apenas `TESTB-HD-2026-00000001`.

**Resultado:** isolamento RLS de leitura entre duas instituições validado neste cenário.

**Ainda não validado:** autenticação HTTP real, revogação de vínculo em tempo real, prestadoras, anexos, concorrência, idempotência completa e operação de API em servidor. A identidade SQL só é confiável quando definida por backend que verifica o token e não compartilha conexão com usuários finais.
