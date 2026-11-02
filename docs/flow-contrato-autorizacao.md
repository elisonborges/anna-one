# Contrato de autorização do AnnA Flow — integração do Portal

## Preparado e aplicado
- Tabela `public.flow_institution_links` criada no Neon do Portal em 2026-11-02, verificada por consulta ao catálogo; nenhum registro de cliente criado.
- Código do Worker na branch `feature/portal-flow-integracao`, não implantado.
- `GET /v1/admin/flow-links/:institution_id`: consulta Master.
- `PUT /v1/admin/flow-links/:institution_id`: valida cliente no Neon Flow por conexão privada `FLOW_DATABASE_URL`, compara nome normalizado e estado ativo, impede reatribuição.
- `POST /v1/internal/flow/access`: autorização máquina-a-máquina, exige cabeçalho `X-Flow-Service-Token` com segredo privado `FLOW_SERVICE_TOKEN`. Corpo JSON: `{"flow_client_id":123}`. Resposta: `{"authorized":true,"institution_id":"uuid"}` ou `{"authorized":false,"institution_id":null}`. Erro de infraestrutura retorna HTTP 503 e deve negar acesso.

## Para o backend Flow (conversa específica)
1. Configurar `FLOW_PORTAL_AUTH_URL` e `FLOW_SERVICE_TOKEN` **somente no servidor** do Flow; no Worker Portal, mesmo token em Secret `FLOW_SERVICE_TOKEN`. Nunca incluir em HTML/JS cliente.
2. Consultar autorização em cada login institucional, operação protegida, emissão/chamada por dispositivos e renovação de sessão, ou implementar cache de curtíssima duração com invalidação imediata. **Fail closed** se indisponível.
3. Exigir autenticação individual e vínculo de usuário no banco Flow; a resposta institucional do Portal **não** concede papel de administrador nem autoriza um funcionário.
4. Revogar sessões quando bloqueado; revalidar acesso a cada operação para cobrir sessões antigas.
5. Desativar o login público de Administração Central baseado no Supabase antigo, após validação do substituto.
6. Para habilitação de administrador institucional, vincular identidade autorizada pelo Portal a conta Flow, sem compartilhar senha nem supor igualdade de IDs.
7. Implementar rate limit e auditoria no endpoint interno e configurar privilégios mínimos de banco.

## Bloqueadores para ativação
- Secret `FLOW_DATABASE_URL` no Worker (ideal: credencial Neon Flow somente leitura para `flow_clients`).
- Secret `FLOW_SERVICE_TOKEN` no Worker e no servidor Flow.
- Implantação coordenada do Worker, após conciliar sua branch de origem `feature/auditoria-integracao-v090` com a branch do Portal.
- Backend Flow ainda não consulta o endpoint; **não afirmar que o bloqueio operacional funciona**.
- Não há instituições ou clientes nas tabelas consultadas, portanto teste real de vínculo depende de cadastros de homologação autorizados.
- Nenhuma publicação sem autorização expressa.
