# AnnA Classroom — API institucional v0.1
Preparada em 2026-11-07; **não implantada, não testada ponta a ponta**.

## Infraestrutura
- Código: `api/server.js` (Node.js >=20; pg e jose).
- Hospedagem sugerida: Render, serviço próprio, deploy automático desligado, plano gratuito sujeito à disponibilidade.
- PostgreSQL: projeto Neon existente `anna-one`, schema isolado `anna_classroom`.
- Autenticação: mesmo Neon Auth do portal; o backend **não oferece login, senha ou cadastro de usuários**.
- Domínio desejado frontend: `classroom.annaone.com.br`, ainda não configurado.
- DNS, Render e Cloudflare: nenhuma alteração realizada nesta etapa.

## Configurar no Render (sem colocar segredos no GitHub)
Definir `DATABASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `NEON_AUTH_AUDIENCE` e `FRONTEND_ORIGIN`. Consultar os valores reais da integração Neon Auth antes da implantação. Em `api`, executar `npm install` e `npm start`. Não usar credenciais de banco no frontend.

O caminho JWKS deve ser confirmado com a configuração **real** do Neon Auth. Validar o `iss`, `aud` e `sub` reais de um token de teste, sem registrar nem publicar o token. O código rejeita tokens inválidos.

## Rotas
- `GET /health`: apenas estado do processo, sem dados sensíveis.
- `GET /v1/classes`: lista até 100 turmas da instituição.
- `POST /v1/classes`: cria turma, JSON `{"name":"Turma Exemplo","school_year":2026}`.
- `GET /v1/students`: lista até 100 alunos da instituição.
- `POST /v1/students`: cria aluno, JSON `{"display_name":"Aluno Exemplo"}`.

As rotas protegidas exigem `Authorization: Bearer <JWT>` e `X-Institution-Id: <UUID>`. O servidor confere assinatura/validade do JWT e valida no próprio PostgreSQL: usuário, vínculo ativo, instituição ativa, função `institution_admin` e habilitação do módulo `turmas-e-alunos` para essa instituição. O módulo está hoje marcado como `planned` e **não foi habilitado**. Nenhum dado real deve ser inserido até validar o circuito de segurança.

## Limites e próximos pontos
- Confirmar correspondência do claim `sub` com `public.memberships.user_id` no ambiente atual. Falha resulta em acesso negado.
- Confirmar se a sessão Neon Auth pode ser recuperada pelo frontend no subdomínio; autenticação visual ainda não foi validada entre origens.
- A rota de permissão usa `public.modules.code='turmas-e-alunos'`, código existente no banco; decisão de associá-la ao Classroom deve ser revista antes da ativação.
- Implementar perfis específicos de professor/aluno antes de liberá-los. Não equiparar usuário cadastrado a professor autorizado.
- Implementar controle de abuso/rate limit, auditoria, políticas de retenção, validação de dados pessoais e uma estratégia de paginação antes de uso público.
- Não abrir a URL da API para testes com dados escolares ou configurar produção antes de aprovação da segurança. Sem envio de e-mails nesta versão.

Referência: documentação Neon Functions sobre validação de JWT por JWKS, e Better Auth JWT plugin sobre token verificável separado do cookie de sessão.

## Auditoria de integração em 2026-11-07
- Neon Auth do projeto existente confirmado como **Better Auth**, endpoint JWKS obtido da configuração oficial Neon. O valor público de JWKS está no `render.yaml`.
- Origens atualmente confiáveis: `https://annaone.com.br`, `https://elisonborges.github.io`, `https://recepcao.annaone.com.br` e `https://flow.annaone.com.br`. O domínio Classroom **ainda não está autorizado**. Não foi alterada a lista.
- O token JWT verificável por JWKS é diferente do cookie de sessão. Antes da ativação é necessário testar o endpoint `/token` e confirmar os claims `iss` e `aud` reais; `NEON_AUTH_ISSUER` e `NEON_AUTH_AUDIENCE` intencionalmente não foram presumidos.
- O `render.yaml` configura Render com `autoDeployTrigger: off`, serviço gratuito proposto, `DATABASE_URL` solicitado como segredo e sem domínio customizado. O Blueprint **não foi importado nem implantado**.
- A implementação atual da sessão no frontend pode falhar entre origens; o bloqueio é intencional. Não contornar CORS, não assumir que cookies do portal sejam compartilhados.
- Validar custos/cotas e a autorização efetiva do módulo antes de criar serviço no Render ou adicionar domínio confiável.

## Implantação tentada em 2026-11-07 — impedimento externo
- Tentada criação do web service `anna-classroom-api` na workspace Render AnnA One, plano `free`, branch `main`, `autoDeploy=no`, sem chaves no GitHub.
- Render recusou a criação com HTTP 400: `repository URL is invalid or unfetchable` ao tentar buscar `https://github.com/elisonborges/anna-classroom`.
- O repositório **é privado** e existe no GitHub. Autorizar o acesso do GitHub App do Render ao repositório é pré-requisito. Não tornar público para contornar.
- **Nenhum serviço novo foi criado no Render** nesta tentativa, nenhuma URL publicada.
- Papel PostgreSQL `classroom_api_service` criado no Neon com escrita apenas no schema `anna_classroom`. A autorização institucional é feita por `anna_classroom.can_manage_institution(uuid,uuid)`, `SECURITY DEFINER`, com `EXECUTE` concedido ao papel e sem acesso direto às tabelas institucionais protegidas por RLS.
- A função foi testada com IDs inexistentes e retornou `false`; testes de autenticação reais e validação do deploy continuam pendentes. O módulo `turmas-e-alunos` permanece desabilitado para instituições.
- Uma vez autorizado o repositório no Render, repetir a criação do serviço, validar logs e `GET /health`, testar negativa 401/403 e, finalmente, liberar somente a instituição de teste com aprovação.
