# AnnA Service Desk — API v1 (contrato de implementação)

**Estado:** projeto técnico. O portal estático não possui backend nem autenticação real. Nenhum endpoint deste documento está publicado.

## Regras de identidade e autorização
O backend valida sessão assinada e expiração em cada requisição; resolve o usuário no banco e seus vínculos ativos. O navegador nunca escolhe o papel ou a instituição sem validação. Conhecer o protocolo ou UUID não concede acesso. A autorização é conferida antes de cada leitura, atualização ou anexo.

## Rotas planejadas
- `GET /api/v1/me/contexts`: instituições e unidades com vínculo ativo.
- `GET /api/v1/tickets`: somente chamados autorizados.
- `POST /api/v1/tickets`: criação com chave de idempotência UUID.
- `GET /api/v1/tickets/:id`: leitura com autorização por instituição e escopo.
- `GET /api/v1/tickets/:id/events`: histórico filtrado por visibilidade.
- `POST /api/v1/tickets/:id/messages`: mensagem com autor autenticado.
- `POST /api/v1/tickets/:id/priority-reviews`: pedido justificado, sem mudança automática de prioridade.

## Transação de abertura
Validar identidade, vínculo, unidade, categoria e entrada. Dentro de **uma única transação**, reservar chave idempotente, gerar protocolo via `anna_sd.next_protocol`, inserir chamado, evento inicial e auditoria. Responder após COMMIT. Repetição com mesma chave e mesmo conteúdo retorna o chamado existente; conteúdo diferente retorna 409.

## Segurança obrigatória
Sem conexão direta do navegador ao PostgreSQL; sem chave administrativa no JavaScript público. Políticas RLS, papéis SQL de menor privilégio e testes com usuários de instituições distintas devem anteceder integração. O banco isolado tem RLS ativado, mas não há políticas de acesso validadas.

## Critérios para aceitar implementação real
Sessões inválidas são rejeitadas; usuário da instituição A não lê B; prestadora sem contrato não lê chamados; protocolos concorrentes são únicos; mensagem interna não é mostrada ao solicitante; revogação bloqueia novos acessos; auditoria é imutável.

**Próximo passo:** implementar servidor de API e testes de autorização em ambiente isolado. Não habilitar o portal público como cliente real antes de validar esses critérios.
