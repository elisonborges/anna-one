# Integração recuperada do Worker de homologação — NÃO PUBLICADA

Fonte: arquivo compilado do Worker `anna-one-auditoria-homolog` fornecido na conversa (marcadores `// src/auth.js` e `// src/index.js`). O código-fonte original modular não foi encontrado no repositório. Este documento registra um **patch de integração exato**, sem substituir o roteador existente ou suas rotas administrativas.

## Estrutura recuperada

O bundle define `verifyBearer(request, env)`, `json(data,status,headers)`, `ys(env.DATABASE_URL)` (cliente Neon) e `index_default.fetch(request,env)`. A função `fetch` calcula CORS, atende `OPTIONS`, e depois processa rotas como `/v1/institution/me` e `/v1/admin/authorize`.

## Patch do código-fonte original src/index.js

**1. Importar o handler isolado** (ajustar caminho relativo ao local real do arquivo):

```js
import { authorizeEduPlay } from "../integrations/eduplay/authorize.js";
```

**2. Substituir a política CORS de origem única**, preservando a origem atual e autorizando somente o EduPlay:

```js
const origin = request.headers.get("Origin");
const allowedOrigins = new Set([
  env.APP_ORIGIN || "https://annaone.com.br",
  "https://eduplay.annaone.com.br"
]);
const originAllowed = allowedOrigins.has(origin);
const cors = originAllowed ? {
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "vary": "Origin"
} : {};
if (request.method === "OPTIONS") {
  return originAllowed ? new Response(null, {status:204,headers:cors})
    : json({error:"Origem não permitida"},403);
}
```

**3. Inserir antes das rotas administrativas**, após a verificação de saúde:

```js
if (url.pathname === "/v1/eduplay/authorize" && request.method === "GET") {
  return authorizeEduPlay(request, env, {
    verifyBearer,
    sql: neon,
    json,
    cors
  });
}
```

O exemplo presume que o arquivo-fonte importa `neon` de `@neondatabase/serverless`; no bundle, essa função foi renomeada para `ys`. Adaptar ao import real. O handler instancia `neon(env.DATABASE_URL)` e usa SQL parametrizado.

## Testes obrigatórios em homologação

- GET sem token -> 401; token inválido -> 401.
- Token Master válido -> 200 `role:master`.
- Token professor com membership `teacher`, `active=true` e instituição `active` -> 200 `role:teacher`.
- Vínculo inativo ou instituição suspensa -> 403.
- Outras funções institucionais -> 403.
- CORS de `https://eduplay.annaone.com.br` deve responder com a origem exata; origens estranhas -> 403 no preflight.
- Rotas anteriores de administração e instituição devem manter comportamento.

## Pendências críticas

1. Recuperar o repositório/pasta de origem do deploy automático Cloudflare antes de aplicar o patch. Não substituir o bundle com um roteador incompleto.
2. Confirmar que `verifyBearer` entrega `claims.sub` com o mesmo UUID de `public.app_users.id` (a chave de memberships e platform_admins). O Worker existente já utiliza essa correspondência.
3. Validar o fluxo de sessão entre `annaone.com.br` e `eduplay.annaone.com.br`; a autenticação no domínio raiz não garante compartilhamento de localStorage.
4. O GameLab permanece estático: proteção de dados requer API autenticada para CRUD e não somente ocultação da página.

**Estado:** patch e handler versionados em branch; não conectados ao Worker hospedado e não testados. Nenhum deploy realizado.
