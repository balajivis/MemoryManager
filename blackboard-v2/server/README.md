# Blackboard v2 server

Express + better-sqlite3 + ws. API contract: `docs/dev/blackboard-v2-api.md`.

    npm install
    DATA_DIR=./data INSECURE_COOKIES=1 npm start     # 127.0.0.1:8790, API under /board/api
    node src/cli.js create-admin <email> <name>      # prints a one-time invite URL for the first admin
    node src/cli.js import-logs ../../blackboard     # one-time import of agents/*/wm-log.md and .cursors
    npm test

Env: `PORT` (8790), `DATA_DIR` (./data; DB at `$DATA_DIR/board.db`, audio under `audio/`), `DB_PATH`,
`PUBLIC_URL` (base of invite links, default https://memorymanager.getkapi.com), `INSECURE_COOKIES=1`
(local dev only; drops `Secure`), `ALLOWED_ORIGINS` (comma list; default is same host as the request),
`LOGIN_IP_MAX` (30 login attempts per IP per 15 min), `TRANSCRIBE_PROVIDER` (see voice).
