-- AnnA Flow v0.7: modelo de homologação em Neon, aplicado em anna-flow-dev.
-- As tabelas transacionais multiusuário detalhadas são a próxima migração planejada.
CREATE TABLE IF NOT EXISTS flow_runtime (
 id integer PRIMARY KEY CHECK (id=1),
 revision bigint NOT NULL DEFAULT 0,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO flow_runtime(id,revision,state)
VALUES(1,0,'{"services":["Matrículas","Financeiro","Vendas","Informações"],"counters":{},"queue":[],"current":null,"history":[],"completed":0,"calls":0,"messages":["Bem-vindo ao atendimento.","Seu tempo é importante. Obrigado por aguardar."],"notice":"Tenha os documentos em mãos."}'::jsonb)
ON CONFLICT(id) DO NOTHING;
