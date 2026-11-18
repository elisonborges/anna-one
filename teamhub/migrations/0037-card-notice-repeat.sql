-- Uma nova atribuição após remoção gera um novo aviso idempotente.
ALTER TABLE teamhub.card_email_notices ADD COLUMN IF NOT EXISTS assignment_count integer NOT NULL DEFAULT 1;
