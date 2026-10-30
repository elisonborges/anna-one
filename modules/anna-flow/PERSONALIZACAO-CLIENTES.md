# AnnA Flow — Personalização por cliente (planejada)

A v0.8 reorganiza o painel, sem alterar a API de filas. O modelo multiempresa ainda **não está implementado** e não deve ser simulado com o mesmo banco compartilhado de clientes reais.

## Customização prevista
- Cada organização possui unidades e seus próprios serviços, atendentes, guichês, políticas de prioridade, temas, orientações, mídias e histórico.
- Modelo escolar: Matrículas, Financeiro, Vendas, Secretaria.
- Modelo clínico/hospitalar: Recepção, Cadastro, Convênios, Coleta, Exames, Consultórios e setores configuráveis; recepção e triagem não substituem protocolos clínicos, classificação de risco ou decisões profissionais.
- Painéis podem ser associados a uma ou várias filas da mesma unidade, com identificação clara do destino (guichê, sala, consultório ou setor).
- Privacidade: painel sem diagnóstico, informações clínicas pessoais ou nomes por padrão; controle de acesso por unidade, auditoria e minimização de dados.
- Customização por administrador do cliente, sem alterar código-fonte e sem reiniciar o serviço.

## Migração necessária
Criar estrutura PostgreSQL multi-tenant no Neon (organizations, units, services, destinations, tickets, roles, signage_profiles, media). Migrar da tabela de estado único flow_runtime **sem excluir registros até validação e backup**. Implementar autenticação por usuário e isolamento rigoroso por organização antes de oferecer a terceiros.
