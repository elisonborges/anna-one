# AnnA Flow v1.5.18 — Modalidades de atendimento e convênios

## Objetivo
Tornar opcional o fluxo inspirado em terminais de atendimento hospitalar: **Normal ou Preferencial → Particular ou Convênio → nome do convênio → Serviço → Emitir senha**.

## Administração institucional
Na guia Atendimento, cada unidade tem um editor de modalidades: ativar/desativar, permitir Particular e cadastrar até 30 nomes de convênios (um por linha, sem duplicados). Nenhuma instituição é migrada automaticamente: o padrão permanece desativado até decisão do administrador. Configurações são isoladas pela unidade e autorizadas pelo vínculo do administrador.

## Emissão e filas
A tela de emissão usa botões grandes para Normal/Preferencial; mostra a etapa de modalidade somente quando habilitada. Ao selecionar Convênio, exige a escolha de um nome cadastrado. O servidor valida a opção com o cadastro atual da unidade antes de colocar a senha na fila. Os dados são metadados administrativos, sem nome de paciente, matrícula, carteira ou documento. O identificador de senha, a prioridade e o serviço seguem as regras existentes; o número não muda por ser Particular ou Convênio. Transferências preservam a modalidade e o convênio. O comprovante apresenta a modalidade quando houver.

## Restrições e futuras evoluções
Escolher um convênio no totem **não verifica elegibilidade, cobertura ou autorização**. O cadastro registra apenas a opção selecionada, sem solicitar dados pessoais e sem integrar operadoras. Não mostrar modalidade/convênio em TV pública. A tela continua compatível com instituições sem convênios. Não realizar alterações em filas reais para testar; usar testes de validação e impressão de amostra. Impressão automática e homologação de hardware seguem pendentes.

## Verificações
Validação sintática e estrutural de arquivos, regras de modalidade, integridade de serviços/guichês e permissões de administrador e dispositivos; testes unitários versionados em tests/coverage-options.test.cjs. Testes autenticados e físicos permanecem pendentes. Não houve alteração manual no Neon.
