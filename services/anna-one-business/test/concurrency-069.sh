#!/usr/bin/env bash
# PostgreSQL disposable integration test; never run against a real database.
set -euo pipefail
: "${PGHOST:?Use the disposable CI PostgreSQL service}"
: "${PGDATABASE:?Use the disposable CI database}"
[[ "$PGHOST" == "127.0.0.1" && "$PGDATABASE" == "anna_concurrency_test" ]] || { echo "Disposable database required"; exit 1; }
repo=$(cd "$(dirname "$0")/../../.." && pwd)
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA business;
CREATE ROLE anna_business_runtime NOLOGIN;
CREATE TABLE business.companies(tenant_id uuid,party_id uuid,PRIMARY KEY(tenant_id,party_id));
CREATE FUNCTION business.hr_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE business.financial_installments(id int PRIMARY KEY,remaining numeric,revision int);
CREATE TABLE business.financial_settlements(id int PRIMARY KEY);
CREATE TABLE business.financial_reversals(id int PRIMARY KEY);
CREATE TABLE business.stock_movements(id int PRIMARY KEY);
CREATE TABLE business.stock_controls(id int PRIMARY KEY);
CREATE TABLE business.purchase_requests(id int PRIMARY KEY,revision int);
CREATE TABLE business.purchase_orders(id int PRIMARY KEY,revision int);
CREATE TABLE business.management_period_events(tenant_id uuid,company_id uuid,period_on date,status text);
CREATE TABLE business.ledger_entries(tenant_id uuid,company_id uuid,posted_on date);
CREATE FUNCTION business.management_period_closed(t uuid,c uuid,d date) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM business.management_period_events WHERE tenant_id=t AND company_id=c AND period_on=d AND status='closed') $$;
CREATE FUNCTION business.guard_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
INSERT INTO business.companies VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
INSERT INTO business.financial_installments VALUES(1,100,1);
INSERT INTO business.purchase_requests VALUES(1,1);
INSERT INTO business.purchase_orders VALUES(1,1);
SQL
psql -X -v ON_ERROR_STOP=1 -f "$repo/app/business/db/069-critical-concurrency.sql"
# Every critical trigger rejects nonserializable writes.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 BEGIN UPDATE business.financial_installments SET remaining=1 WHERE id=1; RAISE EXCEPTION 'financial guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN INSERT INTO business.financial_settlements VALUES(1); RAISE EXCEPTION 'settlement guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN INSERT INTO business.financial_reversals VALUES(1); RAISE EXCEPTION 'reversal guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN INSERT INTO business.stock_movements VALUES(1); RAISE EXCEPTION 'stock guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN INSERT INTO business.stock_controls VALUES(1); RAISE EXCEPTION 'control guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN UPDATE business.purchase_requests SET revision=2 WHERE id=1; RAISE EXCEPTION 'request guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN UPDATE business.purchase_orders SET revision=2 WHERE id=1; RAISE EXCEPTION 'order guard missing'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SQL
# Independent backend sessions with a verified overlapping lock wait.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
t=00000000-0000-4000-8000-000000000001
c=00000000-0000-4000-8000-000000000002
PGAPPNAME=anna107_close psql -X -v ON_ERROR_STOP=1 >"$tmp/a" 2>&1 <<SQL &
BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO business.management_period_events VALUES('$t','$c','2026-01-01','closed');
SELECT pg_sleep(8);
COMMIT;
SQL
a=$!
for i in $(seq 1 50); do
  [[ "$(psql -XAtc "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna107_close' AND wait_event='PgSleep'")" == 1 ]] && break
  sleep 0.1
done
[[ "$(psql -XAtc "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna107_close' AND wait_event='PgSleep'")" == 1 ]]
PGAPPNAME=anna107_post psql -X -v ON_ERROR_STOP=1 >"$tmp/b" 2>&1 <<SQL &
\\set VERBOSITY verbose
BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO business.ledger_entries VALUES('$t','$c','2026-01-10');
COMMIT;
SQL
b=$!
overlap=0
for i in $(seq 1 50); do
  if [[ "$(psql -XAtc "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna107_post' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")" == 1 ]]; then overlap=1; break; fi
  sleep 0.1
done
wait "$a"
set +e; wait "$b"; rc=$?; set -e
[[ "$overlap" == 1 && "$rc" != 0 ]] || { cat "$tmp/a" "$tmp/b"; exit 1; }
grep -q '40001' "$tmp/b" || { cat "$tmp/b"; exit 1; }
[[ "$(psql -XAtc 'SELECT count(*) FROM business.ledger_entries')" == 0 ]]
[[ "$(psql -XAtc 'SELECT count(*) FROM business.management_period_events')" == 1 ]]
echo 'PASS: two independent PostgreSQL sessions overlapped; period fence rejected concurrent posting (40001).'
