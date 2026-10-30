# AnnA One — Auditoria v0.9.0 · Integração (preparação)

Estado: **preparado para implementação, não implantado**.

## Situação verificada
- O Neon possui `anna_audit.audit_logs` em esquema privado, com RLS e acesso público revogado.
- A interface `app/admin-geral-preview.html` usa Neon Auth e Neon Data API diretamente do navegador.
- Não foi localizado backend próprio no repositório nas buscas por `api`, `package.json` ou `DATABASE_URL`.
- **Não** conectar o navegador diretamente ao esquema de auditoria, nem expor credenciais do Neon.

## Contrato da integração futura
Operações administrativas mutáveis deverão passar por endpoint autenticado no servidor:
1. Validar sessão **no servidor**, usando mecanismo oficial do Neon Auth.
2. Consultar `public.platform_admins` para autorização; conferir permissões por ação e instituição.
3. Validar entrada, evitar alterações fora do escopo e executar a alteração e o registro de auditoria **na mesma transação SQL**.
4. Gravar `actor_user_id` obtido da sessão validada (nunca do corpo da requisição), `action`, `entity_type`, `entity_id`, `institution_id`, `details` e `request_id`.
5. Evitar guardar tokens, senhas, e-mails sensíveis, dados pessoais desnecessários ou segredos em `details`.
6. Responder com sucesso apenas após commit. Se falhar a gravação de auditoria, reverter a alteração administrativa.
7. Implementar consulta paginada do histórico apenas no servidor, após autorização, com filtros de data, ação e instituição.
8. Garantir privilégios SQL mínimos ao papel de serviço; **não** usar credenciais de proprietário no frontend.
9. Verificar política de retenção, proteção contra exclusão/edição de logs e operação de backup antes da implantação.

## Ações sugeridas para o primeiro ciclo
- `institution.status.updated`
- `membership.role.updated`
- `membership.active.updated`
- `institution_module.enabled.updated`

## Pendente para ativação
- Escolher/verificar ambiente de backend e implantação.
- Implementar e testar autenticação do servidor.
- Testar atomicidade (alteração + log), negação de acesso e tratamento de erros.
- Só então conectar a seção Auditoria da interface a um endpoint de leitura.

Nenhuma mudança em produção é efetuada por este documento.
