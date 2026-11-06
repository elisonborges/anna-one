# Correção do login institucional AnnA Flow — 2026-11-05

## Causa confirmada
O Portal AnnA One usa Neon Auth + banco Neon `anna-one`, enquanto a consulta antiga do Flow verificava `flow_users` no banco `anna-flow-dev` ou Supabase legado. Um convite institucional já aceito no Portal não cria automaticamente um usuário no banco Flow.

## Correção implementada (branches de desenvolvimento)
- Portal: `feature/portal-flow-integracao`, `worker-auditoria/src/index.js`: nova rota autenticada `GET /v1/institution/flow-access` verifica JWT Neon Auth, membro ativo `institution_admin`, instituição ativa, habilitação de `anna-flow` e restrições de matriz/filial. Resposta: `user_id`, `user_email` conferidos no servidor e instituições com `flow_client_id`.
- Flow: `feature/anna-flow-online`, `flow-login.js`: login Neon Auth no navegador e encaminhamento do JWT ao servidor Flow; não envia a senha ao Flow.
- Flow: `portal-institution-auth.js`: consulta Worker via Bearer JWT; exige vínculo Portal/Flow existente, cria somente conta operacional interna associada ao `user_id` validado, usa e-mail devolvido pelo servidor e cria sessão Flow de 1 hora. Conta já existente com mesmo e-mail exige conciliação, sem tomada automática.
- Flow: `flow-login.html`: script módulo para Neon Auth.
- Neon Auth do projeto `anna-one`: `https://flow.annaone.com.br` adicionado aos domínios confiáveis.
- Neon `anna-one`: vínculo `flow_institution_links` de `COLEGIO TESTE` para cliente Flow ID 1.
- Neon `anna-flow-dev`: cliente ID 1 `COLEGIO TESTE` e vínculo `flow_portal_institution_links` correspondente.

## Pendente antes de considerar concluído em produção
1. A nova rota Worker não foi publicada; confirmar que o Worker de implantação usa a branch/arquivo correspondente. Revisar build geral do Worker: a sintaxe do bloco novo foi validada isoladamente, mas o arquivo completo não passou pelo parser disponível neste ambiente.
2. Publicar Worker e Flow de maneira coordenada, somente após autorização expressa do responsável; confirmar disponibilidade da rota HTTPS.
3. Testar com credenciais reais do administrador: identificação da instituição, login, abertura do painel, cadastro de funcionário, logout, revogação de acesso e tentativa de acesso a outro cliente.
4. Implementar revalidação do vínculo e da habilitação do módulo durante sessão e operações sensíveis (revogação imediata). A validação atual ocorre no login e a sessão local vence em 1 hora.
5. Não reemitir convite nem migrar senha; o usuário do Portal já está autenticado pelo Neon Auth.

Nenhuma licença foi criada ou bloqueio de licença ativado. Não alterar `main` nem publicar sem autorização.
