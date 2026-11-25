# Incremento 14 — Catálogo de produtos e serviços (v0.2)

Migração 011 preparada na branch de homologação br-green-breeze-b61e2g0m (migration_id d2331049-f507-4227-98bf-90f4df79191a). Não aplicada à produção.

Catálogo compartilhado pelo tenant interno, com categorias únicas por nome normalizado, itens de tipo produto, serviço ou licença, código numérico permanente apresentado como CAT-00000001, nome, descrição opcional, unidade comercial compatível com o tipo e estado ativo/inativo. Tipo e código imutáveis. Edição versionada, desativação e reativação sem excluir histórico; operação atômica com auditoria antes/depois. RLS restrita ao proprietário e editor. A API não expõe SQL arbitrário. Interface responsiva com cadastro de categorias, edição e filtros por nome/código/descrição, tipo, categoria e situação. Sem preços embutidos, estoque, tributação, direitos de licença ou vínculo com empresa vendedora nesta entrega; essas dimensões serão tratadas separadamente. Categorias podem ser criadas, mas não renomeadas ou excluídas nesta versão.

Testes reais no Neon isolado com anna_business_runtime: criação de categoria e três tipos de item, códigos distintos, edição com código preservado, desativação/reativação, revisão antiga rejeitada, categoria duplicada e unidade incompatível bloqueadas, leitor sem acesso nem criação, seis eventos de auditoria. Sintaxe JS e IDs HTML verificados. Validação autenticada no navegador, deploy e concorrência simultânea pendentes. Dados fictícios exclusivamente na branch temporária.

Migração 010 e PR 125 integrados. A migração 011 e este PR aguardam autorização de publicação.
