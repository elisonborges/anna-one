#!/usr/bin/env bash
# Executar somente no PostgreSQL descartável da CI.
set -euo pipefail
[[ "${PGHOST:-}" == "127.0.0.1" && "${PGDATABASE:-}" == "anna_concurrency_test" ]] || exit 1
repo=$(cd "$(dirname "$0")/../../.." && pwd)
psql -X -v ON_ERROR_STOP=1 -f "$repo/services/anna-one-business/test/fixtures/concurrency-108.sql"
psql -X -v ON_ERROR_STOP=1 -f "$repo/app/business/db/069-critical-concurrency.sql"
t=00000000-0000-4000-8000-000000000001
c=00000000-0000-4000-8000-000000000002
u=00000000-0000-4000-8000-000000000003
i=00000000-0000-4000-8000-000000000004
o=00000000-0000-4000-8000-000000000005
p=00000000-0000-4000-8000-000000000006
k=00000000-0000-4000-8000-000000000007
w=00000000-0000-4000-8000-000000000008
e=00000000-0000-4000-8000-000000000009
r=00000000-0000-4000-8000-000000000010
q=00000000-0000-4000-8000-000000000011
s=00000000-0000-4000-8000-000000000012
day="(now() AT TIME ZONE 'America/Fortaleza')::date"
ctx="SELECT set_config('anna.tenant_id','$t',true),set_config('anna.actor_id','$u',true);"
psql -X -v ON_ERROR_STOP=1 <<SQL
BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO business.companies VALUES('$t','$c');
INSERT INTO business.tenant_memberships VALUES('$t','$u',true,'owner');
INSERT INTO business.financial_obligations VALUES('$t','$o',$day);
INSERT INTO business.financial_installments VALUES('$t','$i','$o',100,1,'open');
INSERT INTO business.catalog_items VALUES('$t','$k','active','product','unit');
INSERT INTO business.stock_products VALUES('$t','$p','$c','$k','unit','none');
INSERT INTO core.establishments VALUES('$t','$e','active');
INSERT INTO business.warehouses VALUES('$t','$w','$c','$e');
$ctx
SELECT * FROM business.create_stock_movement('$p',0,'entry',$day,NULL,'$w','',10,'Fixture','Fixture',NULL,gen_random_uuid());
INSERT INTO business.purchase_requests VALUES('$t','$r','$u','submitted',1,now());
INSERT INTO core.parties VALUES('$t','$s','active');
INSERT INTO business.party_roles VALUES('$t','$s','supplier',true);
INSERT INTO business.purchase_orders(tenant_id,id,status,revision,supplier_id,valid_until) VALUES('$t','$q','pending',1,'$s',$day+1);
COMMIT;
SQL
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
check(){ local actual; actual=$(psql -XAt -v ON_ERROR_STOP=1 -c "$1"); [[ "$actual" == "$2" ]] || { printf 'Expected %s, got %s\n' "$2" "$actual"; exit 1; }; }
race(){
 local label="$1" first="$2" second="$3" a b overlap=0 rc
 PGAPPNAME="anna108_${label}_a" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$tmp/$label.a" 2>&1 <<SQL &
BEGIN ISOLATION LEVEL SERIALIZABLE;
$ctx
$first;
SELECT pg_sleep(8);
COMMIT;
SQL
 a=$!
 for n in $(seq 1 50); do
  [[ "$(psql -XAtc "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna108_${label}_a' AND wait_event='PgSleep'")" == 1 ]] && break
  sleep 0.1
 done
 check "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna108_${label}_a' AND wait_event='PgSleep'" 1
 PGAPPNAME="anna108_${label}_b" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$tmp/$label.b" 2>&1 <<SQL &
BEGIN ISOLATION LEVEL SERIALIZABLE;
$ctx
$second;
COMMIT;
SQL
 b=$!
 for n in $(seq 1 50); do
  if [[ "$(psql -XAtc "SELECT count(*) FROM pg_stat_activity WHERE application_name='anna108_${label}_b' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")" == 1 ]]; then overlap=1; break; fi
  sleep 0.1
 done
 wait "$a"
 set +e; wait "$b"; rc=$?; set -e
 [[ "$overlap" == 1 && "$rc" != 0 ]] && grep -q '40001' "$tmp/$label.b" || { cat "$tmp/$label.a" "$tmp/$label.b"; exit 1; }
 echo "PASS: $label — independent overlapping sessions; competing write rejected with 40001"
}
race financial "SELECT * FROM business.settle_financial_installment('$i',1,70,0,0,0,$day,'pix','Fixture A',gen_random_uuid())" "SELECT * FROM business.settle_financial_installment('$i',1,70,0,0,0,$day,'pix','Fixture B',gen_random_uuid())"
check "SELECT remaining=30 AND revision=2 AND status='partial' FROM business.financial_installments WHERE id='$i'" t
check "SELECT count(*) FROM business.financial_settlements" 1
race stock "SELECT * FROM business.create_stock_movement('$p',1,'exit',$day,'$w',NULL,'',7,'Fixture A','Fixture',NULL,gen_random_uuid())" "SELECT * FROM business.create_stock_movement('$p',1,'exit',$day,'$w',NULL,'',7,'Fixture B','Fixture',NULL,gen_random_uuid())"
check "SELECT sum(CASE WHEN kind='entry' THEN quantity ELSE -quantity END)=3 AND max(revision)=2 FROM business.stock_movements WHERE product_id='$p'" t
check "SELECT count(*) FROM business.stock_movements" 2
race purchase_request "SELECT * FROM business.advance_purchase_request('$r',1,'approved','Fixture A',gen_random_uuid())" "SELECT * FROM business.advance_purchase_request('$r',1,'rejected','Fixture B',gen_random_uuid())"
check "SELECT status='approved' AND revision=2 FROM business.purchase_requests WHERE id='$r'" t
check "SELECT count(*) FROM business.purchase_request_events" 1
race purchase_order "SELECT * FROM business.decide_purchase_order('$q',1,'approved','Fixture A',gen_random_uuid())" "SELECT * FROM business.decide_purchase_order('$q',1,'rejected','Fixture B',gen_random_uuid())"
check "SELECT status='approved' AND revision=2 FROM business.purchase_orders WHERE id='$q'" t
check "SELECT count(*) FROM business.audit_events WHERE entity_type='purchase_order'" 1
echo 'PASS: financial, stock and purchasing invariants preserved.'
