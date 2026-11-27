-- 068: diário contábil gerencial imutável, não escrituração oficial.
BEGIN;
CREATE TABLE business.ledger_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[0-9A-Z][0-9A-Z._-]{0,39}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 kind text NOT NULL CHECK(kind IN ('asset','liability','equity','revenue','expense')),
 operation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,company_id,code),UNIQUE(tenant_id,operation_id));
CREATE FUNCTION business.ledger_lines_valid(p_tenant uuid,p_company uuid,p_lines jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,business AS $fn$
DECLARE l jsonb; aid uuid; a numeric; d numeric:=0; c numeric:=0;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 2 AND 100 THEN RETURN false; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (l ?& ARRAY['account_id','side','amount']) OR (l-'account_id'-'side'-'amount')<>'{}'::jsonb OR jsonb_typeof(l->'amount') IS DISTINCT FROM 'string' OR COALESCE(l->>'amount','') !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$' OR COALESCE(l->>'side','') NOT IN ('debit','credit') THEN RETURN false; END IF;
  aid:=(l->>'account_id')::uuid; a:=(l->>'amount')::numeric;
  IF a<=0 OR NOT EXISTS(SELECT 1 FROM business.ledger_accounts WHERE tenant_id=p_tenant AND company_id=p_company AND id=aid) THEN RETURN false; END IF;
  IF l->>'side'='debit' THEN d:=d+a; ELSE c:=c+a; END IF;
 END LOOP;
 RETURN d=c AND d>0 AND d<=9999999999999999.99;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $fn$;
CREATE FUNCTION business.ledger_reverse_lines(p_lines jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT jsonb_agg(jsonb_set(l,'{side}',to_jsonb(CASE l->>'side' WHEN 'debit' THEN 'credit' ELSE 'debit' END)) ORDER BY n) FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(l,n)
$fn$;
CREATE TABLE business.ledger_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,company_id uuid NOT NULL,
 posted_on date NOT NULL CHECK(posted_on BETWEEN date '2000-01-01' AND date '2100-12-31'),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 300),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 lines jsonb NOT NULL,reversal_of uuid,operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES business.companies(tenant_id,party_id),
 UNIQUE(tenant_id,company_id,id),UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,reversal_of),
 FOREIGN KEY(tenant_id,company_id,reversal_of) REFERENCES business.ledger_entries(tenant_id,company_id,id),
 CHECK(reversal_of IS NULL OR reversal_of<>id));
ALTER TABLE business.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ledger_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE business.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business.ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_account_read ON business.ledger_accounts FOR SELECT USING(business.hr_admin(tenant_id));
CREATE POLICY ledger_account_insert ON business.ledger_accounts FOR INSERT WITH CHECK(business.hr_admin(tenant_id) AND created_by::text=current_setting('anna.actor_id',true));
CREATE POLICY ledger_entry_read ON business.ledger_entries FOR SELECT USING(business.hr_admin(tenant_id));
CREATE FUNCTION business.ledger_entry_valid(p_tenant uuid,p_company uuid,p_date date,p_lines jsonb,p_reverse uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,business AS $fn$
 SELECT business.hr_admin(p_tenant) AND current_setting('transaction_isolation')='serializable' AND p_date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND NOT business.management_period_closed(p_tenant,p_company,p_date) AND business.ledger_lines_valid(p_tenant,p_company,p_lines)
 AND (p_reverse IS NULL OR EXISTS(SELECT 1 FROM business.ledger_entries e WHERE e.tenant_id=p_tenant AND e.company_id=p_company AND e.id=p_reverse AND e.reversal_of IS NULL AND e.posted_on<=p_date AND business.ledger_reverse_lines(e.lines)=p_lines))
$fn$;
CREATE POLICY ledger_entry_insert ON business.ledger_entries FOR INSERT WITH CHECK(created_by::text=current_setting('anna.actor_id',true) AND business.ledger_entry_valid(tenant_id,company_id,posted_on,lines,reversal_of));
REVOKE ALL ON business.ledger_accounts,business.ledger_entries FROM PUBLIC;
REVOKE ALL ON FUNCTION business.ledger_lines_valid(uuid,uuid,jsonb),business.ledger_reverse_lines(jsonb),business.ledger_entry_valid(uuid,uuid,date,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.ledger_lines_valid(uuid,uuid,jsonb),business.ledger_reverse_lines(jsonb),business.ledger_entry_valid(uuid,uuid,date,jsonb,uuid) TO anna_business_runtime;
GRANT SELECT,INSERT ON business.ledger_accounts,business.ledger_entries TO anna_business_runtime;
COMMIT;
