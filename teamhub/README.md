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

## Entrega v0.1.6 — Registro rápido de andamento
- Na ficha de tarefa existente, registrar uma nota de andamento sem precisar alterar ou salvar novamente os demais campos.
- O evento fica associado à identidade autenticada e à data/hora no histórico da tarefa.
- Autorização de edição verificada no backend; formulário responsivo para dispositivos móveis.

## AnnA Nexus v0.1.7 — Convites de membros (desenvolvimento)
- Administradores geram convites individuais de 7 dias, com papel inicial e link de utilização única.
- O link é compartilhado por cópia ou pelo cliente de e-mail do administrador; **envio automático ainda não está configurado**.
- Não exibir o segredo em listas, não armazená-lo em texto claro; banco guarda apenas o hash SHA-256.
- O destinatário precisa autenticar-se com o Neon Auth do Portal AnnA One usando o **mesmo e-mail assinado no JWT** e confirmar a aceitação.
- O fluxo aceita participantes novos e associa o ID autenticado à organização, sem duplicar contas ou armazenar senhas.
- Administradores consultam pendentes, aceitos, expirados e cancelados; convites pendentes podem ser cancelados.
- Migração aditiva `migrations/0017-invitations.sql`, aplicada somente ao banco `anna-nexus-dev`.
- Ao trocar de conta para aceitar um convite, use o login do portal com o e-mail convidado.
- O envio automático via Resend poderá ser acrescentado somente após validar domínio, credenciais e políticas de entrega.

## v0.1.8 — Organização visual e tabelas
- Projetos, projetos recentes, membros, convites, minhas tarefas e pendências prioritárias agora usam tabelas HTML compactas com cabeçalhos e colunas.
- Tabelas possuem rolagem horizontal em telas estreitas, mantendo os nomes e controles acessíveis.
- Ficha de tarefa usa campos em duas ou três colunas onde houver espaço; no celular reorganiza os campos responsivamente.
- Kanban continua visualmente em três colunas. Sem alterações no banco ou API.
- Versão no cabeçalho e nos recursos JS/CSS atualizada para 0.1.8.

## Entrega v0.1.9 — Ajustes de navegação, identidade do cliente e equipe
- Projetos e projetos recentes: botão explícito **Abrir projeto** em cada linha da tabela.
- Minhas tarefas: botão **Abrir** com largura e aparência consistente com as demais ações.
- O banner permanece **AnnA Nexus**, mas exibe o nome personalizado e o logotipo HTTPS da organização, configurados somente por administradores na aba Equipe.
- Equipe: inclusão por convite, alteração do perfil dos membros e remoção de acesso por desativação reversível (preserva histórico); evita desativação do próprio administrador.
- Tarefas: seleção de diversos responsáveis em caixas de marcação, inclusive repetidos em várias tarefas do mesmo projeto. A lista **Minhas tarefas** passa a considerar atribuições compartilhadas.
- Migração aditiva: `migrations/0019-brand-and-assignees.sql` no banco separado anna-nexus-dev, com preservação dos responsáveis anteriores.
- Não alterar o login central, não modificar o portal principal ou os dados de produção.
- Revisão funcional por navegador com contas reais ainda é necessária, além da checagem de sintaxe.

## Entrega v0.1.10 — Abertura de projetos e logotipo local
- O botão **Abrir** e o nome clicável ficam na primeira coluna de Projetos/Projetos recentes, sem exigir rolar até o final da tabela.
- Em Equipe > Identidade do cliente é possível selecionar PNG, JPEG ou WebP do computador/celular (até 5 MB).
- O navegador redimensiona o arquivo para até 320 px e o converte em WebP; o backend valida tamanho/mime e salva a imagem pequena como data URI no campo `logo_url`, dispensando armazenamento externo.
- A opção de logotipo por link HTTPS continua disponível.
- A migração do banco **não é necessária** nesta atualização; o conteúdo vai para o campo já existente.
- Não alterar o portal principal de produção. Recomenda-se confirmar visualmente botão de projeto e upload local no navegador.
