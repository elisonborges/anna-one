# Integração Portal AnnA One ↔ AnnA Flow (fase 1)

Estado: **desenvolvimento, não publicado**. Branch isolada `feature/portal-flow-integracao`.

## Fontes atuais
- Portal: Neon Auth, Neon PostgreSQL; Master autorizado no servidor por `public.platform_admins`.
- Portal: `public.institutions`, `public.modules` (`anna-flow` existente), `public.institution_modules`, `public.memberships`, `public.institution_admin_invitations`.
- Flow: Neon PostgreSQL separado, `public.flow_clients.id` BIGINT. Branch `feature/anna-flow-online` não modificada.

## Implementado na branch
1. Painel Flow no catálogo Master, reaproveitando controles existentes de liberação de módulo e administradores institucionais.
2. Migração proposta `migrations/20261102_flow_institution_links.sql`, **não aplicada** ao banco.
3. Worker com `GET /v1/admin/flow-links/:institution_id` protegido por JWT e `platform_admins`.
4. `PUT /v1/admin/flow-links/:institution_id` implementado na branch: consulta privada ao Neon Flow usando `FLOW_DATABASE_URL` no Worker, verifica existência, ativo e nome equivalente ao Portal; impede duplicidade e reatribuição. Sem secret retorna 503. Ainda não implantado nem validado em produção.

## Pendências para próxima fase
1. Configurar `FLOW_DATABASE_URL` como Secret exclusivo do Worker (conexão Neon Flow com privilégios mínimos de SELECT em `flow_clients`). Não copiar a URL para o navegador ou GitHub.
2. Validar vínculo com dados de homologação; a comparação de nomes exige correspondência normalizada, sem tolerar nomes distintos. Registrar trilha de auditoria dedicada antes da produção.
3. Aplicar migração aprovada no Neon Portal, após backup e inspeção.
4. Adicionar ao backend Flow verificação efetiva de habilitação do módulo, status institucional, vínculo de administrador e revogação em requisições e sessões.
5. Testar matriz/filial, administrador com múltiplos vínculos, suspensão, troca de responsável, tentativa de acesso cruzado, sessão antiga e falha de sincronização.
6. Só publicar com autorização expressa.

## Regra de segurança
**Não usar o estado visual do Portal como prova de autorização no Flow.** Sem enforcement no backend do Flow, não declarar bloqueio de acesso operacional funcional.

## Observações de arquitetura
- O login Master legado do Flow (`central-auth.js`) ainda referencia Supabase; não é fonte de autorização para esta integração. A conversa do Flow deve retirar a guia Administração Central do login público e implementar checagem de autorização institucional no servidor.
- O Worker da branch de integração foi copiado da branch `feature/auditoria-integracao-v090` porque `worker-auditoria/src/index.js` não existia em `main`. Antes de merge, reconciliar divergências de branch e confirmar deploy.
- Sem `FLOW_DATABASE_URL`, migração aprovada e checagens do backend Flow, a integração não pode ser considerada operacional.
