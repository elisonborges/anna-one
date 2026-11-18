-- Complemento seguro do fluxo de atribuição: controle de novas tentativas de e-mail.
ALTER TABLE teamhub.card_email_notices
  ADD COLUMN IF NOT EXISTS retry_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE teamhub.card_email_notices
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS card_email_notices_retry
  ON teamhub.card_email_notices(status,last_attempt_at)
  WHERE status IN ('queued','failed','not_configured','sending');
