# AnnA Nexus v0.1.49 — Cards de Produção e convites por card

Ambiente: **DEV** (`anna-nexus-dev.onrender.com`). Não publicar para clientes de produção sem homologação de contas reais, permissões e Resend.

## Funcionalidades implementadas
- Card especial de produção com meta decimal (até 3 casas), unidade, prazo, meta coletiva ou individual, aprovação de gestor opcional, classificação de qualidade opcional pelo operador ou conferente, até 8 turnos nomeados com horários próprios.
- Operação mobile-first no próprio card: registro diário, data operacional, turno, quantidade, classificação, histórico e saldo coletivo; meta e desempenho individual para trabalhadores com cota definida.
- Aprovação: quando ativa, registros só entram no total após aprovação; com conferente, a classificação precede a aprovação. Rejeições justificadas e correções gerenciais preservam auditoria.
- Qualidade: quantidade aprovada + rejeitada + encaminhada a retrabalho = produção bruta; retrabalho é movimentação vinculada ao lançamento original e só aprovado em qualidade integra o total.
- Indicadores gerenciais por card, prazo e ritmo necessário, e relatório por funcionário, data e turno. Unidades distintas não são somadas.
- Equipe diretamente no card: funcionário ativo na mesma organização recebe atribuição imediata e e-mail informativo, **sem convite**. Novo colaborador recebe token individual de convite (7 dias) e cadastro/login AnnA One; o aceite associa organização e card atomicamente.
- Acesso ao card de produção é sempre restrito. No card comum de projeto, o gestor precisa marcar acesso restrito antes do convite por card. Remoção de participante não apaga os registros.
- E-mails de atribuição vão pelo Resend e o aviso interno é separado da fila de e-mail, evitando duplicidade. Falhas ficam registradas na tabela `card_email_notices`; o acesso já concedido continua válido.
- Link de aviso para colaborador existente leva organização e card; o sistema só seleciona uma organização presente em `/api/me`.

## Estruturas
- `projects.card_type`, `production_settings`, `production_assignments`, `production_entries`, `production_rework`, `production_audit`.
- `invitations.project_id`, `invitations.production_role`, `invitations.individual_target`.
- `card_email_notices` com `assignment_count`.
- Migrações DEV: `0035-production-cards.sql`, `0036-invite-production-role.sql`, `0037-card-notice-repeat.sql`.

## Endpoints DEV
- `POST /api/production?org=UUID`: criar Card de Produção (gestor/admin).
- `GET /api/production/UUID?org=UUID`: estado do card, entradas e permissões.
- `POST /api/production/UUID/entries?org=UUID`: lançar quantidade, com `request_id` UUID para idempotência.
- `POST /api/production/UUID/entries/ENTRY_ID/{quality,decide,rework,correct}?org=UUID`: classificar, aprovar/rejeitar, lançar retrabalho ou corrigir com auditoria.
- `POST /api/production/UUID/{assign,remove}?org=UUID`: atribuição/convidar ou remover participante.
- `GET /api/production/dashboard?org=UUID`: resumo gerencial de cards.
- `GET /api/production/UUID/report?org=UUID`: agregação por turno, dia e funcionário.
- `GET /api/cards/UUID/members?org=UUID`, `POST /api/cards/UUID/{assign,remove}?org=UUID`: convites e atribuições em cards tradicionais restritos.

## Regras de segurança
- Validação JWT central já usada pelo Nexus; consultas e gravações sempre escopadas por `organization_id`.
- Gestor só administra seus projetos; administradores administram a própria organização; operador/conferente só acessam Card de Produção atribuído.
- Criação de card restrita, e-mail do convite precisa coincidir com a identidade autenticada; token individual de uso único.
- Falha de envio de aviso não desfaz atribuição legítima; o status é exibido.
- Não há publicação de bancos ou APIs para produção; o Master existente permanece inalterado.

## Critérios de homologação ainda pendentes
- Testar em navegadores reais com administrador, gestor, operador e conferente de uma mesma empresa e em duas organizações independentes.
- Validar recebimento real dos e-mails Resend e entrada direta no card com usuário já existente e novo usuário.
- Conferir quantitativos, qualidade, rework, aprovação e correção com dados de teste autorizados.
- Validar perfil mobile em smartphone.
- Monitorar concorrência simultânea de retrabalho e lançamentos, e taxas de entrega de e-mails.
- Turnos são configurados na criação. Reprogramação histórica e calendário específico de dias úteis ainda exigiriam uma evolução posterior.

Status: código e migrações implementados em DEV; verificações estáticas e planos SQL executados; **não é homologação funcional end-to-end**.
