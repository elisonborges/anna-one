# AnnA Flow — Painel TV v1: especificação funcional

Status: especificação, não implementação. Não publicada.

## Estrutura
1. Cabeçalho compacto: marca, instituição/unidade, orientações, data e relógio.
2. Chamando agora (principal, aproximadamente 55%): senha grande, guichê/destino, serviço e estado vazio.
3. Comunicação institucional (aproximadamente 45%): mensagens, vídeo ou mídia local autorizada.
4. Últimas chamadas: até quatro registros, senha, destino e estado.
5. Filas por serviço: serviços vinculados ao painel e quantidades reais aguardando.
6. Rodapé discreto: conexão e tela cheia.

## Critérios de comportamento
- Painel horizontal 16:9 prioritário, legível à distância e responsivo.
- Nova chamada recebe destaque visual temporário, respeitando redução de movimento.
- Sem chamada: apresentar Aguarde sua chamada.
- Sem serviços: mostrar orientação clara, nunca contagens inventadas.
- Perda de conexão: indicar sem conexão, sem apresentar dados como atuais.
- Não mostrar tempo estimado de espera sem algoritmo e dados validados.
- Preservar temas escuro, claro e acolhedor e a mídia local IndexedDB.

## Integrações já confirmadas
- panel.html: cabeçalho, chamada, comunicação, histórico e filas.
- panel.js: atualiza via polling, relógio e animação de chamada.
- panel-api.js: fornece perfil, atual, histórico, contagem por serviço e revisão.
- panel-config.js: vinculação de serviços para o painel.
- local-player.js: conteúdo multimídia armazenado no navegador da TV.

## Segurança e escopo
- Manter GET /api/panel com chave do painel e autorização de equipamento quando aplicável.
- Mostrar somente serviços vinculados à unidade/painel.
- Não alterar banco de dados, emissão de senha nem lógica da fila nesta etapa.
- Não incluir dados pessoais no painel público.

## Primeira implementação
- Refinar panel.html e panel.js sem remover IDs consumidos por outros scripts.
- Testar estados: vazio, chamada, histórico, sem serviços, mídia e falha de rede.
- Desenvolver incrementalmente na branch feature/anna-flow-online.
- Não publicar no Render nem na branch principal sem autorização.