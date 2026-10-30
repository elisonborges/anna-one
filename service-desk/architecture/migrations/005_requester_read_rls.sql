-- AnnA Service Desk: requester-scoped read access, server-only identity.
-- The runtime role MUST NOT be exposed to browser clients.
BEGIN;
GRANT USAGE ON SCHEMA anna_sd TO anna_sd_api_runtime;
GRANT SELECT ON anna_sd.memberships, anna_sd.tickets TO anna_sd_api_runtime;
CREATE POLICY api_own_memberships ON anna_sd.memberships FOR SELECT TO anna_sd_api_runtime USING (
  user_id = NULLIF(current_setting('anna_sd.actor_id', true), '')::uuid
  AND status = 'active'
);
CREATE POLICY api_own_tickets ON anna_sd.tickets FOR SELECT TO anna_sd_api_runtime USING (
  requester_id = NULLIF(current_setting('anna_sd.actor_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM anna_sd.memberships m
    WHERE m.tenant_id = tickets.tenant_id
      AND m.user_id = tickets.requester_id
      AND m.status = 'active'
      AND (m.unit_id IS NULL OR m.unit_id = tickets.unit_id)
  )
);
COMMIT;
