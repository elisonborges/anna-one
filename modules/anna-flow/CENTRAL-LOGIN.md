# AnnA Flow — autenticação da Administração Central

Estado: implementado na branch feature/anna-flow-online, **não publicado** e sem conta central inicial.

## Mudança
- A tela central agora pede e-mail e senha, não o token técnico.
- Login: POST /api/central/login, autenticação individual em flow_central_admins.
- Sessões: flow_central_sessions, cookie HttpOnly, Secure, SameSite=Strict, validade de 8 horas, revogável.
- APIs administrativas verificam a sessão central no servidor.
- Administração institucional continua isolada por cliente.

## Primeiro administrador
A tabela central inicia vazia por segurança. É necessário provisionar o primeiro administrador **uma única vez**, por chamada privada a POST /api/central/bootstrap, autenticada com o FLOW_ADMIN_TOKEN já mantido no servidor. Corpo: JSON com email e password (mínimo 14 caracteres). O endpoint recusa novos cadastros após a primeira conta (409). Nunca enviar credenciais pelo chat, nem incorporá-las ao repositório.

Recomendação: fazer essa operação de máquina administrativa confiável, com credenciais fornecidas pelo responsável diretamente ao serviço por canal HTTPS; armazenar a senha em gerenciador seguro. Após o primeiro cadastro, o token técnico deixa de ser usado na tela, mas permanece no servidor exclusivamente para a verificação de bootstrap e configuração existente. Para criar administradores adicionais, será necessário fluxo administrativo próprio; não usar SQL manual improvisado.

## Verificações feitas
- Sintaxe JavaScript de 8 arquivos: OK.
- Tabelas flow_central_admins e flow_central_sessions: criadas; sem registros.
- Login real ainda não pode ser validado, pois não há conta cadastrada.
- Não publicar até provisionar a conta e realizar teste integrado de login, autorização e logout.
