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

A variável `SD_JWT_SECRET` deve ter pelo menos 32 bytes aleatórios e ser conhecida **somente** pelo emissor confiável de tokens e pela API. `SD_JWT_ISSUER` e `SD_JWT_AUDIENCE` devem coincidir com os campos `iss` e `aud` dos JWT HS256 emitidos. O token deve conter `sub` UUID, `iat` e `exp` (no máximo 1 hora à frente). **Não usar segredo de testes em produção.** Este verificador ainda não está integrado a um provedor real de identidade; não presumir compatibilidade automática com Supabase Auth/JWKS.

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
