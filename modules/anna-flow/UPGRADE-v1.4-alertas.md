# AnnA Flow v1.4 — Alertas do painel TV

## Escopo implementado
- Controle **Ativar som / Desativar som** no rodapé do painel.
- O som é desligado ao abrir ou recarregar a TV; requer clique explícito para liberar áudio no navegador.
- Toque sintetizado localmente por Web Audio API (dois tons); sem arquivos externos ou custos.
- Realce visual da nova chamada e da rechamada, respeitando preferência por movimento reduzido.
- Guichê da chamada exibida recebe destaque na lista dos guichês ativos.
- Detecção por evento (senha, guichê, data/hora da chamada/rechamada e contador), com proteção contra chamadas antigas e requisições de atualização sobrepostas.
- Se o navegador não disponibilizar áudio, os avisos visuais continuam.

## Verificação isolada
Executados 9 testes com JavaScript real de `panel.js` e DOM/áudio simulados: consulta inicial, ausência de toque na abertura, ativação por clique, alerta de nova senha, atualização da senha principal, exibição de dois guichês, alerta de rechamada, ausência de alerta ao retornar a atendimento antigo, e silêncio após desativar o som. **9/9 aprovados.**

## Pendências antes do deploy
Teste manual em navegador real, TV e sistema de áudio; verificar integração com Neon real e autorização do dispositivo. Nenhuma alteração no banco de produção, no Render ou na branch `main` foi realizada nesta versão.
