# AnnA Flow — atendimento inteligente

**Status:** módulo em desenvolvimento, branch de homologação. Não publicado nem disponível para clientes.

Produto integrante do **AnnA One — Tecnologia e Educação Juntas**. Plataforma para filas e serviços simultâneos (Matrículas, Financeiro, Vendas, Informações etc.), chamada com destino (guichê/sala), painel público, orientações, mídia institucional e relatórios.

## Diretrizes aprovadas
- Identidade visual AnnA One, símbolo oficial, cores institucionais, temas configuráveis.
- Tela pública 16:9 sem barra de rolagem, relógio e orientações no corpo do painel.
- Botão Modo TV com retorno visível e tecla Esc.
- Chamada destacada temporariamente; acessibilidade e movimento reduzido.
- Histórico separado em aguardando, chamado e concluído.
- Múltiplas filas independentes por serviço.
- Desenvolvimento **online primeiro**. A versão offline e o instalador por terminal/IP serão posteriores.
- **Neon/PostgreSQL** como banco quando necessário; **não usar Supabase**.

## Situação técnica
A v0.6 preparada localmente usa Node.js e arquivo JSON para teste, sem implantação pública. **Ela ainda não foi integrada a esta branch.** Esta pasta representa a criação do módulo no GitHub e documentação/arquitetura; não afirma ter backend implantado.

## Próxima implementação
1. Importar, revisar e testar a base de código v0.6, corrigindo eventuais falhas visuais.
2. Criar projeto Neon isolado para AnnA Flow, somente na fase de integração persistente.
3. API Node.js/HTTPS, perfis de acesso, empresas/locais, operações transacionais, auditoria.
4. Implantar ambiente de homologação; só depois decidir publicação comercial.

## Arquitetura
Consulte [arquitetura.md](./arquitetura.md), [schema.sql](./schema.sql) e [historico.md](./historico.md).

**Atenção:** não colocar segredos ou credenciais no repositório. Não reutilizar bancos de outros módulos.
