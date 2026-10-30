# AnnA Service Desk — Contrato de autorização e testes (Fase 2)

**Status:** especificação verificável, sem backend conectado. Migrações 001, 002 e 003 são rascunhos e não foram aplicadas.

## Fronteira de confiança
O cliente envia somente token de sessão e dados do chamado; `tenant_id`, papel, vínculo e permissões são resolvidos **no servidor** a partir da identidade autenticada e das associações ativas no banco. Não aceitar cabeçalhos de tenant como prova de autorização. Não expor conexão PostgreSQL ou credenciais administrativas no navegador.

A migração 001 força RLS e revoga privilégios; a 002 define função `SECURITY INVOKER` sem `GRANT EXECUTE`. Portanto **não existe API utilizável ainda**. Antes de ativar qualquer endpoint, implementar papéis de banco de privilégio mínimo e políticas verificadas, inclusive para funções, anexos e auditoria.

## Matriz mínima de acesso (a validar)
| Ação | Solicitante | Técnico autorizado | Supervisor da instituição | Prestadora sem contrato |
|---|---|---|---|---|
| Criar chamado em unidade permitida | Sim | Conforme vínculo | Conforme vínculo | Não |
| Ler próprio chamado | Sim | Se escopo atribuído | Se escopo permitido | Não |
| Ler outro chamado do tenant | Não | Se fila autorizada | Conforme escopo | Não |
| Mensagem pública | Próprio chamado | Escopo autorizado | Escopo autorizado | Não |
| Mensagem interna | Não | Escopo autorizado | Escopo autorizado | Não |
| Pedir revisão de prioridade | Próprio chamado | Não por padrão | Conforme regra | Não |
| Aprovar revisão | Não | Se papel específico | Se papel específico | Não |
| Consultar anexos privados | Apenas os públicos do próprio chamado | Conforme escopo | Conforme escopo | Não |
| Ler auditoria | Não | Não | Apenas se explicitamente autorizado | Não |

A matriz não substitui validação de cada operação e de cada linha no backend.

## Sequência transacional de abertura
1. Autenticar usuário; selecionar contexto de instituição dentre vínculos ativos, sem confiar no tenant fornecido pelo cliente.
2. Verificar unidade, categoria, escopo, campos e anexos; normalizar entrada.
3. Iniciar transação. Gerar protocolo via `next_protocol(tenant,ano,categoria)`; inserir `tickets` com UUID e sequência retornada; inserir evento inicial e auditoria.
4. Confirmar transação. Em erro, reverter **todas** as operações; o número não deve ser anunciado antes do COMMIT.
5. Retornar UUID interno e protocolo público; pesquisa por protocolo **sempre** verifica acesso.

O contador da 002 é transacional: `INSERT ... ON CONFLICT DO UPDATE` serializa incrementos para a mesma instituição/ano. A aplicação deve evitar reexecutar POST após timeout sem chave de idempotência. **Pendência:** implementar chave idempotente única por instituição/solicitante e expiração de solicitações.

## Plano de testes obrigatórios (ambiente isolado)
1. Dois tenants A/B, dois usuários solicitantes, um técnico com vínculo somente em A. A não consegue ler, alterar ou listar B por UUID, protocolo ou anexo.
2. Prestadora vinculada a A e B, mas contrato ativo somente em A: negar B. Revogar vínculo A: negar novos acessos imediatamente.
3. Criar 100 chamados concorrentes para o mesmo tenant/ano: 100 protocolos únicos; sequência por ano; reclassificação mantém protocolo.
4. Forçar falha após alocar protocolo: rollback preserva contador; repetir com chave idempotente não duplica.
5. Mensagem interna e anexo interno invisíveis ao solicitante; acesso a objeto privado não é possível por URL pública.
6. Pedido de prioridade sem justificativa ou com menos de 10 caracteres é rejeitado; pedido válido não altera prioridade até aprovação autorizada.
7. Criar mensagem/evento com tenant A e ticket B: falha por FK composta; alterar `tenant_id` para B é rejeitado.
8. Inserir ou modificar `ticket_events`/`audit_events` com identidade de cliente comum: negar; apenas operações auditadas da API podem registrar eventos.
9. Testar autenticação expirada, vínculo revogado, perfil sem escopo, tentativa de escalada de papel, arquivos proibidos e tamanho acima de 5 MB.
10. Repetir testes no modo LAN e na nuvem, com mesmo comportamento.

## Revisões necessárias antes de ambiente real
- Vincular `platform_users` ao provedor de identidade escolhido; hoje é UUID sem autenticação.
- Adicionar isolamento por unidade e permissões de prestadoras em políticas efetivas.
- Garantir imutabilidade de eventos e protocolo por triggers/controle de escrita, sem funções privilegiadas expostas.
- Definir tabela de idempotência, modelo de categorias versionadas e serviço de anexos com varredura.
- Testar migrações em PostgreSQL 15+ descartável; não executar em bancos de outros produtos AnnA One.
- Confirmar prefixos de cliente/categoria e estratégia de restauração/backup.

## Critério para declarar Fase 2 concluída
Somente após API autenticada, migrações executadas em ambiente isolado, testes de isolamento e concorrência aprovados, auditoria e anexos privados comprovados, e integração com Portal validada. Até lá, **projeto técnico, não sistema operacional**.
