# Incremento 10 — Marcas e franquias

Migração 008 preparada na branch de homologação br-fancy-cherry-b6eqcavq (migration_id e537c1fd-0916-4b0e-884b-1bdac93c0329). Não aplicada à produção.

Marca declarada com titular PF/PJ, referência de registro opcional. Rede por marca e franqueadora PJ, com referência obrigatória de titularidade/autorização; titular e franqueadora podem ser distintos. Vínculo comercial por rede e empresa franqueada PJ, referência contratual, território opcional, início e fim opcional de vigência. A mesma empresa pode integrar redes distintas. Por ora, uma relação vigente por empresa e rede, sem divisão por estabelecimento ou território simultâneo. Registros declaratórios não comprovam direitos, não concedem permissões nem licenças do sistema e não substituem o módulo contratual. Escrita restrita ao proprietário, leitura a membros autorizados, RLS e auditoria atômica. API usa transação serializável para sobreposição. Sem edição, rescisão ou anexos nesta entrega.

Testes reais no Neon isolado com anna_business_runtime: marca com titular PF, franqueadora PJ distinta, duas vigências não sobrepostas da mesma franqueada, sobreposição e duplicidade de rede bloqueadas, marca duplicada por titular rejeitada, PF como franqueador/franqueado bloqueada, autofranquia bloqueada, editor impedido de escrever, quatro eventos de auditoria. Sintaxe JS e IDs HTML verificados. Teste autenticado real, navegador e concorrência simultânea pendentes.

Migração 007 e PR 121 integrados. A migração 008 e este PR aguardam autorização de implantação. Dados fictícios exclusivamente na branch temporária.
