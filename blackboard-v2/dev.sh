#!/usr/bin/env bash
# Start a local Blackboard v2 dev stack: server (temp DATA_DIR) + static web export + proxy under /board/.
# Env: PORT (server, 8790), PROXY_PORT (8780), BUILD_WEB=1 to force `next build`, DATA_DIR to reuse a dir.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8790}"; PROXY_PORT="${PROXY_PORT:-8780}"
export DATA_DIR="${DATA_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/bbv2-dev.XXXXXX")}"
export INSECURE_COOKIES=1 TRANSCRIBE_PROVIDER="${TRANSCRIBE_PROVIDER:-stub}" PORT
export PUBLIC_URL="http://127.0.0.1:$PROXY_PORT"

if [ "${BUILD_WEB:-0}" = 1 ] || [ ! -f "$ROOT/web/out/index.html" ]; then
  echo "building web export..."; (cd "$ROOT/web" && npx next build)
fi

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

ADMIN_URL="$(cd "$ROOT/server" && node src/cli.js create-admin admin@example.test Admin)"
(cd "$ROOT/server" && exec node src/server.js) & PIDS+=($!)
node "$ROOT/dev-proxy.mjs" "$PROXY_PORT" "$PORT" & PIDS+=($!)

for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PROXY_PORT/board/api/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$PROXY_PORT/board/api/healthz" >/dev/null || { echo "server did not come up" >&2; exit 1; }

printf '{"base":"http://127.0.0.1:%s","dataDir":"%s"}\n' "$PROXY_PORT" "$DATA_DIR" > "$ROOT/.dev-state.json"
echo
echo "Board:        http://127.0.0.1:$PROXY_PORT/board/"
echo "Admin invite: $ADMIN_URL"
echo "DATA_DIR:     $DATA_DIR"
echo "E2E:          node $ROOT/e2e/run.mjs"
echo "Ctrl-C to stop."
wait
