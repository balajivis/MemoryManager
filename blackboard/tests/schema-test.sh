#!/usr/bin/env bash
# QA test for blackboard/schema.sql. Creates a throwaway database (qa_bb_<pid>_<rand>) on
# the local Postgres, loads the schema, and drops that one database on exit. Run: bash blackboard/tests/schema-test.sh
# The race case includes a control (a naive global-serial cursor on the same workload)
# that should skip entries, which shows the race was really provoked.
set -u
SCHEMA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/schema.sql"
DB="qa_bb_$$_$RANDOM"; W=$(mktemp -d)
createdb "$DB" || exit 1
trap 'dropdb --if-exists "$DB"; rm -rf "$W"' EXIT
q()  { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
pass=0; fail=0; ok(){ pass=$((pass+1)); echo "PASS  $1"; }; bad(){ fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; }
q -f "$SCHEMA" >/dev/null && ok "schema loads on an empty db" || { bad "schema loads"; exit 1; }
for n in w1 w2 w3 w4 r; do q -c "INSERT INTO bb.agents (name, role, cwd) VALUES ('$n','r','/x')"; done
# control: a naive global-serial log, written in the same transactions
q -c "CREATE TABLE naive (id bigserial PRIMARY KEY, author text, seq bigint)"

echo "== race: 5 writer sessions (w1 twice), slow commits, reader polling"
N=150
for spec in w1:a w1:b w2:a w3:a w4:a; do a=${spec%%:*}
  for i in $(seq 1 $N); do printf "BEGIN; WITH s AS (SELECT bb.log('%s','obs','%s-%s') AS v) INSERT INTO naive (author, seq) SELECT '%s', v FROM s; SELECT pg_sleep(random()*0.004); COMMIT;\n" $a $spec $i $a; done > $W/$spec.sql
  ( q -f $W/$spec.sql >/dev/null ) &
done
: > $W/seen; : > $W/naive_seen; maxid=0
while jobs -r | grep -q .; do
  q -c "SELECT author||' '||seq FROM bb.read('r')" >> $W/seen
  got=$(q -c "SELECT id FROM naive WHERE id > $maxid ORDER BY id"); [ -n "$got" ] && { echo "$got" >> $W/naive_seen; maxid=$(tail -1 <<<"$got"); }
done; wait
q -c "SELECT author||' '||seq FROM bb.read('r')" >> $W/seen
got=$(q -c "SELECT id FROM naive WHERE id > $maxid ORDER BY id"); [ -n "$got" ] && echo "$got" >> $W/naive_seen
total=$(q -c "SELECT count(*) FROM bb.entries"); expect=$((5*N))
uniq_seen=$(grep -c . $W/seen | tr -d ' '); distinct=$(sort -u $W/seen | grep -c .)
gapless=$(q -c "SELECT bool_and(c) FROM (SELECT count(*) = max(seq) AS c FROM bb.entries GROUP BY author) t")
[ "$total" = "$expect" ] && [ "$gapless" = t ] && ok "all $expect entries stored, per-author seq gapless" || bad "entries stored/gapless" "total=$total expect=$expect gapless=$gapless"
[ "$distinct" = "$total" ] && [ "$uniq_seen" = "$total" ] && ok "reader saw every entry exactly once ($total, no skips, no dupes)" || bad "reader saw every entry exactly once" "rows returned=$uniq_seen distinct=$distinct stored=$total"
naive_total=$(q -c "SELECT count(*) FROM naive"); naive_got=$(sort -u $W/naive_seen | grep -c .)
echo "      control (global serial cursor, same workload): saw $naive_got of $naive_total, skipped $((naive_total-naive_got))"
[ $((naive_total-naive_got)) -gt 0 ] && ok "control shows the race is real (naive design skipped entries)" || echo "NOTE  control skipped nothing this run; race not provoked, rerun"

echo "== constraints"
e(){ q -c "$1" >/dev/null 2>&1; }
e "UPDATE bb.entries SET body='x' WHERE author='w2' AND seq=1" && bad "UPDATE blocked" || ok "UPDATE blocked"
e "DELETE FROM bb.entries WHERE author='w2' AND seq=1" && bad "DELETE blocked" || ok "DELETE blocked"
e "TRUNCATE bb.entries" && bad "TRUNCATE blocked" || ok "TRUNCATE blocked"
e "SELECT bb.log('w2','bogus','x')" && bad "unknown kind rejected" || ok "unknown kind rejected"
e "SELECT bb.log('ghost','obs','x')" && bad "unregistered author rejected" || ok "unregistered author rejected"
e "SELECT bb.log('w2','obs','')" && bad "empty body rejected" || ok "empty body rejected"
e "SELECT bb.log('w2','obs',repeat('x',24000))" && ok "24000-byte body accepted" || bad "24000-byte body accepted"
e "SELECT bb.log('w2','obs',repeat('x',24001))" && bad "24001-byte body rejected" || ok "24001-byte body rejected"
e "SELECT bb.log('w2','obs',repeat('€',10000))" && bad "cap counts bytes (10000×€ = 30000B)" || ok "cap counts bytes (10000×€ = 30000B)"
e "INSERT INTO bb.agents (name, role, cwd) VALUES ('w1','dup','/x')" && bad "duplicate name rejected" || ok "duplicate name rejected"
e "INSERT INTO bb.agents (name, role, cwd) VALUES ('Bad','r','/x')" && bad "bad name rejected" || ok "bad name rejected"
e "INSERT INTO bb.agents (name, role, cwd) VALUES ('nl', E'a\nb','/x')" && bad "newline in role rejected" || ok "newline in role rejected"
e "INSERT INTO bb.agents (name, role, cwd) VALUES ('cw','r',E'/a\nb')" && bad "newline in cwd rejected" "accepted (devops 12:54 note 2)" || ok "newline in cwd rejected"
before=$(q -c "SELECT last_seq FROM bb.agents WHERE name='w3'")
q -c "BEGIN; SELECT bb.log('w3','obs','rolled back'); ROLLBACK;" >/dev/null; q -c "SELECT bb.log('w3','obs','after rollback')" >/dev/null
[ "$(q -c "SELECT count(*) = max(seq) FROM bb.entries WHERE author='w3'")" = t ] && [ "$(q -c "SELECT last_seq FROM bb.agents WHERE name='w3'")" = $((before+1)) ] && ok "rollback leaves no seq gap" || bad "rollback leaves no seq gap"

echo "== mentions"
q -c "SELECT bb.read('r')" >/dev/null
m(){ q -c "SELECT bb.log('w4','ask',E'$1')" >/dev/null; q -c "SELECT bool_or(mentions_me) FROM bb.read('r')"; }
[ "$(m '@r please')" = t ] && ok "@r flagged" || bad "@r flagged"
[ "$(m '@r-x please')" = f ] && ok "@r-x not flagged for r" || bad "@r-x not flagged for r"
[ "$(m 'ping @rx')" = f ] && ok "@rx not flagged for r" || bad "@rx not flagged for r"
[ "$(m 'end @r')" = t ] && ok "@r at end of body flagged" || bad "@r at end of body flagged"
[ "$(m 'line @r\\nnext')" = t ] && ok "@r at end of a line flagged" || bad "@r at end of a line flagged"

echo "== read semantics"
q -c "SELECT bb.read('r')" >/dev/null
q -c "SELECT bb.log('r','obs','own entry')" >/dev/null
[ "$(q -c "SELECT count(*) FROM bb.read('r')")" = 0 ] && ok "reader never sees own entries" || bad "reader never sees own entries"
all=$(q -c "SELECT count(*) FROM bb.read('r', true)"); others=$(q -c "SELECT count(*) FROM bb.entries WHERE author<>'r'")
[ "$all" = "$others" ] && ok "replay (p_all) returns all $others peer entries" || bad "replay returns all peer entries" "$all vs $others"
[ "$(q -c "SELECT count(*) FROM bb.read('r')")" = 0 ] && ok "after replay: nothing new" || bad "after replay: nothing new"
echo; echo "RESULT: $pass passed, $fail failed"; [ $fail -eq 0 ]
