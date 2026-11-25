# Incremento 13 — CRM e oportunidades (v0.2)

Migração 010 preparada na branch de homologação br-sparkling-bar-b6v3a89i (migration_id 92421c79-850d-42d4-825e-f1e59a742804). Não aplicada à produção.

Oportunidade vinculada a PF/PJ ativa já cadastrada, com título, estimativa em BRL opcional, previsão de fechamento e próximo acompanhamento. Seis etapas: prospecção, qualificação, proposta, negociação, ganha e perdida. Perda exige motivo. Encerramentos não são reabertos neste incremento. Atualização com revisão otimista e transação serializável. Interações por telefone, e-mail, reunião, mensagem, visita ou outro, com data e resumo. Não gera contrato, proposta formal ou lançamento financeiro. CRM restrito ao proprietário e editor por RLS. Auditoria registra criação, alterações de etapa/valor, e registro de interação sem copiar seu resumo. Interface com funil horizontal responsivo, filtros, indicadores e abertura do histórico.

Testes reais no Neon isolado com anna_business_runtime: criação por editor, atualização de etapa, revisão antiga bloqueada, interação, ganho, reabertura bloqueada, encerramento limpa próximo acompanhamento, perda com motivo, perda sem motivo bloqueada, interação futura bloqueada, leitor sem acesso e sem criação, seis eventos de auditoria. Sintaxe JavaScript e IDs HTML verificados. Validação autenticada no navegador, deploy e concorrência simultânea pendentes. Não inclui distribuição de vendedores, reabertura, catálogo, propostas formais ou previsão ponderada nesta entrega. Todos os dados de teste permanecem na branch isolada.

PR 124 e migração 009 integrados. A migração 010 e este PR aguardam autorização de publicação.
