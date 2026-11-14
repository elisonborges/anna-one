# AnnA TeamHub — MVP 0.1 (implementação em branch isolada)

Plataforma mobile-first, em português, identidade visual AnnA One (azul-marinho/azul), tema claro/escuro. O login é o Neon Auth do portal — **sem senha própria**. Backend com verificação de JWT por JWKS e autorização no PostgreSQL. Projetos e Kanban persistem no banco.

## Estado e segurança
Esta branch NÃO está publicada em produção. Nenhum banco foi alterado. Não inserir segredos no GitHub ou no frontend. O serviço só inicia com variáveis obrigatórias.

## Ambiente
Node 20+.
- DATABASE_URL: conexão PostgreSQL de banco **isolado**, com TLS.
- AUTH_JWKS_URL: URL JWKS oficial do emissor Neon Auth do portal (validar na documentação/configuração antes de usar).
- AUTH_ISSUER: valor `iss` esperado dos tokens verificados.
- AUTH_AUDIENCE: destinatário autorizado do token.
- PORT: porta HTTP (padrão 3000).
- PORTAL_LOGIN_URL: URL do login central (opcional).
- CORS_ORIGIN: origem aprovada da aplicação (quando API separada; preferir mesma origem).

## Execução futura
1. Confirmar contrato real dos JWTs de Neon Auth (iss, aud, jwks).
2. Criar banco de desenvolvimento isolado; executar schema.sql nele.
3. Provisionar organização e um membership admin com auth_subject **validado**, jamais pelo e-mail como identificador de autorização.
4. Configurar segredos no serviço de hospedagem; iniciar `npm install && npm start`.
5. Validar sessões, autorização, tarefas e celulares antes de aprovar implantação.

## Limites da v0.1
Sem convites, anexos, colaboração em tempo real, PWA offline ou alterações do Portal AnnA One. O acesso pelo mesmo login exige validação do compartilhamento de sessão no endereço escolhido.
