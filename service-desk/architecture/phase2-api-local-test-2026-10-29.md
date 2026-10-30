# AnnA Service Desk — execução de testes da API

**Data:** 2026-10-29 (continuidade). **Ambiente:** Node.js v22.16.0 local, sem conexão com Neon.

Comando: `node --test *.test.cjs`. Resultado: **4 testes aprovados, 0 falhas**.

Cobertura: token assinado válido; tokens expirados, audiência incorreta, sujeito inválido e `nbf` futuro; transação `BEGIN READ ONLY` com `SET LOCAL ROLE anna_sd_api_runtime` e identidade parametrizada; `COMMIT` após leitura; `ROLLBACK` e resposta 503 sem detalhes internos em falha simulada; endpoint `/health` e bloqueio HTTP 401 de acesso sem token.

Correções publicadas: limite de tamanho de cabeçalho Authorization, validação `nbf` inteira, transação read-only, teste de rollback.

**Limites:** banco simulado no teste do handler; sem credencial de runtime configurada, sem implantação HTTP ligada ao Neon, sem provedor real de emissão de JWT, sem testes de revogação. A função de verificação HS256 só deve aceitar tokens emitidos por um serviço de identidade confiável com segredo exclusivo e protegido. Não considerar pronta para produção.
