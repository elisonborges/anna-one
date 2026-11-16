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

## v0.1.11 — Correção de Projetos
- Os botões da página Projetos agora possuem elementos DOM próprios; não são reutilizados na tabela de Projetos recentes.
- Em Visão geral / Projetos recentes, mostrar apenas os dados compactos, sem botão Abrir.
- Em Projetos, exibir o nome com botão Abrir ao lado, na primeira coluna.
- Alteração exclusivamente de interface; banco e API preservados.

## AnnA Nexus v0.1.13 — Ciclo de vida, pendências e relatórios
- Em Minhas tarefas: Abrir, Editar, Pausar/Retomar, Arquivar/Restaurar e Excluir (remoção lógica, somente administradores).
- Pausa de tarefa ou projeto requer justificativa de pendência. Cada intervalo é registrado em `teamhub.pause_periods` com início, fim, responsável e motivo; o tempo total corre normalmente.
- Relatórios por organização: tempo total de cada projeto, tempo acumulado de pendência do projeto, histórico de pausas dos projetos e tarefas, CSV.
- Filtros de tarefas arquivadas sem mostrar tarefas logicamente excluídas.
- Migração aditiva de desenvolvimento `migrations/0020-pauses-and-lifecycle.sql`.
- A integração de e-mail e central de notificações será uma entrega posterior. Não há envios automáticos nesta versão.

### Critérios operacionais
- Pausar **não interrompe o tempo total** (desde a criação), somente abre um intervalo de pendência.
- Retomar fecha o intervalo; pausar novamente inicia outro, preservando os anteriores.
- Arquivar ou excluir logicamente encerra a pausa ativa da tarefa para manter a soma correta.
- "Excluir" não apaga dados fisicamente e está reservado a administradores.
- "Mostrar arquivadas" habilita restauração em Minhas tarefas.
- Relatórios permitem ver projetos, tarefas, pausas e exportar CSV; relatórios calculados na leitura, sem cronômetro local.
- Notificações automáticas por e-mail não estão habilitadas. Priorizar preferências de envio, templates e domínio autenticado antes de integrar Resend.

## v0.1.14–v0.1.15 — Cards de projetos e subtarefas
- Guia de referência: https://trello.com/guide — quadros, cartões, membros, vistas e automações.
- A aba **Projetos** usa cards com cores configuráveis (azul, roxo, verde, laranja, rosa, turquesa e cinza), descrição, métricas, proprietário e ações **Abrir**, **Personalizar**, **Convidar**.
- Administradores/gestores podem criar novo card e editar nome, descrição, cor e proprietário (somente membros ativos). **Convidar** encaminha à área de convites da organização; permissões específicas por projeto não estão implementadas.
- **Projetos recentes**, no Dashboard, continua em tabela com nomes clicáveis, conforme a aprovação anterior.
- Na ficha **Editar tarefa**, criar e acompanhar subtarefas com título, responsável, prioridade, prazo e situação próprios, sem duplicar tarefas.
- No Kanban aparece o número de subtarefas concluídas em cada tarefa.
- Migrações aditivas executadas apenas no Neon de desenvolvimento: `migrations/0021-project-cards.sql` e `migrations/0022-subtasks.sql`.
- Permissões por projeto, anexos e relatórios de subtarefas são melhorias posteriores; não afirmar que já foram implementados.

## AnnA Nexus v0.1.16 — Trabalho compartilhado e avisos internos
- Subtarefas com **múltiplos responsáveis**, independentes da tarefa principal; seleção por caixas de marcação e edição posterior de atribuições.
- Compatibilidade com subtarefas antigas: migração aditiva `0023-subtask-members-notifications.sql` copia a atribuição individual existente para o conjunto de responsáveis.
- **Notificações internas**, individuais e privadas, por atribuição de projeto, tarefa ou subtarefa. Caixa de entrada com contagem de não lidas, marcação individual e em lote; link para projeto.
- **Relatórios de subtarefas** por projeto/tarefa, incluindo situação, responsáveis, prazo e tempo de calendário; subtarefas incluídas no CSV.
- Não há e-mail automático, notificações push, permissões específicas por projeto nem anexos nesta entrega.
- A migração e os testes SQL são restritos ao Neon `anna-nexus-dev`, sem exclusão de dados.

## AnnA Nexus v0.1.17 — Minhas subtarefas e acesso às notificações
- Página Minhas tarefas inclui uma tabela separada de subtarefas atribuídas à conta autenticada, inclusive compartilhadas: projeto, tarefa principal, situação, prazo e ações.
- Abrir a tarefa principal ou marcar a subtarefa como concluída sem procurar manualmente no Kanban.
- Botão de notificações no cabeçalho, acessível também no celular, com contador de não lidas.
- As notificações continuam **somente internas**; nenhum envio externo ou e-mail automático.
- Relatórios, membros, projetos e banco de produção preservados.

## v0.1.18 — Cards alinhados e controle de acesso por projeto
- Botões Abrir projeto, Personalizar e Convidar em uma única linha, em colunas iguais.
- Visibilidade opcional em Personalizar projeto: Todos da organização (padrão) ou Restrito aos participantes selecionados.
- Administradores, gestores e responsável designado preservam o acesso. Apenas membros ativos podem ser escolhidos.
- Projetos, tarefas, subtarefas, dashboard, pendências, notificações e relatórios filtrados pelo acesso.
- Rotas diretas das tarefas/subtarefas também verificam o projeto vinculado.
- Migração aditiva `migrations/0024-project-permissions.sql` exclusivamente no Neon de desenvolvimento; todos os projetos anteriores seguem visíveis à organização.
- Anexos e e-mails automáticos ainda pendentes; dependem de armazenamento seguro, credenciais e preferências por usuário.

## Entregas v0.1.19–v0.1.21 — Kanban, calendário e modelos
- **v0.1.19:** arrastar e soltar tarefas entre as três etapas, com alternativa de selecionar status em dispositivos móveis; filtros rápidos combinados por tratamento, prioridade, etiquetas e pesquisa; seis etiquetas pré-definidas por tarefa, editáveis na ficha.
- Migração aditiva `migrations/0025-kanban-labels.sql` no Neon de desenvolvimento. Etiquetas validadas na API.
- **v0.1.20:** calendário mensal com tarefas e subtarefas que possuem prazo, filtro de projetos autorizados, navegação por meses e tabela de entregas.
- **v0.1.21:** modelos opcionais ao criar projeto: Vazio, Planejamento, Desenvolvimento, Atendimento e suporte, Projeto educacional. Criação do projeto e das tarefas iniciais em única instrução SQL transacional, sem duplicar tarefas existentes.
- Não houve alteração no portal principal nem habilitação de e-mails automáticos. Anexos e automações externas seguem pendentes.
- Todos os fluxos precisam de homologação com contas reais antes do uso em produção.

## v0.1.22 — Filtros de prazos e calendário consolidado
- Kanban: filtros por prazo (Atrasadas, Próximos 7 dias, Sem prazo) combináveis com prioridade, tratamento, etiquetas e busca.
- Tarefas atrasadas e ainda não concluídas são destacadas no quadro.
- Menu móvel adaptado para seis áreas (Início, Projetos, Tarefas, Agenda, Relatórios, Equipe).
- Conclui o pacote v0.1.19–v0.1.22 sem alterar produção nem realizar envio de e-mail ou armazenamento de anexos.

## AnnA Nexus v0.1.23 — Comentários, menções, cronograma e carga de trabalho
- Na ficha de tarefa, o registro de andamento aceita comentários textuais e menções explícitas aos membros ativos da organização. Cada pessoa mencionada recebe uma notificação interna individual, respeitando as permissões do projeto.
- Não envia e-mails nem interpreta automaticamente nomes escritos no comentário como menções.
- Na tela Calendário, o cronograma exibe as entregas do mês como barras da criação ao prazo; é uma visualização de datas existentes, sem campo adicional de estimativa ou dependências.
- Em Relatórios, tabela de carga de trabalho por integrante, contando separadamente atribuições de tarefas e subtarefas abertas, sem duplicar o mesmo integrante na mesma atividade.
- Sem novas migrações. Não houve mudança de produção ou criação de dados artificiais.
- A versão exige validação funcional de comentários, permissões e visualizações com login real antes de homologação.

## AnnA Nexus v0.1.24 — Dashboard gerencial e automação interna
- Visão geral ganhou Dashboard gerencial inspirado na identidade AnnA One / Health Monitor: indicadores, gráfico donut de etapas, gráfico de atividades registradas, progresso dos projetos e tabela de acompanhamento.
- Filtros por projeto autorizado e janela de atividades de 7, 30 ou 90 dias. Indicadores de tarefas e projetos são **estado atual**, enquanto o gráfico de atividades respeita o período selecionado.
- Indicadores adicionais: tarefas atrasadas, projetos pausados, subtarefas concluídas, tempo acumulado de pausas de projetos e tarefas. O total acumulado não representa tempo trabalhado, e paralelismos não são descontados.
- Exportar dados consolidados em CSV, com proteção contra fórmulas em planilhas.
- Modo Telão nativo no navegador, com alternativa visual simples quando a API fullscreen não existir.
- Botão Verificar prazos, disponível a administradores e gestores, cria notificações **internas** para responsáveis ativos de tarefas atrasadas ou com prazo nos próximos 2 dias, respeitando projetos restritos e evitando repetição em 24 horas. Não é uma automação em background; não envia e-mail.
- API `/api/dashboard/insights` retorna apenas métricas e projetos autorizados; filtros e relatórios não expõem dados de outros clientes.
- Corrigida a contagem antiga de tarefas arquivadas/excluídas no cartão-resumo.
- Nenhuma migração necessária; banco e portal de produção preservados. Homologação multiusuário ainda pendente.

## v0.1.25 — Anexos privados e próximos passos de notificações
- Anexos na ficha de **Editar tarefa**: upload, listagem, download e exclusão autorizada. PDF, PNG, JPEG, WebP e TXT, até **256 KB** cada, máximo **12** por tarefa.
- Arquivos ficam na tabela `teamhub.task_attachments` do **Neon de desenvolvimento**, não são públicos e são recuperados apenas após autenticação e checagem de organização/projeto/tarefa.
- Downloads são oferecidos como arquivos (application/octet-stream), sem execução ou visualização inline. Inclusão e exclusão registram atividades. Usuários com perfil editor enviam; exclusão limitada ao autor do arquivo ou a gestores/administradores.
- Migração aditiva `migrations/0026-task-attachments.sql`. Essa solução é **provisória e limitada a arquivos pequenos**; armazenamento dedicado com antivírus/limites e políticas de retenção será necessário para documentos maiores e uso em produção.
- A automação de prazos continua **manual** no Dashboard; cron externo e integração Resend para e-mails não estão habilitados. Requerem credenciais e parâmetros de segurança verificados antes de ativar.
- Sem alterações no portal principal ou Neon de produção; testes funcionais de upload com conta autenticada ainda pendentes.

## AnnA Nexus v0.1.26 — Encerramento com dupla conferência e reabertura
- Novo ciclo formal do projeto: `active` (em andamento) → `review` (fila de validação) → `completed` (concluído). Os projetos antigos continuam `active`.
- O solicitante preenche **5 checks** de conferência. Solicitação bloqueada se houver tarefa/subtarefa não concluída, tarefa pausada, tratamento bloqueado ou aguardando retorno, ou projeto pausado.
- Administradores têm aprovação final independente com seus **5 checks**. Podem devolver à execução com justificativa ou **reabrir projeto concluído**, sem perder histórico, atribuições, anexos, tarefas ou subtarefas.
- A fila de validação aparece na área Projetos para administradores e gestores; a decisão de aprovar, rejeitar ou reabrir é exclusiva do perfil `admin`.
- Operações em tarefas/subtarefas e pausa de projeto ficam bloqueadas enquanto o projeto estiver em revisão ou concluído; após devolução/reabertura voltam ao normal.
- Histórico completo das decisões, data, autor, nota e checks preservado em `teamhub.project_approvals`, exibido também em Relatórios e exportação CSV.
- Alertas internos enviados aos administradores quando um projeto é submetido. Não há e-mails automáticos nem exclusão definitiva de projetos.
- Migração aditiva `migrations/0027-project-approvals.sql` aplicada somente ao Neon de desenvolvimento. Nenhum projeto foi encerrado automaticamente.
- Sem publicação no Portal AnnA One principal; exige homologação funcional com autenticação para liberação em produção.

## AnnA Nexus v0.1.27 — Preferências, prazos de subtarefas e decisões
- Cada membro configura suas preferências **por organização** na tela Notificações: atribuições, menções, prazos e aprovações. As configurações se aplicam aos **novos** avisos internos; não apagam o histórico já criado.
- Filtros rápidos na caixa de entrada: todas, não lidas, atribuições, menções, prazos e aprovações.
- As decisões de aprovação, devolução e reabertura de projetos geram notificações internas ao solicitante e ao responsável, respeitando preferências pessoais.
- O botão Verificar prazos também considera subtarefas pendentes, inclusive com múltiplos responsáveis, e respeita as permissões dos projetos e preferências de prazos. Proteção contra novos avisos repetidos em 24 h.
- **E-mail desativado por padrão e nesta versão:** há estrutura para preferências futuras, mas nenhum envio externo/Resend foi ativado. Um agendador real depende da configuração segura de um serviço cron, ainda não ativado. Não chamar o botão manual de agendamento.
- Migração aditiva `migrations/0028-notification-preferences.sql` no Neon de desenvolvimento; banco e portal de produção preservados. Testes autenticados entre vários usuários permanecem pendentes.

## v0.1.28 — Lembretes agendados, monitoramento e preparação Resend
- Verificação automática de prazos **best-effort** depois das 09:00 no fuso America/Fortaleza, com revisão a cada 15 minutos enquanto o servidor estiver ativo. Cada organização é processada no máximo uma vez por dia, por meio de um registro de execução exclusivo no Neon, com retentativa controlada em caso de falha.
- **Limitação do Render Free:** serviço pode adormecer e, portanto, o agendamento NÃO tem garantia de acontecer no horário nem no mesmo dia. O botão manual Verificar prazos permanece ativo; uma execução 100% confiável exigirá serviço cron externo ou Neon Functions agendadas (avaliar custo/credenciais antes).
- Histórico de execuções manual/agendada em **Relatórios → Monitor de notificações** para gestores/admins. Mostra datas, status, contagens de tarefas/subtarefas e erros, sem expor dados de outros clientes.
- Integração Resend implementada em modo protegido por configuração: exige `NEXUS_EMAIL_ENABLED=true`, `RESEND_API_KEY` e `NEXUS_EMAIL_FROM` com domínio verificado. Sem essas variáveis, nenhum e-mail é enviado e a opção permanece desabilitada.
- Envio opt-in por pessoa e organização, somente para o e-mail verificado presente no token de identidade (`email_verified=true`), nunca para um endereço fornecido livremente pelo navegador. Contatos de envio são armazenados somente mediante opt-in, removidos quando o usuário desativa e-mail.
- O worker de e-mail, se devidamente configurado, consulta apenas avisos novos e não lidos de usuários ativos, respeitando autorização por projeto; envia mensagem genérica sem dados sensíveis pela API Resend, com chave de idempotência; audita aceite/falha, sem repetição automática após falha para evitar duplicatas. O registro de aceite do Resend NÃO comprova entrega.
- Monitor de tentativas/aceites de e-mail disponível para gestores e administradores, com dados limitados ao cliente e sem divulgar endereços de destinatários.
- Migração aditiva `migrations/0029-automation-and-email-audit.sql` aplicada apenas no Neon de desenvolvimento. Portal AnnA One principal e Neon de produção inalterados.
- Homologação de SMTP/Resend real, aprovação financeira de cron externo e validação com várias contas autenticadas permanecem pendentes; não interpretar deploy do código como confirmação desses serviços.

## AnnA Nexus v0.1.29 — Navegação e conclusão aprimoradas
- Desktop: botão com seta no topo do menu lateral alterna entre navegação expandida e compacta por ícones; escolha persistida no navegador.
- Mobile: botão ☰ no cabeçalho abre a navegação lateral como gaveta; fecha ao escolher uma tela, tocar fora ou pressionar Escape, mantendo a barra inferior existente.
- O conteúdo usa toda a largura liberada pelo menu recolhido; navegação e labels acessíveis por aria-label/title.
- No quadro de cada projeto, barra de progresso mostra tarefas e subtarefas concluídas, computadas dos dados atuais do projeto.
- A conferência de conclusão de projeto ativo só aparece no quadro depois que todas as tarefas e subtarefas estão concluídas, sem pausas ou tratamentos aguardando/bloqueados; projetos em revisão/concluídos preservam entrada para decisão ou reabertura.
- Quando a API retorna 401, a área privada é escondida e o formulário de autenticação reaparece.
- Todos os arquivos são mudanças estáticas na branch de desenvolvimento; sem migração de banco ou alteração da produção.

## v0.1.30 — Kanban com filtros recolhíveis e resumo de pendências
- Botão **Mostrar/Ocultar filtros** no quadro: filtros permanecem aplicados mesmo recolhidos; o botão é destacado quando existe algum filtro ativo.
- Resumo compacto, sempre visível, de tarefas abertas, atrasadas, bloqueadas e aguardando retorno; indicadores consideram as tarefas do projeto, sem confundir com a filtragem do quadro.
- Layout mobile-first com indicadores em grade 2×2 e botão de filtros em largura total.
- Kanban respeita o status de projeto em validação ou concluído, impedindo mudanças de etapa sem reabertura.
- Sem mudanças de banco, integrações pagas ou dados de produção.

## AnnA Nexus v0.1.31 — Calendário compacto, novas cores e detalhes da tarefa
- Calendário mensal com células cerca de um terço menores em desktop; dimensões e tipografia adaptadas também para smartphones. A lista de entregas e o cronograma permanecem.
- Cinco cores adicionais de projetos: **Índigo, Coral, Dourado, Menta e Grafite**, somando 12 opções de aparência.
- Migração aditiva `migrations/0030-project-card-themes.sql` no Neon DEV. `card_theme` preserva a restrição legada de sete valores da coluna `card_color`; nenhuma cor anterior é perdida.
- Ao editar uma tarefa, painel maior, responsivo e dividido em **Detalhes**, **Subtarefas**, **Comentários** e **Anexos**. As seções utilizam os mesmos campos e APIs já existentes. Navegação por clique, Tab e setas, com contagens de subtarefas e anexos.
- Na aba Detalhes mantém título, descrição, responsáveis, tratamento e o botão Salvar. Nas outras abas permanecem as ações específicas (criar subtarefa, comentar, enviar anexo) sem exigir salvar a ficha inteira.
- Não altera arquivos existentes nem dados reais de projeto, além da nova coluna vazia por padrão. Banco e portal de produção preservados.

## AnnA Nexus v0.1.32 — Correção dos temas claro e escuro
- Alternância de tema movida para `public/theme.js`, independente da inicialização da autenticação e das outras telas. O botão funciona mesmo se o módulo principal falhar.
- Tema inicial aplicado no cabeçalho antes do carregamento dos estilos; continua seguindo a preferência salva, com alternativa automática pelo tema do sistema.
- Botão indica a ação seguinte, com texto acessível, e preserva a escolha em `localStorage` quando disponível.
- Corrigidos o fundo da raiz e as cores de contraste de etiquetas, pendências, botões e avisos no modo escuro.
- Mudança somente no frontend, sem migração de banco ou serviços pagos. Homologação visual autenticada segue necessária.
