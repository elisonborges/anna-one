# Geração 2 — AnnA Business 1.1.0-dev.69 (incrementos 67–69)

Referência: Plano Diretor AB-PD-001 rev.1, capítulos 14 e 22. Início pela fundação funcional/administrativa, sem cálculo de folha.

- 67: concessões de RH por empresa e usuário Business; criação e revogação explícitas pelo proprietário. O proprietário não lê registros funcionais sem concessão própria. O usuário deve ter associação ativa e perfil owner ou registry_editor, além da identidade Master existente. Não se criam concessões, usuários ou permissões automaticamente.
- 68: catálogo de cargos e setores, vínculo com cadastro corporativo existente, referência funcional e nove tipos de vínculo (CLT, estágio, aprendizagem, autônomo, PJ, sócio, terceirizado, representante, voluntário). Classificação administrativa, não validação jurídica do contrato.
- 69: histórico append-only de mudança de cargo e encerramento, com autor, data, justificativa e identificador de operação; bloqueio de datas anteriores ao último evento, datas futuras, repetição e eventos após encerramento. Interface de gestão responsiva integrada ao painel.
- Migração 050 aditiva, quatro tabelas com RLS forçada, isolamento por tenant e empresa. Sem cópia de CPF, remuneração, saúde, credenciais ou anexos. Dados funcionais não persistidos no navegador. A administração de concessões não concede acesso a documentos, folha ou saúde.

## Testes
Na branch Neon isolada br-sweet-boat-b69532hl, usando a role anna_business_runtime: concessão ausente false; concessão explícita true; dois cargos criados; um vínculo PJ criado; mudança de cargo 1; data retroativa inválida 0; encerramento 1; mudança após encerramento 0; proprietário sem concessão vê 0; revogação bem-sucedida; acesso após revogação 0; terceiro externo vê 0. Sintaxe e integração de navegação conferidas; testes Node e build Wrangler como gates de publicação.

## Ativação
Após publicar, proprietário abre RH e vínculos, escolhe empresa, informa UUID do usuário Business existente (o próprio identificador é mostrado no painel), justificativa e confirmação. Nenhuma concessão é cadastrada pela migração. Usar dados reais apenas em operação autorizada. Conferir o fluxo no navegador com sessão real.

## Limites e próximas prioridades
Homologação visual, autenticação real e concorrência pendentes. Não implementa folha, férias, afastamentos, benefícios, importação de folha processada, eSocial, cálculos tributários, TimeClock ou Access. Não presume classificação trabalhista válida. Próxima etapa proposta: departamento pessoal administrativo, importação controlada de folha processada e integração financeira/contábil, antes de motores oficiais. A segregação dos domínios e a revisão jurídica, contábil e trabalhista são requisitos para a evolução. 
