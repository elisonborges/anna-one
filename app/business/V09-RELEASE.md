# AnnA Business v0.9.0-rc.1 — consolidação (incremento 60)

Candidato técnico à homologação, não publicado. Plano Diretor AB-PD-001: portais e integrações.

## Entregas e dependências
| Incremento | Entrega | Migração | PR |
|---|---|---|---|
|55|Concessões e portal externo|044|167 (main)|
|56|Publicações GED|045|168 (main)|
|57|Central Contábil|046|169 (rascunho)|
|58|AnnA Connect|047|170 (rascunho)|
|59|Acompanhamento de serviços|048|171 (rascunho)|
|60|Integração de eventos de serviço, limpeza de sessão e consolidação|049|branch de consolidação|

A migração 049 captura atualizações de status de serviço realizadas pelo proprietário e registra referência opaca na fila Connect, na mesma transação. Não captura abertura do cliente diretamente, não envia mensagens externas e não altera o Service Desk. O portal remove dados em memória e invalida consultas pendentes ao ocultar a aba ou sair; revalida ao retornar. Revogação não recolhe downloads já efetuados.

## Validações executadas
Ambiente Neon isolado br-sweet-boat-b69532hl, com fixtures fictícias. Migrações 046–049 executadas; nenhuma mudança na produção. Incrementos 57 e 58: RLS, duplicidades, pendências, revogação, histórico, estados de eventos e captura documental. Incremento 59: abertura e consulta pelo cliente, isolamento de contador, bloqueio de contrato inválido, atualização exclusiva do proprietário, histórico e revogação. Incremento 60: contrato fictício vinculado corretamente, referência disponível ao cliente autorizado, acesso direto ao contrato interno bloqueado, outro cliente isolado, abertura individual independente, evento Connect capturado uma vez e histórico registrado, leitura externa da fila bloqueada. Sintaxe JS e correspondência de IDs verificadas. Os testes SQL foram feitos em etapas na branch, não representam ensaio completo de instalação nova.

## Gate de homologação e liberação (pendente)
- Revisar os quatro PRs empilhados; confirmar CI, npm test, build Wrangler dry-run.
- Confirmar migrações 044 e 045 e backup; aplicar 046–049 em ordem em homologação aprovada, sem fixtures em produção.
- Testar login JWT real com owner, cliente, contador, usuário sem acesso; expiração, troca de conta, revogação de sessão e concessão e navegação mobile/desktop.
- Testar PDF completo, ZIP extraído, concorrência e limites de armazenamento, solicitações e estados de serviços, reprocessamento Connect.
- Conferir binding MASTER_AUTH, segredo DATABASE_URL e tenant autorizado; preservar Master e demais módulos.
- Após aprovação específica: integrar PRs em ordem, conferir base dos PRs subsequentes, realizar migrações e deploy controlados, validar endpoints e páginas. Não ativar deploy automático.
- Reversão operacional: bloquear publicação/acesso, reverter versão do Worker/frontend conforme compatibilidade; não apagar tabelas ou documentos como rollback sem análise e autorização.

## Limites
Connect tem fila e conciliação manual, não adaptadores externos, webhook assinado ou entrega automática. A Central Contábil trabalha com publicações e pendências, não escrituração oficial. Portal de serviços é acompanhamento empresarial, não integração automática com Service Desk. A homologação integral, concorrência, deploy e publicação continuam pendentes. A v1.0 deve partir deste candidato após validação, sem reiniciar os módulos anteriores.
