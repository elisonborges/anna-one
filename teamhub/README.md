# AnnA Nexus — MVP 0.1 (implementação em branch isolada)

Plataforma mobile-first, em português, identidade visual AnnA One (azul-marinho/azul), tema claro/escuro. O login é o Neon Auth do portal — **sem senha própria**. Backend com verificação de JWT por JWKS e autorização no PostgreSQL. Projetos e Kanban persistem no banco.

## Estado e segurança
O nome comercial adotado é AnnA Nexus. O diretório técnico `teamhub/`, o schema PostgreSQL `teamhub` e a branch existente permanecem inalterados nesta etapa para preservar compatibilidade.\n\nEsta branch NÃO está publicada em produção. Nenhum banco foi alterado. Não inserir segredos no GitHub ou no frontend. O serviço só inicia com variáveis obrigatórias.

## Ambiente
Node 20+.
- DATABASE_URL: conexão PostgreSQL de banco **isolado**, com TLS.
- AUTH_JWKS_URL: URL JWKS oficial do emissor Neon Auth do portal (validar na documentação/configuração antes de usar).
- AUTH_ISSUER: valor `iss` esperado dos tokens verificados.
- AUTH_AUDIENCE: destinatário autorizado do token.
- PORT: porta HTTP (padrão 3000).
- O acesso ao Portal AnnA One utiliza link absoluto para o login central; conferir autenticação cross-origin e origem autorizada antes de homologar.
- CORS_ORIGIN: origem aprovada da aplicação (quando API separada; preferir mesma origem).

## Execução futura
1. Confirmar contrato real dos JWTs de Neon Auth (iss, aud, jwks).
2. Criar banco de desenvolvimento isolado; executar schema.sql nele.
3. Provisionar organização e um membership admin com auth_subject **validado**, jamais pelo e-mail como identificador de autorização.
4. Configurar segredos no serviço de hospedagem; iniciar `npm install && npm start`.
5. Validar sessões, autorização, tarefas e celulares antes de aprovar implantação.

## Limites da v0.1
Sem convites, anexos, colaboração em tempo real, PWA offline ou alterações do Portal AnnA One. O acesso pelo mesmo login exige validação do compartilhamento de sessão no endereço escolhido.

## Pendência futura — domínio AnnA Nexus via Cloudflare (16/11/2026)
- Endereço desejado: `https://nexus.annaone.com.br`.
- Render (workspace AnnA One) atingiu o limite do plano de **2/2 domínios personalizados**. Não remover nenhum domínio existente sem avaliar dependências.
- Manter por enquanto o endereço de desenvolvimento `https://anna-nexus-dev.onrender.com`.
- **Investigar futuramente** a possibilidade de utilizar Cloudflare (DNS, Worker, proxy ou outra configuração compatível) para servir `nexus.annaone.com.br` com segurança e sem custos adicionais, verificando viabilidade técnica, autenticação, SSL/TLS, limites e dependências.
- Não alterar DNS, Cloudflare, Render nem serviços de produção apenas com base nesta anotação; eventual implantação depende de verificação e aprovação.

## Entrega v0.1.4 — Tratamento e pendências
- Situação de tratamento independente do Kanban: pendente, em análise, em execução, aguardando retorno, bloqueada e resolvida.
- Campos: tratamento realizado, pendências/impedimentos, próxima ação e nota de atualização.
- Histórico cronológico por tarefa, associado ao usuário autenticado.
- Filtro de situação no quadro e contador de tarefas que exigem atenção no Dashboard.
- Migração aditiva: `migrations/0014-treatment.sql`, aplicada apenas ao banco `anna-nexus-dev`. Projetos e tarefas anteriores foram preservados.
- A publicação deve atualizar o indicador da interface para v0.1.4.
- Ainda é necessária validação funcional no navegador com a identidade central. Não houve alteração do Portal AnnA One de produção.

## Entrega v0.1.5 — Pendências em destaque no Dashboard
- Lista de tarefas bloqueadas e aguardando retorno, com suas pendências e próximas ações.
- Botão para abrir diretamente o projeto, com navegação responsiva.
- Dados isolados por organização e submetidos à verificação de acesso.
- Mantém o histórico e a modelagem da v0.1.4, sem alterar outras estruturas.
