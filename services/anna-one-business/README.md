# AnnA Business — API cadastral (incremento 03)

Implementação inicial do Worker separado, com GET /health, GET /v1/context, GET/POST /v1/parties e GET/POST /v1/parties/{id}/establishments. Preserva o Worker de auditoria, Neon Auth, privilégios Master e tabelas operacionais.

## Estado
- Migrações 001 e 002 aplicadas na produção (PR #113, commit ddc153b9d1ef3e3c69b12958a0bdc2cbdc316560). Branch de testes br-patient-water-b6945ye6 encerrada.
- Produção confirmada: 8 tabelas, 2 funções de registro e 1 instituição existente. Nenhum parceiro fictício copiado.
- API e frontend implementados; deploy, build Wrangler e teste autenticado ponta a ponta pendentes.
- Não confundir /health com teste de conexão ou autorização. A interface permanece indisponível para escrita até que o serviço esteja configurado e a sessão tenha associação Business.

## Ativação controlada (somente após aprovação)
1. Confirmar o UUID de public.app_users correspondente ao sub do JWT central de um administrador autorizado. O serviço rejeita identidades sem associação. Não vincular por e-mail nem conceder acesso automaticamente a todos os Masters. Confirmar a semântica de validação JWT do endpoint Master existente.
2. Provisionar o tenant interno e associação explícita do responsável. Usar role PostgreSQL dedicada anna_business_runtime, LOGIN, NOINHERIT, NOBYPASSRLS, NOSUPERUSER, sem privilégios de criação nem filiação a roles privilegiadas. A role não deve possuir tabelas. O arquivo provisioning.example.sql descreve as concessões mínimas; executar apenas após configuração da credencial em canal privado.
3. No diretório services/anna-one-business, instalar dependências e executar npm test e npm exec wrangler deploy -- --dry-run. Configurar DATABASE_URL (URL da role dedicada, não neondb_owner) como secret Cloudflare e INTERNAL_TENANT_ID (UUID interno confirmado) como variável. Não enviar senha, JWT ou URL de conexão no chat ou no GitHub.
4. Após autorização, publicar o Worker separado anna-one-business pelo Wrangler no mesmo namespace Cloudflare. Conferir o endereço efetivo e atualizar REGISTRY_URL do frontend se necessário. Nenhuma publicação automática.
5. Validar CORS com https://annaone.com.br, sessão sem autorização, sessão Master sem vínculo Business, usuário autorizado apenas consulta, editor/owner, criação e duplicidade PF/PJ, estabelecimento com raiz incompatível e auditoria. Testar primeiro com ambiente de homologação; não inserir cadastro fictício em produção.
6. Mesclar frontend após validação do serviço.

## Limites desta entrega
Somente ambiente interno e criação/listagem de PF/PJ e estabelecimentos. CPF obrigatório nesta primeira interface; PJ exige CNPJ completo válido para obter raiz, e estabelecimento é cadastrado separadamente. Validação de dígitos não comprova regularidade fiscal. Não há edição/exclusão, atribuição de papéis comerciais, empresa própria, vínculo com unidade operacional, importação ou acesso multitenant comercial nesta entrega. Sem retentativas automáticas; conflitos de identificador são tratados, mas idempotência geral por request_id ainda deve ser implementada. A listagem limita 500 registros sem paginação; CPF não é retornado. Nenhuma credencial incorporada. A autorização é verificada no serviço Master antes do uso do sub e novamente via associação explícita e RLS. A correspondência sub/app_users precisa ser validada no ambiente real antes de ativar o acesso.

Referências: https://neon.com/docs/serverless/serverless-driver e https://developers.cloudflare.com/workers/configuration/secrets/.
