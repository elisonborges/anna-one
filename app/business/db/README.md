# Incremento 02 — Fundação persistente

Plano Diretor AB-PD-001, v0.1.0. Migrações aditivas em ordem: 001-foundation.sql, 002-registry-write.sql.

## Entidades
- business.tenants: ambiente interno AnnA One ou cliente isolado; não confundir com pessoa jurídica.
- business.tenant_memberships: autorização explícita por ambiente; não herda privilégios Master.
- core.parties: cadastro PF/PJ com código próprio e CPF/raiz do CNPJ únicos por tenant.
- core.establishments: CNPJ integral, matriz/filial, FK composta que exige a mesma raiz e pessoa jurídica.
- business.party_roles e companies: papéis de cliente, fornecedor e empresa própria, separados da identidade.
- core.institution_links: vínculo do operador com instituição existente, sem duplicar CLI/UUID; data de término exclusiva. A API futura deve validar escopo e impedir sobreposição temporal de períodos fechados.
- business.audit_events: eventos de criação dos comandos transacionais, sem armazenar CPF/CNPJ nos detalhes.

## Validação realizada
Ambiente temporário Neon br-patient-water-b6945ye6, separado de production.
001 aplicada com sucesso; 002 aplicada em transação. O papel de teste NOLOGIN e NOBYPASSRLS recebeu concessões restritas apenas no ambiente temporário.
- CPF/CNPJ: valores de exemplo numéricos e alfanuméricos válidos aceitos; inválidos rejeitados.
- RLS habilitada e forçada em todas as 8 tabelas.
- Criação de uma PJ fictícia e estabelecimento com CNPJ alfanumérico: 1+1 registros e 2 eventos de auditoria.
- Outro tenant sem associação: zero registros e eventos visíveis, tentativa de escrita bloqueada (42501).
- Raiz CNPJ duplicada no mesmo tenant bloqueada (23505).
- Instituição existente preservada; nenhuma alteração em public.* na produção.

A branch temporária contém fixtures exclusivamente para teste. Não promover dados da branch; aplicar apenas as migrações SQL aprovadas à produção. As fixtures, role de teste e concessões não fazem parte dos arquivos de migração.

## Próximo passo para o cadastro online
1. Autorizar PR e aplicação das duas migrações à produção. 001 foi preparada pelo Neon (migration_id e0a26171-6e76-4144-8096-9a2c52530b74); 002 foi validada separadamente na mesma branch. Aplicar 002 somente depois de 001, em transação.
2. Provisionar tenant interno e associação nominal de usuário existente, após confirmação. Não conceder acesso a todos os Masters automaticamente.
3. Implementar API no Worker próprio, usando autenticação existente validada no servidor, identidade vinculada a public.app_users, escopo explicitamente autorizado, papel dedicado sem BYPASSRLS, parâmetros SQL e contexto transacional. O identificador do tenant nunca será confiado isoladamente ao cliente. Não expor URL de conexão ou credenciais no navegador.
4. Conectar formulários de parceiros, empresas próprias e estabelecimentos ao serviço. Garantir validação de dados, duplicidades, reenvio seguro/idempotência, trilha de auditoria e tratamento de erros. Não liberar gravação direta de tabelas por clientes.
5. Expandir papéis, edição, vínculos operacionais e vigências com regras específicas e auditoria.

Os comandos create_party e create_establishment são SECURITY INVOKER e inserem evento de auditoria na mesma instrução. As concessões de runtime ainda não foram feitas. O backend deve limitar acesso à sua própria credencial e chamar os comandos apropriados, não permitir SQL arbitrário. As políticas de leitura não equivalem a autorização para exposição de CPF ou dados sensíveis: a API deve minimizar retornos. A identidade fiscal validada por DV não comprova existência/regularidade perante a Receita Federal.

Não há alterações no frontend, autenticação, Master ou Worker publicado neste incremento. O painel atual segue somente leitura. Não publicar sem autorização.
