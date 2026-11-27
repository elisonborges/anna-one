# AnnA Business — 1.2.0-dev.92

Ciclo inicial 01–66 publicado; Geração 2 (67–78). Referência: Plano Diretor AB-PD-001 rev. 1.0.

A v0.9 e o incremento 61 foram publicados pelo PR #173, commit b0fb298; migrações 046–049 aplicadas em produção. O ciclo 62–66 acrescenta indicadores gerenciais, preferências locais, administração, integridade, auditoria e rastreabilidade, sem migração nova.

- [Recursos, orçamento de projetos e locações](V12-PROJECT-RESOURCES-RENTALS.md)
- [Projetos empresariais](V12-PROJECTS.md)
- [Consolidação operacional](V12-OPS-CONSOLIDATION.md)
- [Recursos, custos e produtividade](V12-OPS-RESOURCES.md)
- [Gestão operacional](V12-OPERATIONS.md)
- [TimeClock, Access e consolidação de pessoas](V11-WORK-ACCESS.md)
- [Folha processada externa](V11-PAYROLL.md)
- [Departamento pessoal](V11-DP.md)
- [Fundação RH e vínculos](V11-HR-FOUNDATION.md)
- [Consolidação v1.0](V10-RELEASE.md)
- [Painel executivo](V10-EXECUTIVE.md)
- [Consolidação v0.9 — registro histórico](V09-RELEASE.md)

Versão de desenvolvimento, sujeita à homologação operacional. Publicação depende de testes Node, build e verificação do Worker e GitHub Pages. O registro histórico abaixo não descreve o estado atual.

---

## Registro histórico — incremento 01

Projeto integrante de AnnA One. Referência: Plano Diretor AB-PD-001 rev. 1.0, complementos 01–06.

## Entrega atual

- Página institucional e painel responsivo, com tema claro/escuro e símbolo oficial compartilhado.
- Consulta de sessão pelo mesmo SDK Neon Auth e verificação obrigatória da autorização Master pelo Worker existente.
- Dashboard cadastral, pesquisa por nome/CLI, filtros de classificação e situação, fichas institucionais e grupos.
- A classificação usa organization_kind quando informado; não deduz personalidade jurídica nem cliente a partir de uma instituição operacional.
- Os dados protegidos permanecem em memória; apenas a preferência de tema é armazenada localmente.
- Não há criação de dados reais, alterações no Master, login, Worker, banco ou arquivos de produção.

## Estrutura

- app/business/index.html — página de apresentação e painel.
- app/business/business.css — estilos próprios complementares ao styles.css oficial.
- app/business/business.js — interface e consultas autorizadas.

## Validação antes de publicar

Após autorização para disponibilizar em homologação ou produção, abrir /app/business/ pelo domínio autorizado, clicar em Acessar painel, usar a sessão central. Se a sessão estiver ausente, entrar pelo login existente (destino Master) e retornar ao Business. Validar:
1. sessão ausente / usuário sem autorização: nenhuma instituição ou perfil é exibido;
2. Master autorizado: contadores, pesquisa, filtros e ficha correspondem à origem;
3. falha do endpoint de grupos: quantidade indisponível, sem inventar dados;
4. perda de autorização: dados da interface são limpos;
5. navegação móvel, tema claro/escuro, logo e layout;
6. nenhuma alteração em registros, permissões ou serviços existentes.

Endpoints GET reaproveitados do Master:
- /v1/admin/authorize
- /v1/admin/institutions
- /v1/admin/institution-groups
- /v1/admin/institutions/{id}/profile

Não é uma versão comercial. Nenhum teste online autenticado foi executado nesta entrega.

## Próximo incremento (v0.1.0)

Consolidar o modelo físico e a integração de escrita por serviço autorizado. Entidades mínimas: tenant/espaço empresarial, empresa própria, parceiros (PF/PJ), identificação jurídica, estabelecimentos e vínculo temporal com public.institutions. Identificadores e códigos CLI existentes permanecem intactos. Separar entidade jurídica, estabelecimento e unidade operacional; não presumir que as instituições sejam clientes ou que compartilhem CNPJ. CNPJ numérico/alfanumérico com validação de dígitos verificadores de acordo com a Receita Federal. Permissões específicas e isolamento no servidor/banco antes de expor escrita; trilha de auditoria, validação de duplicidade, teste de migração e reversão. Reutilizar a base cadastral sem sincronização bidirecional concorrente.

Não criar schema/tabelas diretamente em produção antes de revisar o SQL, os acessos e as restrições. Não inserir dados de teste reais. Não copiar credenciais, tokens, informações pessoais ou dados de clientes para o GitHub.

## Publicação

Fluxo: branch de desenvolvimento -> commits -> pull request -> revisão e testes -> autorização explícita -> merge/deploy. Esta entrega não altera main. Não habilitar deploy automático. A integração do card oficial no portal e retorno direto do login serão propostas posteriormente, preservando a autenticação e os privilégios existentes.

### Alinhamento do roadmap
A expansão 87–96 integra a Geração 3 conforme seção 22 do Plano Diretor AB-PD-001 rev.1.0. Geração 4: marketing, canais, e-commerce, CPQ e Customer Success avançados. Tax Engine e contabilidade avançada (Geração 2) permanecem pendentes.
