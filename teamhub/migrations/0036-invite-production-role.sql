-- Convite para card preserva função operacional e meta individual até o aceite.
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS production_role text
 CHECK(production_role IN ('operator','inspector','viewer'));
ALTER TABLE teamhub.invitations ADD COLUMN IF NOT EXISTS individual_target numeric(16,3)
 CHECK(individual_target IS NULL OR individual_target>=0);
