# Incremento 07 — Estrutura corporativa

Migração 005 preparada no Neon, branch temporária br-fragrant-glitter-b6iggwsh, migration_id b2f24ba8-4750-4867-9c6b-6a205a254295. Não aplicada à produção.

- Grupos empresariais separados de public.institution_groups, sem duplicar pessoas jurídicas.
- Participação de PJ ativa como integrante ou coordenadora. Não representa participação societária nem propriedade. Uma PJ pode participar de mais de um grupo.
- Supervisão administrativa entre instituições operacionais do Master, com gestão delegada/autonomia local ou gestão centralizada. Uma supervisão direta por instituição. A API valida ambas as instituições no Master, verifica ciclos no comando SQL e usa transação serializável para proteger chamadas concorrentes. A credencial de runtime é exclusiva do backend e não deve aceitar SQL arbitrário.
- RLS por ambiente interno, escrita somente por proprietário, auditoria atômica. Preserva UUIDs, CLI, matrizes, filiais e grupos do Master.
- Interface compacta separada dos grupos do Master. Consulta e inclusão somente; edição, encerramento, retificação, vigência histórica e participações societárias serão implementados separadamente.

Testes executados no Neon com anna_business_runtime em homologação: criação de grupo, duas PJs no mesmo grupo, duplicidade de participação bloqueada, duas relações administrativas encadeadas, ciclo e segunda supervisão direta bloqueados, PF como integrante e editor criando grupo rejeitados, cinco eventos de auditoria. Sintaxe JS e IDs HTML verificados. Teste de concorrência simultânea e validação autenticada do Worker e navegador ainda pendentes.

O PR #118 e a migração 004 já foram integrados à produção. A implantação do incremento 07 exige autorização da migração 005 e merge. Todos os dados fictícios permanecem na branch de testes.
