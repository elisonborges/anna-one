# Configuração de identidade Neon Auth no Worker

**Não ativar mutações nesta fase.** A rota `/v1/auth/verify` valida apenas identidade; não concede privilégio administrativo.

## Configuração de ambiente
Na Cloudflare, Worker `anna-one-auditoria` → Settings → Variables and Secrets, configurar:
- `AUTH_ISSUER`: origem exata do Neon Auth (confirmar no JWT real; sem suposição).
- `AUTH_JWKS_URL`: endereço JWKS fornecido pelo Neon Auth no projeto.
- `AUTH_AUDIENCE`: configurar **somente se** o JWT real declarar `aud` exigida pelo projeto.
- `APP_ORIGIN`: `https://annaone.com.br`.

Os endereços do Neon Auth devem ser obtidos do painel/documentação do projeto e conferidos com o JWT real; não copiar valores de exemplos sem validação.

## Implantação
O código contém módulos separados (`src/index.js` importa `src/auth.js`). **Não basta colar index.js no editor web**; o deployment deve empacotar ambos com Wrangler, via GitHub/CI ou CLI. `wrangler.toml` define `main = "src/index.js"`.

## Teste inicial
1. `GET /health` → 200 e `audit_enabled: false`.
2. `GET /v1/auth/verify` sem token → 401.
3. Com JWT legítimo emitido pelo Neon Auth → 200 `authenticated: true`; **não** implica autorização.
4. `GET /v1/audit` → 503 mesmo autenticado.
5. Tokens inválidos, opacos e expirados → 401.

## Integração futura
Verificar `platform_admins` no Neon via backend com credenciais restritas; implementar transação de escrita + log e leitura paginada. Nenhuma credencial deve entrar no GitHub.

Fontes oficiais:
- https://github.com/neondatabase/website/blob/main/content/docs/compute/functions/authentication.md
- https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
