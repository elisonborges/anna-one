-- 053: fundações independentes TimeClock e Access. Sem REP, biometria ou hardware.
BEGIN;
CREATE TABLE business.work_access_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL,
 module text NOT NULL CHECK(module IN ('timeclock','access')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES business.tenant_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL))
);
CREATE UNIQUE INDEX work_access_live ON business.work_access_grants(tenant_id,company_id,user_id,module) WHERE revoked_at IS NULL;
ALTER TABLE business.work_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.work_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY work_grant_read ON business.work_access_grants FOR SELECT USING(tenant_id::text=current_setting('anna.tenant_id',true) AND (business.hr_admin(tenant_id) OR user_id::text=current_setting('anna.actor_id',true)));
CREATE POLICY work_grant_insert ON business.work_access_grants FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NULL);
CREATE POLICY work_grant_revoke ON business.work_access_grants FOR UPDATE USING(business.hr_admin(tenant_id) AND revoked_at IS NULL) WITH CHECK(business.hr_admin(tenant_id) AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
CREATE FUNCTION business.work_allowed(p_tenant uuid,p_company uuid,p_module text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $fn$
 SELECT p_tenant::text=current_setting('anna.tenant_id',true) AND EXISTS(SELECT 1 FROM business.work_access_grants g JOIN business.tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id JOIN business.tenants t ON t.id=g.tenant_id WHERE g.tenant_id=p_tenant AND g.company_id=p_company AND g.module=p_module AND g.user_id::text=current_setting('anna.actor_id',true) AND g.revoked_at IS NULL AND m.active AND m.role IN ('owner','registry_editor') AND t.kind='internal' AND t.status='active')
$fn$;
CREATE TABLE business.timeclock_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,party_id uuid NOT NULL,
 started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,voided_by uuid REFERENCES public.app_users(id),void_reason text,void_op uuid,
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,void_op),
 CHECK(ended_at>started_at AND ended_at-started_at<=interval '24 hours'),
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND void_op IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 200 AND void_op IS NOT NULL))
);
CREATE INDEX timeclock_scope ON business.timeclock_entries(tenant_id,company_id,party_id,started_at,ended_at);
CREATE TABLE business.access_zones(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id)
);
CREATE TABLE business.access_authorizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,zone_id uuid NOT NULL,party_id uuid NOT NULL,
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 120),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,revoked_by uuid REFERENCES public.app_users(id),revoke_reason text,revoke_op uuid,
 FOREIGN KEY(tenant_id,company_id,zone_id) REFERENCES business.access_zones(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,revoke_op),
 CHECK(valid_until>valid_from AND valid_until-valid_from<=interval '366 days'),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL AND revoke_op IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 200 AND revoke_op IS NOT NULL))
);
CREATE INDEX access_auth_scope ON business.access_authorizations(tenant_id,company_id,zone_id,party_id,valid_from,valid_until);
CREATE TABLE business.access_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,zone_id uuid NOT NULL,party_id uuid NOT NULL,
 authorization_id uuid,decision text NOT NULL CHECK(decision IN ('authorized','not_authorized')),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,zone_id) REFERENCES business.access_zones(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,party_id) REFERENCES core.parties(tenant_id,id),
 FOREIGN KEY(tenant_id,company_id,authorization_id) REFERENCES business.access_authorizations(tenant_id,company_id,id),
 UNIQUE(tenant_id,operation_id),CHECK((decision='authorized')=(authorization_id IS NOT NULL))
);
ALTER TABLE business.timeclock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.timeclock_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY timeclock_entries_read ON business.timeclock_entries FOR SELECT USING(business.work_allowed(tenant_id,company_id,'timeclock'));
CREATE POLICY timeclock_entries_insert ON business.timeclock_entries FOR INSERT WITH CHECK(business.work_allowed(tenant_id,company_id,'timeclock') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.timeclock_entries FROM PUBLIC;
GRANT SELECT,INSERT ON business.timeclock_entries TO anna_business_runtime;
ALTER TABLE business.access_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.access_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY access_zones_read ON business.access_zones FOR SELECT USING(business.work_allowed(tenant_id,company_id,'access'));
CREATE POLICY access_zones_insert ON business.access_zones FOR INSERT WITH CHECK(business.work_allowed(tenant_id,company_id,'access') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.access_zones FROM PUBLIC;
GRANT SELECT,INSERT ON business.access_zones TO anna_business_runtime;
ALTER TABLE business.access_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.access_authorizations FORCE ROW LEVEL SECURITY;
CREATE POLICY access_authorizations_read ON business.access_authorizations FOR SELECT USING(business.work_allowed(tenant_id,company_id,'access'));
CREATE POLICY access_authorizations_insert ON business.access_authorizations FOR INSERT WITH CHECK(business.work_allowed(tenant_id,company_id,'access') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.access_authorizations FROM PUBLIC;
GRANT SELECT,INSERT ON business.access_authorizations TO anna_business_runtime;
ALTER TABLE business.access_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.access_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY access_checks_read ON business.access_checks FOR SELECT USING(business.work_allowed(tenant_id,company_id,'access'));
CREATE POLICY access_checks_insert ON business.access_checks FOR INSERT WITH CHECK(business.work_allowed(tenant_id,company_id,'access') AND created_by::text=current_setting('anna.actor_id',true));
REVOKE ALL ON business.access_checks FROM PUBLIC;
GRANT SELECT,INSERT ON business.access_checks TO anna_business_runtime;
CREATE POLICY timeclock_void ON business.timeclock_entries FOR UPDATE USING(business.work_allowed(tenant_id,company_id,'timeclock') AND voided_at IS NULL) WITH CHECK(business.work_allowed(tenant_id,company_id,'timeclock') AND voided_by::text=current_setting('anna.actor_id',true) AND voided_at IS NOT NULL);
CREATE POLICY access_auth_revoke ON business.access_authorizations FOR UPDATE USING(business.work_allowed(tenant_id,company_id,'access') AND revoked_at IS NULL) WITH CHECK(business.work_allowed(tenant_id,company_id,'access') AND revoked_by::text=current_setting('anna.actor_id',true) AND revoked_at IS NOT NULL);
GRANT UPDATE(voided_at,voided_by,void_reason,void_op) ON business.timeclock_entries TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.access_authorizations TO anna_business_runtime;
REVOKE ALL ON business.work_access_grants FROM PUBLIC;
GRANT SELECT,INSERT ON business.work_access_grants TO anna_business_runtime;
GRANT UPDATE(revoked_at,revoked_by,revoke_reason,revoke_op) ON business.work_access_grants TO anna_business_runtime;
CREATE FUNCTION business.record_timeclock(p_company uuid,p_party uuid,p_start timestamptz,p_end timestamptz,p_ref text,p_op uuid) RETURNS TABLE(entry_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.timeclock_entries(tenant_id,company_id,party_id,started_at,ended_at,reference,operation_id,created_by)
 SELECT p.tenant_id,p_company,p.id,p_start,p_end,btrim(p_ref),p_op,current_setting('anna.actor_id',true)::uuid FROM core.parties p
 WHERE p.tenant_id=current_setting('anna.tenant_id',true)::uuid AND p.id=p_party AND p.kind='PF' AND p.status='active' AND business.work_allowed(p.tenant_id,p_company,'timeclock') AND p_end>p_start AND p_end<=now() AND p_end-p_start<=interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM business.timeclock_entries e WHERE e.tenant_id=p.tenant_id AND e.company_id=p_company AND e.party_id=p.id AND e.voided_at IS NULL AND e.started_at<p_end AND e.ended_at>p_start)
 ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.create_access_authorization(p_company uuid,p_zone uuid,p_party uuid,p_from timestamptz,p_until timestamptz,p_ref text,p_op uuid) RETURNS TABLE(authorization_id uuid) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH added AS (INSERT INTO business.access_authorizations(tenant_id,company_id,zone_id,party_id,valid_from,valid_until,reference,operation_id,created_by)
 SELECT z.tenant_id,z.company_id,z.id,p.id,p_from,p_until,btrim(p_ref),p_op,current_setting('anna.actor_id',true)::uuid FROM business.access_zones z JOIN core.parties p ON p.tenant_id=z.tenant_id AND p.id=p_party AND p.kind='PF' AND p.status='active'
 WHERE z.tenant_id=current_setting('anna.tenant_id',true)::uuid AND z.company_id=p_company AND z.id=p_zone AND business.work_allowed(z.tenant_id,z.company_id,'access') AND p_until>p_from AND p_until>now() AND p_until-p_from<=interval '366 days'
 AND NOT EXISTS(SELECT 1 FROM business.access_authorizations a WHERE a.tenant_id=z.tenant_id AND a.company_id=z.company_id AND a.zone_id=z.id AND a.party_id=p.id AND a.revoked_at IS NULL AND a.valid_from<p_until AND a.valid_until>p_from)
 ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM added
$fn$;
CREATE FUNCTION business.record_access_check(p_company uuid,p_zone uuid,p_party uuid,p_op uuid) RETURNS TABLE(check_id uuid,decision text) LANGUAGE sql SECURITY INVOKER AS $fn$
 WITH candidate AS (SELECT z.tenant_id,z.company_id,z.id AS zone_id,p.id AS party_id,a.id AS authorization_id FROM business.access_zones z JOIN core.parties p ON p.tenant_id=z.tenant_id AND p.id=p_party AND p.kind='PF' AND p.status='active' LEFT JOIN LATERAL(SELECT id FROM business.access_authorizations a WHERE a.tenant_id=z.tenant_id AND a.company_id=z.company_id AND a.zone_id=z.id AND a.party_id=p.id AND a.revoked_at IS NULL AND now()>=a.valid_from AND now()<a.valid_until ORDER BY a.valid_from DESC,a.id LIMIT 1)a ON true WHERE z.tenant_id=current_setting('anna.tenant_id',true)::uuid AND z.company_id=p_company AND z.id=p_zone AND business.work_allowed(z.tenant_id,z.company_id,'access')),
 added AS (INSERT INTO business.access_checks(tenant_id,company_id,zone_id,party_id,authorization_id,decision,operation_id,created_by) SELECT tenant_id,company_id,zone_id,party_id,authorization_id,CASE WHEN authorization_id IS NULL THEN 'not_authorized' ELSE 'authorized' END,p_op,current_setting('anna.actor_id',true)::uuid FROM candidate ON CONFLICT DO NOTHING RETURNING id,access_checks.decision) SELECT id,added.decision FROM added
$fn$;
REVOKE ALL ON FUNCTION business.work_allowed(uuid,uuid,text),business.record_timeclock(uuid,uuid,timestamptz,timestamptz,text,uuid),business.create_access_authorization(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid),business.record_access_check(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.work_allowed(uuid,uuid,text),business.record_timeclock(uuid,uuid,timestamptz,timestamptz,text,uuid),business.create_access_authorization(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid),business.record_access_check(uuid,uuid,uuid,uuid) TO anna_business_runtime;
COMMIT;
