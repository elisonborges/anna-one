# AnnA Flow — impressão e numeração diária (v1.5.16)

## Comprovante padronizado

Instituição, unidade, senha em destaque, Normal/Preferencial, serviço, emissão (dia e hora), início previsto do atendimento (dia e hora), orientação para acompanhar o painel. Sem dados pessoais. O início previsto é configurável pela instituição e não equivale à chamada efetiva. Se não configurado: "Não informado".

Papel térmico de 58 mm, 80 mm e A4, configurável por unidade. A primeira versão usa impressão manual do navegador pelo driver do sistema operacional. Não inclui impressão silenciosa ou automática. O rodapé identifica o sistema e versão: AnnA Flow · Versão 1.5.16.

## Política de numeração

Números separados por serviço e prioridade: A-serviço-NNN e P-serviço-NNN. Administrador configura número inicial por unidade (1 a 999999), horário previsto de abertura e fuso. A alteração do número inicial se aplica ao próximo dia de emissão; senhas já emitidas não são renumeradas. Primeira migração aproveita os contadores anteriores, evitando reiniciar numeração em operação. A emissão é transacional e verifica colisão com senhas ainda pendentes. Não interfere com a transferência de senhas, que preserva código, prioridade e histórico.

## Famílias de impressoras a contemplar

- Impressoras comuns de escritório A4, laser/jato de tinta: USB, Ethernet, Wi-Fi, via driver do sistema.
- Impressoras térmicas genéricas ESC/POS 58/80 mm: USB, serial, Ethernet, Bluetooth SPP. Via driver; posteriormente agente local.
- Epson: TM-T20X, TM-T20X-II, TM-T88VII, TM-T70II, TM-m30, TM-P80 e outras TM com driver/ePOS conforme versão.
- Elgin: i7, i8, i9, MP-4200 HS e compatíveis ESC/POS.
- Star: TSP100IV, TSP143IV, mC-Print2, mC-Print3, TSP650II, TSP700II; WebPRNT/CloudPRNT somente para variantes habilitadas.
- Zebra móveis ZQ220 Plus, ZQ310/ZQ320 Plus: drivers ou linguagem CPCL/ZPL conforme variante.
- Brother RJ/RuggedJet e outras impressoras móveis: via driver ou SDK específico.
- Outras marcas/OEM: avaliar por comando, driver e modelo exatos, não presumir compatibilidade universal.

Estas famílias são uma meta de cobertura, **não equipamentos já homologados fisicamente**. Bluetooth SPP não é Web Bluetooth BLE. WebUSB e WebSerial têm suporte limitado. CloudPRNT exige protocolo e serviço compatíveis. Registrar resultado de teste por impressora e dispositivo.

## Referências públicas

- Epson Brasil: https://epson.com.br/Para-empresas/Ponto-de-venda/c/w7
- Epson TM-T20X: https://epson.com.br/Para-empresas/Impressoras/Impressoras-de-Pontos-de-Venda/Impressora-de-Recibos-Epson-TM-T20X-%28Serial-USB%29/p/C31CH26031
- Elgin térmicas: https://www.elgin.com.br/automacao-comercial/impressora-termica-de-cupom
- Elgin MP-4200 HS: https://www.elgin.com.br/impressora-termica-nao-fiscal-mp-4200-hs/p
- Star: https://starmicronics.com/technology/cloudprnt e https://star-emea.com/products/webprnt/
- Zebra: https://www.zebra.com/br/pt/support-downloads/printers/mobile/zq220.html
- WebUSB: https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
- WebSerial: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API

## Referências competitivas

Pesquisa anterior: Qmatic (gestão/TV), Qminder (console/filas) e SuaFila (emissão/chamada). Transferência entre serviços sem novo número já aprovada. Waitwhile oferece IDs genéricos e por serviço, e Qmatic combina quiosques, ticket printers e métricas. Próximas oportunidades: QR code opcional, métricas de tempo de espera e impressão direta por conector homologado.

## Situação da implementação

Implementado na branch de desenvolvimento: acompanhamento institucional somente leitura por unidade, visualização de filas, guichês e histórico, configuração do número inicial diário, horário previsto de abertura, fuso e formato do papel; comprovante de senha com emissão e identificação do sistema. A impressão usa a caixa de diálogo do navegador. **Não há homologação física de modelos de impressora, impressão automática, integração ESC/POS direta, nem garantia de início efetivo do atendimento no comprovante emitido previamente.**

## v1.5.17 — validação sem emissão real

A tela de emissão inclui **Prévia / teste de impressão (sem emitir senha)**. O comprovante utiliza dados demonstrativos e contém a marca **AMOSTRA — NÃO VÁLIDA** tanto na tela quanto no papel. Esse teste não chama a API de emissão, não altera contadores e não entra na fila. Ao emitir senha verdadeira, a marca desaparece. A troca de unidade limpa o comprovante anterior para evitar imprimir dados da unidade errada.

Roteiro para homologar impressoras: abrir a tela em sessão operacional autorizada; selecionar 58 mm, 80 mm ou A4; gerar amostra; imprimir pelo diálogo do navegador; conferir legibilidade, largura, corte, acentuação, data/hora, início previsto e identificação AnnA Flow v1.5.17. Anotar fabricante, modelo, conexão, sistema operacional, navegador, driver e resultado. **Não confirmar compatibilidade física sem esse teste no equipamento.**
