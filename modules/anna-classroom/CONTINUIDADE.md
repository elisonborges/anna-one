# AnnA Classroom — ponto de continuidade
Atualização: 07/11/2026 (horário do usuário, America/Fortaleza)

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
