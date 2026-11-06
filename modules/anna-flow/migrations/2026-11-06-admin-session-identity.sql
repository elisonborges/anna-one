-- AnnA Flow v1.5.13 — identificação da conta Master na administração central.
-- Não revoga sessões nem altera dados existentes; sessões antigas seguem válidas.
ALTER TABLE flow_master_sessions
 ADD COLUMN IF NOT EXISTS email varchar(254);
