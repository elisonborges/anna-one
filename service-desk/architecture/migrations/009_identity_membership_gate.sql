-- Apply in the isolated Neon database only.
-- Local login may verify active membership without granting access to tickets.
BEGIN;
GRANT SELECT ON anna_sd.memberships TO anna_sd_identity_runtime;
CREATE POLICY identity_active_membership_read ON anna_sd.memberships
 FOR SELECT TO anna_sd_identity_runtime
 USING (status='active');
COMMIT;
