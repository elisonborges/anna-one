# Incremento 61 — Painel executivo integrado (v1.0)

Visão consolidada do tenant interno, exclusiva do proprietário. Indicadores derivados de registros existentes: empresas, oportunidades, funil estimado, contratos ativos, saldos de parcelas e atrasos, requisições de compra aguardando aprovação, patrimônio, movimentações de estoque, documentos fiscais, concessões vigentes, serviços e pendências contábeis abertas e fila Connect. Não confunde funil com receitas, obrigações com caixa ou movimentações com saldo de estoque. Sem alterações de schema. API GET /v1/executive-dashboard e navegação integrada ao painel. Data de referência America/Fortaleza.

Consulta SQL executada com sucesso na branch de testes isolada com role anna_business_runtime e fixtures fictícias, retornando todos os 17 indicadores. Sintaxe JavaScript conferida. Homologação visual e autenticação em navegador pendentes. Depende das migrações 046–049.
