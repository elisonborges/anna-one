# AnnA Service Desk — Fase 2: núcleo multiusuário (proposta técnica v0.1)

**Estado:** projeto de arquitetura; não implantado. **Referências:** Especificação funcional v0.3 (19/10/2026) e Documento Mestre (28/10/2026).

## Objetivo e limite desta entrega
Estabelecer um modelo mínimo para API, autenticação, persistência, isolamento por instituição e auditoria, antes de conectar a interface demonstrativa. Nenhum banco, usuário, credencial, infraestrutura ou dado real foi modificado.

## Entidades e chaves propostas
- `platform_users`: id UUID; identidade autenticada. Não confundir com papel institucional.
- `tenants`: id UUID, code único e estável, nome, estado; criação restrita à administração central.
- `regions`: id UUID, tenant_id, parent_region_id opcional, nome.
- `units`: id UUID, tenant_id, region_id opcional, nome, endereço e contatos controlados.
- `sectors`: id UUID, tenant_id, unit_id, nome.
- `memberships`: user_id, tenant_id, papel, unidade/escopo opcional, status (convidado/pendente/ativo/revogado); uma pessoa pode ter vários vínculos.
- `providers`: id UUID, nome, status; empresa prestadora é entidade distinta de tenant.
- `contracts`: id UUID, tenant_id, provider_id, vigência, escopo, status; autorizações específicas por unidades/categorias/filas.
- `provider_memberships`: user_id, provider_id, papel/status; não autoriza leitura de tenant por si só.
- `assets`: id UUID, tenant_id, unidade patrimonial, inventário e série como TEXTO, dados técnicos; movimentações em histórico separado.
- `tickets`: id UUID, tenant_id, requester_id, unit_id, service_location_id ou descrição de local efetivo, asset_id opcional, category_version_id, prioridade, estado, criado_em, protocolo imutável.
- `ticket_events`: id UUID, tenant_id, ticket_id, actor_id, tipo, timestamp, valores anterior/novo, justificativa, visibilidade (pública/interna), metadados; append-only.
- `ticket_messages`: id UUID, tenant_id, ticket_id, actor_id, corpo, visibilidade, criado_em; preservação e auditoria.
- `attachments`: id UUID, tenant_id, ticket_id, uploader_id, storage_key, nome, tamanho, tipo, hash, visibilidade; acesso via autorização no servidor.
- `categories` e `category_versions`: tenant_id, hierarquia e vigência; preservar classificação histórica.
- `protocol_counters`: tenant_id, ano, next_sequence; geração transacional, nunca no navegador.
- `audit_events`: tenant_id opcional, actor_id, operação, recurso, data/hora, contexto, resultado; acesso restrito e retenção definida.

Todas as tabelas com dados de cliente devem carregar `tenant_id` e chaves estrangeiras compostas ou verificações equivalentes que impeçam referências cruzadas. Identificadores públicos não são credenciais.

## Regras de autorização obrigatórias
1. Negar por padrão; autenticação não implica vínculo ativo.
2. Solicitante lê/cria somente chamados de escopo autorizado; protocolo conhecido não concede leitura.
3. Técnico acessa apenas filas, contratos, unidades e serviços autorizados; N1/N2 e modalidade são atributos independentes.
4. Gestor e supervisor veem apenas dados da instituição e escopos explicitamente concedidos.
5. Prestadora pode atender vários clientes, mas o vínculo com um não autoriza acesso ao outro.
6. Operador AnnA One administra plataforma e cadastro institucional, sem leitura irrestrita de conteúdo dos chamados.
7. Acesso e mudanças sensíveis geram eventos de auditoria; revogação não apaga histórico.
8. Controles são aplicados no servidor e no banco, nunca apenas escondendo botões.

## Protocolo público
Formato proposto `CLIENTE-CATEGORIA-ANO-SEQUÊNCIA`; prefixos finais pendentes de confirmação. Contador único por tenant+ano, compartilhado por unidades e categorias, mínimo visual de 8 dígitos, expansível. Alocar somente ao confirmar transação de criação; índices únicos por `(tenant_id, ano, sequencia)` e por protocolo. Reclassificação não muda protocolo. ID interno é UUID independente.

## API mínima candidata (não implementada)
- `POST /auth/session` e `GET /me/contexts` (ou equivalentes do provedor de autenticação escolhido).
- `GET /catalog?tenant=...` com checagem de vínculo.
- `POST /tickets`: criar com idempotência e protocolo atômico; validar categoria, unidade e anexos.
- `GET /tickets`: listar exclusivamente os autorizados.
- `GET /tickets/:id`: consultar somente após autorização por escopo.
- `POST /tickets/:id/messages`: mensagem pública/interna segundo papel.
- `POST /tickets/:id/priority-reviews`: pedido justificado; não altera prioridade automaticamente.
- `POST /tickets/:id/attachments`: validação de tamanho, tipo, varredura e permissão antes de armazenamento.
- `GET /tickets/:id/events`: histórico filtrado por visibilidade e papel.

Não registrar tokens ou dados pessoais em logs de aplicação. Anexos devem ficar privados; links temporários e permissões são emitidos pelo servidor.

## Implantação online/LAN
Manter interface e regras essenciais comuns aos dois modos. Isolar adaptadores de autenticação, persistência, anexos e notificação; nenhuma dependência obrigatória de internet para operações essenciais da instalação local. Escolher stack e política de backup antes de criar migrações.

## Critérios de aceitação antes de conectar o portal
- Usuário A do tenant X não acessa chamado, anexo ou histórico do tenant Y, nem conhecendo o UUID/protocolo.
- Prestadora com contrato em X e Y recebe somente escopos expressamente autorizados em cada um.
- Revogação bloqueia novos acessos e mantém eventos anteriores.
- Dois chamados simultâneos no mesmo tenant/ano recebem protocolos distintos; reclassificação preserva protocolo.
- Sem equipamento vinculado é permitido quando a categoria aceitar.
- Mensagens internas não aparecem ao solicitante; upload inválido é recusado no servidor.
- Eventos registram ator, horário, ação e contexto; nenhum cliente pode alterá-los diretamente.
- Funciona com autenticação e armazenamento reais em ambiente isolado de testes, sem dados de produção.

## Próxima decisão
Definir backend e banco compatíveis com nuvem e LAN, criar migrações versionadas e testes de isolamento; somente depois integrar a UI v0.11.2. **Não declarar Fase 2 concluída até testes de integração, segurança e operação local.**
