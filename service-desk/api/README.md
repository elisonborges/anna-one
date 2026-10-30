# AnnA Service Desk — API de leitura (fase de testes)

Requer Node.js 20+. A API é um backend **não implantado**; o portal público não foi conectado.

## Rotas

- `GET /health`: diagnóstico básico. `database=reachable` significa somente `SELECT 1`; **não** prova segurança nem migrações. `auth=configured-not-verified` indica apenas variáveis presentes.
- `GET /api/v1/tickets`: exige `Authorization: Bearer <JWT>`. Lista até 50 chamados visíveis ao solicitante pelas políticas RLS do PostgreSQL. Sem token válido, HTTP 401; erro de conexão ou permissões, HTTP 503.

## Configuração de teste (servidor apenas)

```sh
cd service-desk/api
npm install
npm test
# Definir as variáveis em um gerenciador de segredos seguro:
# DATABASE_URL, SD_JWT_SECRET, SD_JWT_ISSUER, SD_JWT_AUDIENCE
npm start
```

A variável `SD_JWT_SECRET` deve ter pelo menos 32 bytes aleatórios e ser conhecida **somente** pelo emissor confiável de tokens e pela API. `SD_JWT_ISSUER` e `SD_JWT_AUDIENCE` devem coincidir com os campos `iss` e `aud` dos JWT HS256 emitidos. O token deve conter `sub` UUID, `iat` e `exp` (no máximo 1 hora à frente). **Não usar segredo de testes em produção.** O Service Desk usa exclusivamente autenticação local no Neon, com emissão de JWT pelo backend.

A conexão `DATABASE_URL` precisa pertencer a um usuário de banco **não administrador**: sem `BYPASSRLS`, `CREATEROLE` ou `SUPERUSER`; com autorização explícita de `SET ROLE anna_sd_api_runtime`. O papel `anna_sd_api_runtime` tem somente leitura restrita em `anna_sd.tickets` e `anna_sd.memberships`. A API recusa conexões privilegiadas antes de consultar dados. O banco nunca pode ser acessível diretamente pelo navegador. Não salvar senhas ou tokens no GitHub.

**Atenção:** as políticas de leitura usam `anna_sd.actor_id` de sessão, definida pela API após verificar o JWT. A conexão de banco deve ficar sob controle exclusivo do backend. A API não oferece criação de chamados nem upload de anexos.

## Testes e implantação

```sh
npm test
node --check server.cjs
node --check auth.cjs
node --check tickets.cjs
```

O workflow `.github/workflows/service-desk-api.yml` executa os testes a cada alteração na pasta da API. Para liberar implantação, faltam: credencial de login restrita e auditada, integração com provedor de identidade, teste HTTP real com Neon, revisão de dependências/lockfile, proteção operacional (rate limit, logs e TLS reverso) e homologação.

**Não usar `neondb_owner` como conexão de aplicação. Não publicar o backend ou integrar o portal sem aprovação.**

## Login independente no Neon (fase de testes)

`POST /api/v1/auth/login` recebe JSON `{"email":"usuario@exemplo.org","password":"senha"}`. Valida as credenciais em `anna_sd.local_credentials` usando o papel `anna_sd_identity_runtime` e devolve um JWT de 15 minutos. Cinco tentativas inválidas bloqueiam a conta por 15 minutos. A rota de leitura `GET /api/v1/tickets` usa esse token e o papel separado `anna_sd_api_runtime`.

Migrações 007 e 008 foram aplicadas somente no Neon isolado. O papel de identidade é `NOLOGIN` e não pode acessar o banco diretamente. A conta de conexão da API deverá ser uma conta LOGIN **não privilegiada**, autorizada explicitamente a `SET ROLE` nos dois papéis restritos, com senha armazenada fora do repositório. Nenhuma conta real de usuário foi cadastrada. Cadastro público não foi habilitado; o provisionamento inicial deve ser administrativo e auditado. Não implantar sem HTTPS, limitação de requisições por IP e por conta, proteção contra abuso, auditoria e recuperação segura de senha.

**Estado:** código da rota e testes criados; conexão HTTP real com credencial restrita, implantação e testes de ponta a ponta ainda pendentes. O Supabase não participa do fluxo; arquivos legados `supabase-auth.cjs` não são importados pelo servidor.

## Hospedagem proposta — Render Free + GitHub Pages + Neon

O arquivo `render.yaml` é um Blueprint para criar o serviço Node no Render. **Ainda não foi implantado.** O arquivo está em `service-desk/api/render.yaml`; se o Render solicitar o caminho do Blueprint, informe esse caminho explicitamente. Para serviço Web manual: repositório `elisonborges/anna-one`, Root Directory `service-desk/api`, Build Command `npm install`, Start Command `npm start`, Health Check Path `/health`, plano Free. Não colocar `DATABASE_URL` em arquivo versionado; inserir como Secret Environment Variable na interface do Render. A URL precisa usar `anna_sd_app_login` e TLS. `SD_JWT_SECRET` deve ser aleatório, com >=32 bytes; configurar `SD_JWT_ISSUER=anna-service-desk`, `SD_JWT_AUDIENCE=anna-service-desk-api` e `HOST=0.0.0.0`.

**Antes de publicar:** executar os testes, conferir RLS, implementar limite de requisições por IP, provisionar conta de teste e homologar login real. Não alterar a página pública até o backend estar validado. O Render pode mudar planos e condições de gratuidade; confirmar no painel antes de criar.
