# Incremento 08 — Estrutura societária

Migração 006 preparada na branch isolada br-spring-butterfly-b6uebp1r (migration_id d207532f-2b7b-4646-a7d6-b4e3728853ad). Não aplicada à produção.

Quadro societário direto declaratório, empresa investida PJ ativa, sócio PF/PJ ativo, capital e votos independentes com até seis casas decimais. Votos não informados são nulos. Controle individual, compartilhado, não declarado ou não informado é registrado explicitamente e não inferido. Capital/votos conhecidos não podem superar 100% pelo comando SQL, executado pela API em transação serializável. RLS restringe ambiente interno e escrita ao proprietário. O runtime é exclusivo do backend, não deve expor SQL arbitrário. Não calcula controle indireto, beneficiário final ou efeitos legais; não inclui alteração, encerramento ou histórico neste incremento.

Testes executados com role anna_business_runtime em homologação: sócio PJ e PF, capital fracionário, capital total de 100%, voto desconhecido, duplicidade e excesso de capital/votos bloqueados, PF investida, autoparticipação e editor bloqueados, três eventos de auditoria. Sintaxe JS e IDs HTML verificados. Testes de concorrência simultânea, deploy e sessão autenticada real pendentes.

PR 119 e migração 005 integrados; a migração 006 e este PR exigem autorização de publicação. Dados fictícios exclusivamente na branch temporária.
