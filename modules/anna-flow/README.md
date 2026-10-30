# AnnA Flow v0.7 — Homologação online

**Módulo AnnA One · Tecnologia e Educação Juntas**

Status: código integrado na branch `feature/anna-flow-online`. **Sem implantação pública**, ainda não pronto para clientes reais. Preservada a branch `main`.

## Implementado
- Painel multifilas, três temas adaptativos, relógio e orientações no corpo da tela, modo tela cheia com saída.
- Senha e guichê em destaque na chamada; histórico distingue **CHAMADO** e **CONCLUÍDO**.
- Console de emissão, chamada, conclusão, novos serviços, mensagens e fila de demonstração.
- API Node.js com PostgreSQL Neon; transações com `SELECT ... FOR UPDATE` para evitar colisões nos comandos simultâneos.
- Banco **Neon exclusivo** `anna-flow-dev` (projeto `frosty-butterfly-84934287`); tabela `flow_runtime` instalada e verificada.
- Nenhum Supabase.

## Executar em hospedagem Node.js
1. Usar `modules/anna-flow` como diretório raiz de build/execução.
2. Instalar: `npm install`; iniciar: `npm start`. Exige Node >=20.
3. Configurar na hospedagem, **somente como segredos**, `DATABASE_URL` (string do Neon para este projeto) e `FLOW_ADMIN_TOKEN` (segredo aleatório com 24+ caracteres).
4. Ativar HTTPS e testar `/health`, `/api/state`, emissão e conclusão.
5. Nunca colocar `.env` ou credenciais no GitHub.
6. O sistema faz polling de estado a cada 1,5 s. É necessário um servidor Node persistente, não somente GitHub Pages.

## Segurança — limitações da homologação
O console utiliza um único token compartilhado: adequado apenas para laboratório fechado, **não para produção pública**. Antes de liberar a clientes: autenticação por usuário, RBAC, tenant isolation, rate limit, auditoria e política de dados. A estimativa de espera é ilustrativa; mídia em vídeo compartilhada ainda é pendente.

## Plano
- Online primeiro com homologação e testes em navegador; depois versão offline e instalador Windows selecionando módulos, interligados por IP.
- v0.4: reprovada; não considerada versão aprovada.
- Não promover esta branch para `main` nem expor a operação à internet sem autenticação robusta.

Consulte `arquitetura.md` e `historico.md`.
