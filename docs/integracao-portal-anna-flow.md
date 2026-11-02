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
4. `PUT /v1/admin/flow-links/:institution_id` propositalmente retorna 503: ainda não há verificação servidor-servidor de existência e correspondência de cliente Flow. Não cria associações inseguras.

## Pendências para próxima fase
1. Definir mecanismo de validação servidor-servidor (credencial privada somente no backend; idealmente serviço do Flow que resolva cliente por identificador externo e audite criação).
2. Validar/registrar vínculo transacional e prevenir reatribuição acidental; exigir confirmação e trilha de auditoria.
3. Aplicar migração aprovada no Neon Portal, após backup e inspeção.
4. Adicionar ao backend Flow verificação efetiva de habilitação do módulo, status institucional, vínculo de administrador e revogação em requisições e sessões.
5. Testar matriz/filial, administrador com múltiplos vínculos, suspensão, troca de responsável, tentativa de acesso cruzado, sessão antiga e falha de sincronização.
6. Só publicar com autorização expressa.

## Regra de segurança
**Não usar o estado visual do Portal como prova de autorização no Flow.** Sem enforcement no backend do Flow, não declarar bloqueio de acesso operacional funcional.
