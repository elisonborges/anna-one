# Incremento 12 — Gestão cadastral e consolidação

Migração 009 preparada em homologação br-still-leaf-b6phkvib (migration_id 30e80b19-e297-41be-bb0f-5469d9a5fdb6). Não aplicada à produção.

- Busca global por nome, identificação, código, CLI e tipo sobre as entidades já autorizadas pelo organograma. Resultados exibidos até 150, com refinamento; acesso ao mapa a partir do registro.
- Edição de nome/razão social e nome fantasia/social de PF/PJ e nome de estabelecimento por proprietário/editor. Não modifica códigos, CPF, CNPJ, tipo ou identificador. Compara valores anteriores e usa transação serializável para conflitos; auditoria registra antes/depois.
- Encerramento por proprietário dos vínculos institucionais, contatos/representações e franquias. Último dia de vigência inclusivo na interface; no vínculo institucional é convertido para fim exclusivo. Somente encurtamento, não reabertura/extensão. Motivo obrigatório, histórico consultável, sem exclusão. Na interface, encerramentos de períodos já expirados não são oferecidos. Não é rescisão legal nem revogação jurídica por si só.
- Auditoria restrita ao proprietário, últimos 100 eventos de tipos conhecidos; registros institucionais e de supervisão respeitam escopo Master. Identificação por UUID do responsável e da solicitação. RLS e concessões por coluna. Nenhuma ampliação de acesso a public.*.
- Sem edição/revogação de classificações, participações societárias, grupos ou supervisão administrativa nesta entrega; não inclui alteração de documentos de identificação, anexos, paginação completa ou edição de vigências históricas fora dos casos acima. API dedicada não aceita SQL arbitrário.

Testes reais no Neon isolado com anna_business_runtime: edição por editor de PF/PJ e estabelecimento (fixture PJ), conflito de valores antigos bloqueado, três encerramentos, conversão de fim exclusivo, tentativa fora do escopo e extensão bloqueadas, editor não encerra, leitor não edita, leitor sem acesso aos contatos, cinco eventos de auditoria, editor/leitor sem leitura de auditoria. Consultas SQL efetivas das rotas de manutenção e auditoria com três perfis. Sintaxe JS e IDs HTML verificados. Validação autenticada no navegador, deploy e concorrência simultânea pendentes. Todos os dados de teste permanecem na branch temporária.

PR 123 integrado sem migração. A publicação deste incremento exige autorização da migração 009, merge e encerramento da branch de teste.
