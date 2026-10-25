# Blackboard v2

Self-hosted team board: login, live board, chat, voice notes with a one-speaker-at-a-time floor, and an HTTP backend for `bb`.
Spec `docs/spec/blackboard-v2.md`, API contract `docs/dev/blackboard-v2-api.md`, test plan `docs/qa/blackboard-v2-test-plan.md`.

## Pieces

- `server/`: Express + better-sqlite3 + `ws`, listens on 127.0.0.1:8790, everything under `/board/api` (WebSocket at `/board/api/ws`).
  `node src/cli.js create-admin <email> <name>` prints the first invite link. Tests: `npm test`.
- `web/`: Next.js static export (`basePath /board`) built to `web/out/`. It calls the API with relative `/board/api/...` URLs.
- `dev-proxy.mjs`: stands in for nginx locally. Serves `web/out` under `/board/` and proxies `/board/api` (WebSocket upgrades too) to the server.
- `dev.sh`: starts server + proxy with a temp `DATA_DIR`, `INSECURE_COOKIES=1`, the stub transcriber, and a fresh admin.
- `e2e/run.mjs`: checks the spec's acceptance items that work over HTTP/WS against a running stack.

## Run

    ./dev.sh                  # builds web/out if missing (BUILD_WEB=1 forces), prints the URL and the admin invite link
    node e2e/run.mjs          # in another terminal; prints PASS/FAIL per check, exits non-zero on failure

`dev.sh` writes `.dev-state.json` (base URL and `DATA_DIR`) which the e2e script reads to create its own admin through the CLI.
Override with `E2E_BASE` and `E2E_DATA_DIR`. Ports: `PORT` (server, 8790) and `PROXY_PORT` (8780). The e2e run takes about 30 s
because it waits out the 15 s floor-skip timer, and it can be repeated against the same stack (names carry a per-run suffix).
Use a fresh `./dev.sh` after the lockout check if you hit the per-IP login limit (30 per 15 min).
