# AnnA Classroom — ponto de continuidade
Atualização: 07/11/2026 (horário do usuário, America/Fortaleza)

## Atualização v0.2.1 — 08/11/2026

- **Preservado:** layout aprovado, login Neon Auth, autorização Master/cliente, banco e API; nenhuma mudança nas tabelas nem dados reais.
- **Consulta:** listas de Turmas, Alunos, Matrículas, Aulas, Atividades e Entregas agora têm filtro local responsivo, sem distinção entre letras maiúsculas e acentos. Contador informa resultados filtrados entre os **registros carregados**.
- **Exportação:** botão CSV em cada lista, sob clique do administrador. Usa somente dados carregados/filtrados, UTF-8 com BOM, campo entre aspas e proteção contra injeção de fórmulas em planilhas. **Não é backup completo** nem contorna os limites atuais de leitura da API (100 registros por lista, 500 matrículas).
- **Atualização:** botão **Atualizar dados** nas seções de resumo e listagens, para recarregar manualmente os dados autorizados sem sair da área.
- **Testes:** `modules/anna-classroom/tests/smoke.test.mjs` com testes Node integrados e `modules/anna-classroom/package.json` com `npm test`. Conferências diretas feitas: sintaxe do frontend, busca por acentos, proteção CSV, espelhamento idêntico dos arquivos e presença dos elementos de login; todas passaram. **O `npm test` completo ainda não foi executado em um ambiente com checkout do repositório.**
- **Publicação:** alterações gravadas na `main` e cache das referências de CSS/JS atualizado para `classroom-v021-20261108`. Cloudflare Worker usa build automático, mas não há ferramenta disponível nesta conversa para afirmar que a versão nova já está ativa no Worker. Nenhum deploy Render necessário, pois a API não mudou.
- **Limites preservados:** não implementar perfis de estudante/professor, avaliações por nota, importação em massa, alteração/exclusão de registros reais ou mudança de DNS sem desenho de segurança e validação apropriada.

## Estado atual — Classroom v0.2 (08/11/2026)
**Validação final:** deploy da API Render `dep-dbnuqqlg1s2s73dof5cg` confirmado **live**. As consultas SELECT para Matrículas, Aulas, Atividades, Entregas e Resumo passaram usando o papel `classroom_api_service`, sem escrita. Função `can_manage_institution` alinhada ao módulo `status=available`; instituição piloto continua autorizada e usuário desconhecido rejeitado. Frontend em GitHub `main`, com cache versionado `classroom-v02b-20261108`; build do Cloudflare não pôde ser inspecionado diretamente.


**Este bloco prevalece sobre registros históricos abaixo quando houver divergências.**
- **Layout:** aprovado pelo usuário após correção da sidebar e logo; preservar sem redesenhar.
- **Fluxo:** Master atribui o módulo → Central do cliente mostra o acesso → Classroom valida Neon Auth e instituição via API; acesso direto com tela de login. Login real e acesso à visão geral foram confirmados pelo usuário em captura.
- **Instituição piloto:** COLEGIO TESTE com `turmas-e-alunos` disponível e habilitado. `anna_classroom.can_manage_institution` aplica verificação por JWT, instituição, vínculo administrativo e atribuição.
- **Frontend:** `public/{index.html,app.js,styles.css}`, espelhado em `modules/anna-classroom/`. V0.2 possui resumo institucional com contadores, cadastro/listagem de **Turmas, Alunos e Matrículas**, planejamento/listagem de **Aulas**, cadastro/listagem de **Atividades**, consulta de **Entregas e avaliações** (somente leitura), mensagem de status e **Sair** com limpeza do conteúdo da sessão. Todos os textos dinâmicos vão por `textContent`, sem injeção HTML.
- **API Render:** `/health` público; com JWT assinado Neon e autorização institucional: GET `/v1/access`, GET `/v1/overview`, GET/POST `/v1/classes`, `/v1/students`, `/v1/enrollments`, `/v1/lessons`, `/v1/assignments`; GET `/v1/submissions` apenas. POST `/v1/submissions` não liberado até arquitetura de perfis de estudantes. Cada operação escopa dados à instituição; FKs compostas do Neon impedem vínculo entre instituições.
- **Validações:** JavaScript da UI e da API passou checagem estática; cinco SELECTs com `classroom_api_service` nas tabelas novas passaram; produção permanece com **zero registros** nas seis tabelas. Nenhum aluno ou dado fictício cadastrado.
- **Implantação:** Cloudflare Worker usa assets `public/` e deploy via `npx wrangler deploy --config modules/anna-classroom/wrangler.jsonc`; GitHub main é fonte de publicação. Render autodeploy OFF: acionar deploy manual após alterações na API. O deploy do frontend depende do build Cloudflare e sua confirmação não é fornecida pelo GitHub.
- **Limitações conscientes:** primeira versão de gestão serve apenas administradores institucionais; professores/alunos ainda não têm fluxos próprios, nem envio de entregas, edição de notas, paginação acima de limites de 100/500 itens ou edição/exclusão de dados. Não anunciar essas funcionalidades como prontas.
- **Próxima fase:** validar cadastros reais somente mediante ação do administrador; definir papéis e autorizações de professor/aluno antes de ampliar entregas, correções e avaliações. Nunca publicar módulo para instituições não habilitadas nem alterar dados reais para testes.

## Regras aprovadas (não perguntar novamente)
- **Repositório principal e único para implementação:** `elisonborges/anna-one`, subdiretório `modules/anna-classroom/`.
- Layout padronizado do portal AnnA One, com azul institucional e roxo de Gestão Escolar.
- Trabalho online; sem baixar ou testar localmente no computador do usuário.
- Login/gestão de identidades exclusivamente pelo portal AnnA One (Neon Auth). Não criar login alternativo.
- Serviços disponíveis: Render, Neon, Cloudflare, Resend; DNS/subdomínios via Registro.br.
- Avançar de maneira objetiva, sem repetir perguntas respondidas, não alterar módulos existentes indevidamente.
- Repositório experimental `elisonborges/anna-classroom` não é mais a origem de deploy.

## Estado verificado
- Render workspace AnnA One: serviço `anna-classroom-api`, id `srv-dbntkqp5efls73cajkjg`, repositório `elisonborges/anna-one`, branch `main`, root `modules/anna-classroom/api/`, Free, autodeploy OFF.
- Backend acessível: `https://anna-classroom-api.onrender.com/health` retornou `{"status":"ok","service":"anna-classroom-api"}` ao usuário.
- `GET /v1/classes` sem token retornou `{"error":"Sessão inválida ou expirada"}`, conforme esperado.
- Neon projeto **anna-one** (`floral-butterfly-25476831`), branch production, banco neondb, schema isolado `anna_classroom`, seis tabelas. Papel restrito `classroom_api_service`; função `anna_classroom.can_manage_institution`.
- Neon Auth (Better Auth) do projeto compartilhado, origem `https://classroom.annaone.com.br` **adicionada à allowlist e confirmada**.
- Frontend está em `modules/anna-classroom/{index.html,styles.css,app.js}`; verificação de sessão e instituição implementada no JS, **ainda não publicada e nem validada**.
- A API foi configurada com variáveis `NODE_ENV`, `FRONTEND_ORIGIN`, `DATABASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `NEON_AUTH_AUDIENCE`. Os valores exatos de claims `iss/aud` **não foram validados** com JWT real. Não imprimir segredos no chat.
- O módulo `turmas-e-alunos` em public.modules está em estado `planned`, e a instituição ainda não possui habilitação para ele: as chamadas autenticadas de dados continuam bloqueadas por padrão.
- O domínio `classroom.annaone.com.br` ainda não possui implantação frontend confirmada nem verificação DNS. Não afirmar que está no ar.

## Próximas ações, na ordem
1. Verificar integração segura de sessão entre subdomínios e validar claims do JWT de forma privada (sem capturar ou expor token em conversas).
2. Implantar o frontend pelo Cloudflare com a pasta existente no repositório principal e configurar o subdomínio respeitando DNS já existente; evitar mudanças indiscriminadas na zona.
3. Testar login com conta institucional já existente, sem criar novo login.
4. Só então habilitar seletivamente o módulo para instituição de validação, implementar operações reais de turmas com autorização de professor e aluno no servidor, e avaliar LGPD.
5. Não criar serviços duplicados nem novos bancos; não repetir testes de saúde já aprovados, salvo se houver alteração pertinente.

## Nota
A primeira versão visual é apenas interface. O funcionamento da sessão e das operações reais exige testes na origem online. As políticas servidoras são a fronteira de segurança, não o JavaScript.

## Atualização de implantação (08/11/2026)
- Frontend publicado no Cloudflare Worker `https://anna-classroom.elisonborg.workers.dev/`, usando `modules/anna-classroom/wrangler.jsonc` e assets de `public/`. Interface no padrão AnnA One; domínio `classroom.annaone.com.br` ainda sem rota porque a zona DNS não aparece na conta Cloudflare. **Não alterar nameservers do Registro.br sem plano.**
- Endereço atual do Worker adicionado à lista de origens confiáveis Neon Auth.
- Portal `app/index.html` ganhou link **Gestão Escolar > Turmas e Alunos > Abrir AnnA Classroom**, mas o cartão continua sujeito ao filtro de autorizações institucionais.
- Render API deploy `dep-dbnu48ijnfac73dd5n4g` confirmado **live**; CORS aceita o domínio atual Workers e o domínio definitivo. Auto-deploy continua OFF.
- Neon checado: `anna_classroom.classes` com **0 registros**, `public.modules` possui `turmas-e-alunos` com status `planned`; `public.institution_modules` tem **0 instituições com esse módulo habilitado**.
- Interface atual: aba Turmas consulta GET `/v1/classes` e `/v1/students` com token e `X-Institution-Id`, exibindo estados 401/403/vazio/erro, **sem criar dados nem burlar autorizações**.
- **PENDENTE REAL:** não há teste confirmado de sessão JWT integrada entre portal e Workers, nem confirmação dos claims iss/aud aceitos pela API. Não afirmar login validado. Antes de liberar uso escolar, validar em conta de instituição, corrigir mecanismo de sessão se necessário e habilitar o módulo seletivamente após autorização do usuário.
- Alterações visuais foram mescladas na main, e últimas mudanças de interface também estão na main; o Cloudflare costuma gerar build automaticamente, mas a implantação final ainda precisa ser confirmada quando necessário.

## Correção do acesso pelo portal (08/11/2026)
- Usuário relatou que login no portal não abre o módulo.
- Diagnóstico: sessão no domínio `annaone.com.br` não é automaticamente reutilizada em `elisonborg.workers.dev` e nenhuma instituição tinha o módulo habilitado.
- Criada página `app/classroom-connect.html` no portal para, com sessão existente, transmitir JWT à janela Classroom exclusivamente por `postMessage` para origem exata `https://anna-classroom.elisonborg.workers.dev`, com nonce aleatório por conexão. Nenhum token em URL ou storage persistente.
- Frontend `modules/anna-classroom/{app.js,public/app.js}`: botão **Conectar conta AnnA One** abre ponte do portal em janela auxiliar, verifica mensagem por origem, fonte e nonce, valida vínculo via endpoint existente, sem criar contas ou exibir dados de usuário.
- No Neon, habilitado `turmas-e-alunos` **somente** para a instituição de testes `COLEGIO TESTE` (UUID `9de1e73a-1227-4f63-b950-364e44f4978e`). Consulta posterior confirmou `enabled=true` e `anna_classroom.can_manage_institution(...)=true` para o membro institucional ativo.
- Infra Render API segue live; as mudanças recentes são frontend/GitHub, dependem do deploy automático do Worker e do deploy do portal. Não alegar validação de ponta a ponta antes do usuário testar no navegador real.
- Se a API apresentar 401 após a conexão do portal, confirmar os valores de `NEON_AUTH_ISSUER` e `NEON_AUTH_AUDIENCE` a partir das claims reais do JWT, sem expor token em chat. Se acesso pelo catálogo do portal seguir oculto, verificar a política do Worker `/v1/institution/me` para módulos planejados.

## Arquitetura confirmada pelo usuário — 08/11/2026 (substitui planos de ponte/popup)
- Master administra liberação de módulos por cliente usando Painel Master existente.
- Cliente autenticado na Central AnnA One visualiza links dos módulos atribuídos e abre os módulos.
- Acesso direto à URL do módulo: tela de login com e-mail/senha **no padrão visual Service Desk**, autenticação no **Neon Auth central** (não usar conta separada do Service Desk), ao validar conta e vínculo institucional abrir módulo diretamente.
- Em 08/11: alteração do `public.modules` para `code=turmas-e-alunos,status=available` foi aplicada para permitir atribuição pelo Master; `COLEGIO TESTE` permanece habilitado e `can_manage_institution` retornou true. **Catálogo do portal atualizado** para mostrar `Turmas e Alunos` como `Disponível · Piloto` quando a API de autorizações o incluir.
- Interface do Classroom adaptada para login direto com Neon Auth e autorização institucional; a ponte experimental `app/classroom-connect.html` foi removida, sem popup nem segundo cadastro. As requisições GET de turmas e alunos ainda passam pelas autorizações do servidor.
- **Pendência:** testar entrada e acesso às turmas no navegador, validar JWT `iss/aud` (Render foi configurado com valores provisórios) e eventualmente ajustar cookies CORS se navegador bloquear cookies entre workers.dev e Neon Auth; não declarar fluxo end-to-end aprovado até teste real.
- Ainda não apontar o link para `classroom.annaone.com.br` pois DNS não foi configurado.

## Correção de fluxo e preservação — 08/11/2026
- Exigência do usuário: **Master atribui módulo ao cliente → Central mostra somente os módulos autorizados → cliente abre módulo; acesso direto usa tela de login padrão e segue ao módulo após validação**. Referências: `app/admin-master-preview.html`, `app/index.html`, `app/login-neon.html`, `service-desk/login.html`. Não criar sistemas independentes de atribuição.
- Validado no Neon via consulta: `COLEGIO TESTE`, módulo `turmas-e-alunos`, `status=available`, `enabled=true`, membro `institution_admin` ativo e `anna_classroom.can_manage_institution = true`.
- **Correção pontual:** `modules/anna-classroom/public/app.js` (e sua cópia `app.js`) agora verifica também `GET /v1/classes` na API **antes de mostrar o ambiente**. Com JWT 401 mostra erro de validação do token; com 403 mostra falta de autorização; se API indisponível não abre módulos. Sem mudanças no backend, banco, Portal Master ou Service Desk nesta etapa.
- Atenção: **não foi possível testar login de ponta a ponta sem navegador autenticado do usuário.** Neon Auth, CORS, `iss/aud` no Render e a atualização Cloudflare precisam ser validados pelo usuário no fluxo real, mas não repetir testes anteriores.
- A conta do portal no domínio `annaone.com.br` e o Classroom em `workers.dev` não compartilham necessariamente a sessão por serem origens diferentes. Módulo possui login direto com as mesmas credenciais centrais; continuidade do SSO em um único login depende da arquitetura de domínio ou mecanismo seguro existente.
