# Incremento 09 — Contatos e representantes

Migração 007 preparada na branch de homologação br-damp-tree-b68zxuk5 (migration_id 9d43b047-9e45-4878-aa90-cd7ada815ed9). Não aplicada à produção.

Relacionamento entre PJ e PF ativas, por função comercial, administrativa, financeira, técnica, contato jurídico, representação legal ou procuração. Cargo, e-mail e telefone profissionais opcionais; vigência inicial obrigatória e fim opcional. Representante legal e procurador exigem referência do instrumento e escopo declarado; não são validação jurídica nem concessão de acesso. Registro declaratório, sem armazenamento do instrumento. Proprietário registra representação; editor cadastra contatos funcionais e consulta, leitor não recebe contatos. RLS e auditoria atômica. Sem CPF na API. Comando SQL rejeita sobreposição de vigência para mesma empresa, pessoa e função; API usa transação serializável. Sem alteração/revogação de registros neste incremento.

Testes reais no Neon isolado com anna_business_runtime: quatro registros autorizados (dois períodos comerciais não sobrepostos, procuração e contato financeiro por editor), sobreposição bloqueada, procuração por editor bloqueada, falta de documento/escopo bloqueada, PJ como contato bloqueada, vigência invertida bloqueada, leitor sem acesso, quatro eventos de auditoria. Sintaxe JS e IDs HTML verificados. Teste real da sessão/Worker, navegador e concorrência simultânea pendentes.

Migração 006 e PR 120 integrados. Esta migração e este PR aguardam autorização antes de publicação. Todos os dados de teste estão isolados.
