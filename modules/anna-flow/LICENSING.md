# AnnA Flow — Licenciamento no servidor (fase 1)

## Situação
Implementado na branch `feature/anna-flow-online`, **não publicado**. O controle de licenças é informativo nesta etapa: `enforcementEnabled: false`. Nenhum cliente existente é bloqueado. **Ainda não há licença cadastrada**.

## Modelo
Uma licença por `flow_clients.id` (chave exclusiva), com `UUID` de licença próprio. O vínculo com o cadastro da instituição no Portal AnnA One deverá ser explícito (não inferir igualdade entre IDs do Supabase e Neon).

A tabela `flow_licenses` armazena:
- `client_id`, `status`: `draft`, `active`, `suspended` ou `revoked`;
- `plan`, `starts_at`, `expires_at` (nulo permite licença sem vencimento);
- `offline_grace_hours` (padrão 72; máximo 720);
- `max_units`, `max_devices`, `max_users` (nulo significa sem limite definido);
- `revision`, `created_at`, `updated_at`.

## API
`GET /api/license?client=ID`: Master validado pela sessão central consulta qualquer instituição; administrador institucional autenticado consulta apenas seu próprio `client_id`, sem poder consultar outro. Sem licença: `state: unconfigured, licensed: false`.

`PUT /api/license`: permitido exclusivamente à sessão administrativa central autenticada (que verifica Master pela infraestrutura atual). Requer payload JSON completo: `{clientId,status,plan,startsAt,expiresAt,offlineGraceHours,maxUnits,maxDevices,maxUsers}`. Datas em ISO 8601. Os limites opcionais devem ser enviados como `null` ou números positivos. A operação registra auditoria e incrementa a revisão. Não expor um segredo administrativo no navegador.

## A desenvolver em seguida
1. O Portal AnnA One deve usar um backend autorizado para cadastro, vínculo explícito e gestão de licenças (a API do Flow ainda não é acessível com credenciais Supabase diretamente de outro domínio).
2. Aplicar os limites e bloqueios no servidor somente após implantação controlada, licenças provisionadas e testes com clientes.
3. Adicionar leases offline assinados, ligados ao dispositivo e cliente, com período máximo de tolerância e sincronização protegida; não confiar no relógio local.
4. Empacotar o executável quando a operação local estiver funcional.

## Verificações
- Sintaxe de `license-api.js` e `server.js`: OK.
- Casos puros de status: sem licença, ativa, expirada, suspensa e agendada: OK.
- Consulta ao Neon: 0 licenças cadastradas.
- Não executar testes de criação de licenças em dados reais sem autorização.
