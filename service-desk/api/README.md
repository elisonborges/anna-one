# AnnA Service Desk — Conexão isolada com PostgreSQL

A API agora possui verificação de conexão no servidor, **sem expor chamados**.

## Preparação local
Requer Node.js 20+ e PostgreSQL acessível. Dentro de `service-desk/api`:

```sh
npm install
DATABASE_URL='postgresql://USUARIO:SENHA@HOST/BANCO?sslmode=require' npm start
```

**Não** registrar a URL real em arquivos versionados, logs ou no navegador. Usar variável de ambiente/gerenciador de segredos. `npm install` gera lockfile; ele deve ser revisado e versionado antes de implantar. O driver `pg` está fixado na versão `8.16.3`.

A API escuta apenas em `127.0.0.1:8787` por padrão. `GET /health` retorna `database: reachable` se `SELECT 1` funcionar, `not-configured` sem URL e `unavailable` (HTTP 503) em falha. O endpoint não consulta tabelas de clientes.

**Segurança:** não usar o usuário proprietário/administrador do banco para a aplicação. Criar credencial exclusiva de menor privilégio antes de conectar à infraestrutura. Ainda não há autenticação, endpoints de chamados ou integração com o portal. O endpoint de diagnóstico não comprova permissões RLS.

## Validação
```sh
npm test
curl -s http://127.0.0.1:8787/health
```

**Limites da entrega:** código publicado no GitHub, mas a URL do Neon não foi configurada na API e não houve execução do servidor contra o banco. Testes de rede e integração pendentes.
