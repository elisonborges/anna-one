# AnnA One — Worker de Auditoria v0.9.0

**Preparação técnica, sem implantação.** O Worker tem somente `GET /health` (estado `preparacao`) e bloqueia todas as operações administrativas e de auditoria (HTTP 503). Nenhum acesso ao banco foi implementado.

## Por que iniciar bloqueado?
A interface atual utiliza Neon Auth no navegador. Não é seguro confiar em `user_id` enviado pelo cliente nem reutilizar token sem validar assinatura, expiração, emissor e audiência no servidor. Também é necessário confirmar o mecanismo oficial de verificação de sessão da versão de Neon Auth em uso.

## Etapas antes de habilitar
1. Confirmar domínio do Worker e implantação na conta Cloudflare.
2. Implementar verificação de token Neon Auth **no servidor** e rejeitar sessões inválidas.
3. Verificar administrador em `platform_admins` via conexão SQL segura, com credencial restrita guardada em secrets do Worker.
4. Aplicar política de origem e autorização por rota. CORS **não** substitui autenticação.
5. Criar operação administrativa com transação atômica (mudança + log), testando rollback.
6. Implementar leitura paginada e filtros; nunca expor esquema privado via Neon Data API.
7. Testar falhas, permissões, privacidade, retenção e limites antes da implantação.

## Configuração
`wrangler.toml` não contém credenciais. Não adicionar `DATABASE_URL`, tokens ou segredos ao GitHub. Usar Cloudflare secrets somente quando houver backend aprovado.

## Segurança
- Rotas sensíveis retornam 503 por padrão.
- Nenhuma mudança no frontend, banco ou domínio de produção.
- O arquivo SQL em `docs/sql/` é **exemplo**, não migração validada; requer adaptação ao esquema real e autorização antes de executar.
