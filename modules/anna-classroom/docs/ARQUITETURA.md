# AnnA Classroom — arquitetura inicial (v0.1)
Atualizado em 2026-11-07.

## Decisões aprovadas
- Projeto 100% online: código no GitHub, sem download ou execução local obrigatória.
- Layout institucional aprovado da AnnA One; azul #0c2646, azul de ação #086cf3 e roxo #3512a2 para Gestão Escolar.
- Domínio pretendido: classroom.annaone.com.br; DNS administrado por Registro.br conforme o arranjo vigente. **Não configurado**.
- Portal AnnA One é o ponto de entrada para autenticação. **Sem novo cadastro de senhas no Classroom**.
- Tecnologias disponíveis: Cloudflare, Render, Neon, Resend. Não criar novas contas nem serviços pagos sem necessidade e aprovação.

## Verificações no código do portal AnnA One
- Login existente usa @neondatabase/auth@0.5.0-beta e endpoint Neon Auth.
- Dashboard valida sessão Neon e usa Cloudflare Worker /v1/admin/authorize e /v1/institution/me para permissões.
- A implementação de SSO entre subdomínios precisa ser verificada cuidadosamente; não assumir que sessão/cookies sejam compartilhados entre domínios.
- Dados de autorização fornecidos ao frontend não substituem validação de JWT, perfil, instituição e posse dos recursos em cada operação da API.

## Fase 1 — entregue no repositório
- Navegação responsiva: Início, Turmas, Aulas, Atividades, Correções e Ajustes.
- Arquivos estáticos iniciais index.html, styles.css e app.js.
- Interface sem formulários ou dados fictícios persistidos; nenhum login simulado ou falsa autorização.
- Não há banco, API, domínio ou publicação conectados nesta fase.

## Fase 2 — próximo desenvolvimento
1. Definir origem e verificação da sessão do portal para o subdomínio do Classroom, com autorização *fail closed*.
2. Implementar API institucional (Render ou Cloudflare conforme avaliação) e integração segura ao Neon PostgreSQL.
3. Criar tabelas mínimas: turmas, alunos/matrículas, aulas, atividades e entregas, com institution_id, auditabilidade e restrições de acesso.
4. Implementar primeiro fluxo real de turmas e alunos com dados de teste não pessoais.
5. Validar no ambiente online com acesso restrito; só então planejar DNS/publicação com autorização específica.

## Segurança
- Nunca colocar DATABASE_URL, segredos Neon, chaves Resend ou tokens de serviço no JavaScript do navegador ou no GitHub.
- Toda rota de leitura e escrita deve autenticar e autorizar servidor a servidor, inclusive isolamento entre instituições e usuários.
- Não cadastrar estudantes reais antes de revisar LGPD, papéis, consentimentos/bases legais aplicáveis e políticas de retenção.
- Resend apenas para notificações transacionais futuras, nunca como solução de autenticação independente.
- Não modificar o portal AnnA One, serviço de autenticação, workers existentes ou DNS nesta fase.
