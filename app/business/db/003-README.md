# Incremento 05 — Empresas próprias e classificações

Migração 003 preparada e testada no Neon, branch temporária br-young-heart-b62w38nt, migration_id ff3f294f-0926-4725-aa92-dc8713b72d8d. Produção não alterada. Os registros de teste existem exclusivamente na branch isolada.

- Cadastro único PF/PJ com múltiplos papéis: cliente, fornecedor, parceiro, prestador, representante.
- Empresa própria: somente PJ ativa, com autorização owner, preservando a separação entre entidade jurídica e tenant.
- Classificação e auditoria em operação atômica; repetição da mesma classificação não cria duplicata ou novo evento.
- Pesquisa e filtro sobre os até 500 registros carregados. CPF não é retornado. Sem remoção/edição de papéis neste incremento.
- A interface só habilita as classificações se o contexto da API anunciar suporte. Antes de publicar, aplicar a migração 003 e concluir a ativação do PR 116 no Worker. Alterar Production branch para main somente no Worker Business. Não modificar Worker Master.

Testes efetivamente executados com role anna_business_runtime: cliente e fornecedor na mesma PJ, empresa própria, repetição sem duplicação, 3 eventos auditados, tentativa de PF como empresa própria bloqueada, tentativa de editor bloqueada, outro tenant sem acesso. Validação real autenticada da API e renderização no navegador ainda pendentes.
