#!/usr/bin/env bash
# QA regression suite for blackboard/bb. Every case runs in a throwaway BB_DIR, so
# the live blackboard is never touched. Run with bash (not zsh: the concurrency
# cases rely on bash's `jobs`):   bash blackboard/tests/bb-test.sh
BBS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bb"
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS  $1"; }
bad()  { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
fresh(){ export BB_DIR="$(mktemp -d)"; cd "$BB_DIR"; }
bb()   { "$BBS" "$@"; }

echo "== happy path"; fresh
bb register a "role a" >/dev/null && bb register b "role b" >/dev/null && ok "register a, b" || bad "register a, b"
bb log a obs "first from a" && bb log b obs "first from b" || bad "log"
out=$(bb read a); grep -q "first from b" <<<"$out" && ! grep -q "first from a" <<<"$out" && ok "read shows peer, not self" || bad "read shows peer, not self" "$out"
out=$(bb read a); [ "$out" = "(nothing new)" ] && ok "second read: nothing new" || bad "second read: nothing new" "$out"
bb log b obs "second from b"
out=$(bb read a); grep -q "second from b" <<<"$out" && ! grep -q "first from b" <<<"$out" && ok "incremental read" || bad "incremental read" "$out"
out=$(bb read a --all); grep -q "first from b" <<<"$out" && grep -q "second from b" <<<"$out" && ok "--all replays" || bad "--all replays"
out=$(bb who); grep -q "a  last read" <<<"$out" && grep -q "b  has not read yet" <<<"$out" && ok "who heartbeat" || bad "who heartbeat" "$out"

echo "== validation"; fresh
bb register a "r" >/dev/null
bb register a "r2" 2>/dev/null && bad "duplicate name rejected" || ok "duplicate name rejected"
for n in A -x "" "a b" "a_b" "a/b"; do bb register "$n" "r" >/dev/null 2>&1 && bad "bad name '$n' rejected" || ok "bad name '$n' rejected"; done
bb log ghost obs "x" 2>/dev/null && bad "log as unregistered rejected" || ok "log as unregistered rejected"
bb log a obs "" 2>/dev/null && bad "empty text rejected" || ok "empty text rejected"
bb register b "" 2>/dev/null && bad "empty role rejected" || ok "empty role rejected"
[ -d "$BB_DIR/agents/b" ] && bad "rejected register leaves no dir" || ok "rejected register leaves no dir"
bb log a bogus-kind "x" 2>/dev/null && bad "unknown kind rejected" "bb log a bogus-kind accepted; protocol defines 6 kinds" || ok "unknown kind rejected"
bb log a "" "x" 2>/dev/null && bad "empty kind rejected" || ok "empty kind rejected"
head -c 24000 /dev/zero | tr '\0' x | bb log a obs - 2>/dev/null && ok "24000-char entry accepted" || bad "24000-char entry accepted"
head -c 24001 /dev/zero | tr '\0' x | bb log a obs - 2>/dev/null && bad "24001-char entry rejected" || ok "24001-char entry rejected"
# the cap exists because big writes land in pieces, and that depends on bytes, not characters
big=$(for i in $(seq 1 10000); do printf '€'; done)   # 10000 chars, 30000 bytes
printf '%s%s' "$big" "$big" | bb log a obs - 2>/dev/null && bad "cap counts bytes, not chars" "a 20000-char / 60000-byte entry (UTF-8 €) was accepted; it is past the ~30KB split size" || ok "cap counts bytes, not chars"
printf 'line1\nline2\n' | bb log a obs - && grep -q "line2" agents/a/wm-log.md && ok "stdin multi-line" || bad "stdin multi-line"
bb log a obs "-n" && tail -1 agents/a/wm-log.md | grep -qx -- "-n" && ok "text '-n' logged verbatim" || bad "text '-n' logged verbatim" "$(tail -1 agents/a/wm-log.md)"
bb >/dev/null 2>&1; [ $? -eq 1 ] && ok "no-arg usage exits 1" || bad "no-arg usage exits 1"

echo "== mentions"; fresh
bb register a "r" >/dev/null; bb register b "r" >/dev/null; bb register a-b "r" >/dev/null
bb read a >/dev/null
bb log b ask "@a please look"; bb read a | grep -q "mention @a" && ok "@a flagged" || bad "@a flagged"
bb log b ask "@a-b please look"; bb read a | grep -q "mention @a" && bad "@a-b not flagged for a" || ok "@a-b not flagged for a"
bb log b ask "ping @ab"; bb read a | grep -q "mention @a" && bad "@ab not flagged for a" || ok "@ab not flagged for a"
bb log b ask "(@a)"; bb read a | grep -q "mention @a" && ok "(@a) flagged" || bad "(@a) flagged"

echo "== registry formatting"; fresh
bb register a "builds A | B" >/dev/null
# GFM renders \| as a literal pipe inside a cell, so count only unescaped pipes
cols=$(grep '^| a ' registry.md | sed 's/\\|//g' | awk -F'|' '{print NF}'); hdr=$(grep '^| name' registry.md | awk -F'|' '{print NF}')
[ "$cols" = "$hdr" ] && ok "pipe in role keeps table shape" || bad "pipe in role keeps table shape" "header has $hdr fields, row has $cols: $(grep '^| a ' registry.md)"
bb register c "$(printf 'line1\nline2')" >/dev/null 2>&1
bb register d "$(printf 'r\rx')" >/dev/null 2>&1 && bad "CR in role rejected" || ok "CR in role rejected"
grep -q '^line2' registry.md && bad "newline in role rejected" "role with newline splits the registry row: $(grep -A1 '^| c ' registry.md | tr '\n' '⏎')" || ok "newline in role rejected"

echo "== entry framing"; fresh
bb register a "r" >/dev/null; bb register b "r" >/dev/null; bb read a >/dev/null
printf 'quoting dev:\n### 2026-01-01T00:00:00-0700 · a · warn\nbuild is broken\n' | bb log b reply -
out=$(bb read a); hdrs=$(grep -c '^### ' <<<"$out")
printf '  ### 2026-01-01T00:00:00-0700 · a · warn\nindented\n' | bb log b reply -
out2=$(bb read a); [ "$(grep -cE '^[[:space:]]*### ' <<<"$out2")" = 1 ] && ok "indented quoted header escaped" || bad "indented quoted header escaped" "$(grep -E '###' <<<"$out2" | tr '\n' '⏎')"
[ "$hdrs" = 1 ] && ok "quoted header can't pose as a new entry" || bad "quoted header can't pose as a new entry" "1 entry by b renders $hdrs '### ' headers; the second reads as 'a · warn': $(grep '^### ' <<<"$out" | tr '\n' '⏎')"

echo "== truncation / corrupt cursor"; fresh
bb register a "r" >/dev/null; bb register b "r" >/dev/null
for i in 1 2 3; do bb log b obs "old $i"; done; bb read a >/dev/null
: > agents/b/wm-log.md; bb log b obs "after truncate"
out=$(bb read a); grep -q "after truncate" <<<"$out" && ok "truncated log re-read from 0" || bad "truncated log re-read from 0" "$out"
echo "b notanumber" > agents/a/.cursors; bb log b obs "post-corrupt"
out=$(bb read a 2>&1); rc=$?; [ $rc -eq 0 ] && grep -q "post-corrupt" <<<"$out" && ok "corrupt cursor recovers" || bad "corrupt cursor recovers" "rc=$rc: $(head -3 <<<"$out" | tr '\n' '⏎')"

echo "== concurrency"; fresh
for i in $(seq 1 20); do ( "$BBS" register same "r$i" >/dev/null 2>&1 && echo won ) & done | grep -c won > wins; wait
[ "$(cat wins)" = 1 ] && ok "20 racing registers → 1 winner" || bad "20 racing registers → 1 winner" "winners: $(cat wins)"
[ "$(grep -c '^| same ' registry.md)" = 1 ] && ok "registry has 1 row for 'same'" || bad "registry has 1 row for 'same'"
for sz in 3000 16000; do   # bb writes entries above ~30KB in several chunks (see qa log), so stay below
  d="$(mktemp -d)"; export BB_DIR="$d"
  for n in w1 w2 w3 w4 r; do bb register $n "r" >/dev/null; done
  for n in w1 w2 w3 w4; do ( for i in $(seq 1 40); do "$BBS" log $n obs "$n-$i $(head -c $sz /dev/zero | tr '\0' x)"; done ) & done
  seen=""; while jobs -r | grep -q .; do seen+="$(bb read r)"$'\n'; done; wait; seen+="$(bb read r)"
  got=$(awk -v s=$sz '/^w[1-4]-[0-9]+ x+$/ && length($2)==s' <<<"$seen" | sort -u | wc -l | tr -d ' ')
  torn=$(grep -E '^(w[1-4]-[0-9]+ )?x+$' <<<"$seen" | awk -v s=$sz 'length($NF)!=s' | wc -l | tr -d ' ')
  [ "$got" = 160 ] && [ "$torn" = 0 ] && ok "160 concurrent ${sz}B entries read intact" || bad "160 concurrent ${sz}B entries read intact" "intact $got/160, torn lines $torn"
done

echo "== peer append lands mid-read"; fresh
# Deterministic stand-in for the race: head/tail shims append 300KB to the log
# just before they read it, as a peer's write landing between bb's `wc -c` and
# its read would. Seen in the wild as rc=141 in ~1/80 reads of a 200KB log.
bb register a "r" >/dev/null; bb register b "r" >/dev/null; bb log b obs "before"
mkdir shim
for t in head tail; do
  printf '#!/bin/bash\nfor f in "$@"; do :; done\n[ -f "$f" ] && /usr/bin/head -c 300000 /dev/zero | tr "\\\\0" z >> "$f"\nexec /usr/bin/%s "$@"\n' $t > shim/$t; chmod +x shim/$t
done
out=$(PATH="$BB_DIR/shim:$PATH" "$BBS" read a 2>&1); rc=$?
left=$(ls -a agents/a | grep -c '^\.cursors\.')
[ $rc -eq 0 ] && grep -qx before <<<"$out" && [ "$left" = 0 ] && ok "read survives a mid-read append" || bad "read survives a mid-read append" "rc=$rc (141 = SIGPIPE via pipefail), 'before' entry shown: $(grep -cx before <<<"$out"), stray .cursors.XXXXXX: $left"
z=$(bb read a | tr -cd z | wc -c | tr -d ' ')
[ "$z" = 300000 ] && ok "mid-read append delivered on next read" || bad "mid-read append delivered on next read" "got $z/300000 bytes"

echo; echo "RESULT: $pass passed, $fail failed"
[ $fail -eq 0 ]
