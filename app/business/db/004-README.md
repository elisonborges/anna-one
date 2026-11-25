# Incremento 06 — Vínculos institucionais

Migração 004 preparada em branch isolada br-hidden-shadow-b6iqw38c (migration_id 823cceea-198a-4338-8363-00e11736e169). Não aplicada à produção.

A instituição operacional continua em public.institutions com UUID e código CLI originais. A relação aponta para pessoa jurídica ativa e, opcionalmente, um estabelecimento ativo pertencente à mesma pessoa jurídica. Somente proprietário do tenant interno pode registrar o vínculo. A API consulta o Master por Service Binding com o mesmo bearer validado, e recusa instituição fora da lista autorizada. Não concede acesso direto de leitura ao Master via role de banco do Business.

Vínculo com início na data corrente do banco. Um operador vigente por instituição neste modelo. A mesma pessoa jurídica pode atender mais de uma instituição operacional. Vínculo e evento de auditoria são registrados atomicamente. Não inferir propriedade, relação societária, contrato, autorização operacional ou destinatário fiscal pelo vínculo. Encerramento, retificação e gestão de vigência serão implementados separadamente; nesta entrega não há edição/exclusão.

Testes executados com role anna_business_runtime em homologação:
- criação de vínculo PJ + estabelecimento;
- repetição para mesma instituição sem gerar outro vínculo;
- PF, editor e estabelecimento inválido bloqueados por RLS;
- auditoria confirmada;
- segunda instituição vinculada à mesma PJ sem estabelecimento específico, 2 vínculos / 1 PJ.
- sintaxe JS e IDs HTML verificados.

Todos os dados fictícios ficaram na branch isolada. A implantação exige autorização de migração 004 e merge. Teste autenticado do Worker e renderização no navegador pendentes. O PR #117 já foi mesclado e a migração 003 foi aplicada à produção. O status do build Cloudflare a partir de main ainda precisa ser confirmado.
