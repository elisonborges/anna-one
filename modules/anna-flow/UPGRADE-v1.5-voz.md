# AnnA Flow v1.5 — chamada por voz

Implementação incremental sobre a v1.4 na branch `feature/anna-flow-v1.5-voz`.

## Recursos
- Web Speech API do navegador para anunciar senha e destino em português do Brasil.
- Voz desativada inicialmente; clique explícito para ativação. Mensagem inicial confirma a ativação.
- Controle de velocidade (0,7× a 1,3×) e volume (0% a 100%).
- Locução em chamadas e rechamadas; sem repetir avisos de chamadas antigas.
- A locução substitui o toque nessa chamada, sem sobreposição com os dois tons da v1.4.
- Quando a voz está desligada, os tons opcionais continuam disponíveis.
- Sem dependência externa e sem modificações no banco.

## Testes isolados
Foram executados 9 testes em DOM, síntese de voz e API de áudio simulados, usando o JavaScript real: sem locução inicial; ativação por clique; senha e guichê corretos; velocidade e volume; sem sino simultâneo; rechamada; chamada antiga; voz desativada; sino com voz desligada. Resultado: 9/9 aprovados.

## Antes de considerar produção homologada
Validar manualmente no navegador e TV reais com alto-falante, política de liberação de áudio, vozes pt-BR instaladas, chamadas simultâneas e integração com Neon. A voz depende do suporte a SpeechSynthesis no navegador e do pacote de vozes do dispositivo; se indisponível, a UI conserva alertas visuais.

Nenhuma alteração de banco, DNS ou configuração de Render feita neste desenvolvimento.
