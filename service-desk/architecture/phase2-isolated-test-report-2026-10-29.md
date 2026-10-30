# AnnA Service Desk — execução real da Fase 2 em ambiente isolado

**Data:** 29/10/2026. **Banco:** Neon PostgreSQL 18, projeto exclusivo `anna-service-desk-test-isolado-20261028` (`small-fire-59850118`). **Não é produção.**

## Executado
- Migrações `001_phase2_foundation.sql`, `002_protocol_allocator.sql`, `003_tickets_operations.sql` e `004_integrity_idempotency.sql` aplicadas por transações SQL.
- Consulta confirmou **15 tabelas** com RLS habilitado e forçado.
- Consulta confirmou **zero políticas RLS**: situação deliberadamente bloqueada para usuários comuns, **não** uma API pronta.
- Inseridos dados estritamente fictícios: tenant `TESTLAB`, unidade e usuário sintéticos, chamado `TESTLAB-HD-2026-00000001`.
- Geração sequencial testada no mesmo tenant/ano: `TESTLAB-HD-2026-00000001` e `TESTLAB-NET-2026-00000002`; segunda alocação reservada no contador, sem segundo ticket.
- Teste de integridade por bloco SQL com exceções controladas: tentativa de modificar protocolo rejeitada; tentativa de alterar evento rejeitada; associação de mensagem com tenant incorreto rejeitada.
- Nenhum outro projeto AnnA One ou banco de produção foi modificado.

## Limites
Os testes executados não provam concorrência sob carga, RLS com papéis de usuário, revogação de vínculos, integração de autenticação, idempotência operacional, anexos privados, API ou LAN. Função `next_protocol` é invocável apenas por identidade privilegiada no teste; nenhuma concessão foi feita a clientes. A sequência precisa ser usada na mesma transação de criação do chamado para evitar lacunas por falha.

## Próximas entregas
1. Selecionar autenticação e modelo de execução confiável para nuvem e LAN.
2. Implementar papéis de banco e autorização de menor privilégio, com testes negativos entre dois tenants.
3. Criar API de criação transacional com chave idempotente e protocolo atômico.
4. Executar testes de concorrência e integração em ambiente isolado.
5. Integrar portal apenas após autenticação e segurança comprovadas.

**Status:** fundação PostgreSQL testada parcialmente; Fase 2 ainda não concluída.
