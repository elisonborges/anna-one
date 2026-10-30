# Validação Neon Auth — Auditoria v0.9.0

## Conclusão documental (28/10/2026)
- A página atual usa `@neondatabase/auth@0.5.0-beta` e `getSession().data.session.token`.
- Segundo documentação Neon, `session.token` é identificador de sessão opaco, **não** JWT.
- Para API protegida é necessário obter o JWT próprio do Neon Auth (método `token()` ou `getJWTToken()`, após confirmar a assinatura da versão 0.5.0-beta em uso).
- Neon Managed Auth usa assinatura EdDSA e JWKS; o exemplo anterior com RS256 foi substituído por verificação Ed25519.
- `AUTH_ISSUER`, `AUTH_AUDIENCE` e `AUTH_JWKS_URL` são obrigatórios e devem ser confirmados no projeto real. Não presumir valores.

## Estado real
- `src/auth.js`: verificador JWT EdDSA preparado; **não conectado às rotas**.
- `src/index.js`: `/v1/admin/*` e `/v1/audit/*` respondem HTTP 503.
- Não foram validados token real, issuer, audience, JWKS, integração SQL, permissões, implantação ou teste end-to-end.
- Nenhuma gravação administrativa foi habilitada.

## Próximo teste de integração (ambiente isolado)
1. Confirmar token JWT real pelo SDK usado no navegador, sem registrar o token em logs.
2. Verificar assinatura, `iss`, `aud`, `sub` e expiração contra configuração real.
3. Testar token ausente, opaco, expirado, assinatura incorreta e usuário sem permissão.
4. Implementar consulta `platform_admins` no servidor com role de serviço restrita.
5. Somente então implementar transação de mutação + auditoria e teste de rollback.
6. Aprovar implantação e publicar após teste.

Fontes:
- https://github.com/neondatabase/neon-js/blob/main/CLAUDE.md
- https://github.com/neondatabase/website/blob/main/content/docs/compute/functions/authentication.md
