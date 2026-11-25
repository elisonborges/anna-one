# Incremento 11 — Organograma integrado

Consulta consolidada somente leitura via GET /v1/organogram, com o runtime restrito existente e escopo institucional confirmado pelo Master. Nenhuma migração necessária. Usa as tabelas implantadas até 008. A API entrega entidades e relações diretas, sem CPF, CNPJ, e-mail, telefone ou referência documental de contatos. RLS de contatos preservada, com filtro defensivo adicional na interface. Grupos e relações matriz/filial do Master são adicionados apenas a partir do conjunto já autorizado no painel. Grupos empresariais e operacionais permanecem distintos.

Interface com indicadores, busca, seleção de entidade focal, relações de entrada e saída, filtro de dimensão, navegação pelo relacionamento, retorno ao foco anterior e tabela acessível. Não deduz controle indireto, licenças nem hierarquia única. Vínculos com vigência são exibidos quando atuais. Layout em colunas responsivas, sem dependências novas.

Validação executada: consulta SQL em produção somente leitura com role anna_business_runtime (sem dados corporativos cadastrados); consulta sem associação também retornou zero. Nove verificações de modelo com dados sintéticos: escopo de instituições e grupos, descarte de relações fora de escopo, restrição de contatos, relações autorizadas, parentesco e grupos Master, relações diretas, estado vazio. Sintaxe JS e IDs HTML sem erros. Não foram feitas gravações no Neon. Deploy e teste autenticado no navegador continuam pendentes. Consulta consolidada pode exigir paginação em volumes maiores. Esta entrega não é um grafo global com posicionamento automático: usa mapa relacional de um foco por vez.

PR 122 e migração 008 integrados. Este PR exige autorização para merge.
