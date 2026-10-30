-- AnnA Flow: esboço inicial, NÃO aplicado em banco.
-- Revisar regras de prioridades, autenticação e índices antes da primeira migração.
CREATE TABLE IF NOT EXISTS flow_organizations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flow_units (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id bigint NOT NULL REFERENCES flow_organizations(id),
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flow_services (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 unit_id bigint NOT NULL REFERENCES flow_units(id),
 name text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 UNIQUE(unit_id,name)
);
CREATE TABLE IF NOT EXISTS flow_tickets (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 service_id bigint NOT NULL REFERENCES flow_services(id),
 issue_date date NOT NULL,
 number integer NOT NULL CHECK(number > 0),
 priority text NOT NULL CHECK(priority IN ('normal','preferencial')),
 status text NOT NULL DEFAULT 'aguardando' CHECK(status IN ('aguardando','chamado','concluido','cancelado')),
 destination text,
 issued_at timestamptz NOT NULL DEFAULT now(),
 called_at timestamptz,
 completed_at timestamptz,
 UNIQUE(service_id,issue_date,priority,number)
);
CREATE INDEX IF NOT EXISTS flow_tickets_waiting_idx ON flow_tickets(service_id,issued_at) WHERE status='aguardando';
