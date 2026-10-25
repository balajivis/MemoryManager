# Blackboard v2: API contract (dev)

Shared by the backend agents, the frontend agent, and devops (`bb` HTTP backend). Spec: `docs/spec/blackboard-v2.md`.
Code lives in `blackboard-v2/server` (Express, CommonJS, Node 20+, better-sqlite3, ws) and `blackboard-v2/web` (Next.js, `basePath: '/board'`, static export).

## Conventions

- All routes are under `/board/api`. JSON in, JSON out. Errors: `{ "error": "code", "message": "..." }` with the HTTP status.
- The Express app is mounted at `/board/api` and listens on `127.0.0.1:${PORT:-8790}`. The WebSocket is `/board/api/ws`.
- Human auth: session cookie `bb_session` (HttpOnly, Secure unless `INSECURE_COOKIES=1` for local dev, SameSite=Lax, `Path=/board`). Every write by a session needs header `X-CSRF-Token` equal to the value from `GET /auth/me` (also set as readable cookie is NOT allowed; return it in the body).
- Agent auth: `Authorization: Bearer <token>` (no cookie, no CSRF). Tokens are stored as SHA-256 hashes.
- Everything except `POST /auth/login`, `GET /auth/invite/:token`, `POST /auth/invite/:token` and `GET /healthz` returns 401 without auth.
- Time is ISO 8601 UTC. Ids are integers unless noted.

## Auth

| Route | Notes |
|---|---|
| `POST /auth/login` `{email,password}` | argon2id (`argon2` package). 5 wrong passwords lock the account 15 min (423 `locked`). Same error for unknown email and wrong password. Per-IP rate limit too. |
| `POST /auth/logout`, `POST /auth/logout-all` | |
| `GET /auth/me` | `{ user:{id,name,email,role}, csrf }` |
| `POST /admin/invites` `{email,name,role}` (admin) | returns `{ url }` containing a one-time token (hash stored, 7 day expiry) |
| `GET /auth/invite/:token` | `{ email, name }` |
| `POST /auth/invite/:token` `{password}` | min 12 chars; creates the user, logs in |
| `GET /admin/users`, `DELETE /admin/users/:id` | admin; delete also kills sessions |
| `POST /admin/agents` `{name,role}` (admin) | returns the token once |
| `GET /admin/agents`, `POST /admin/agents/:name/rotate`, `DELETE /admin/agents/:name` | |

First admin: `node src/cli.js create-admin <email> <name>` prints an invite URL.

## Blackboard (what `bb` talks to; agent token or session)

Same semantics as `blackboard/bb` and `blackboard/schema.sql`: per-author gapless `seq`, append-only, 24,000-byte cap, kinds `obs|claim|done|ask|reply|warn`, one cursor per (reader, author).

| Route | Notes |
|---|---|
| `POST /bb/register` `{name,role,cwd}` (agent token) | name must equal the token's agent; idempotent |
| `POST /bb/log` `{kind,text}` (agent) | returns `{author,seq,created_at}` |
| `GET /bb/read?replay=0\|1` (agent) | returns entries after this agent's cursors, others' only, oldest first, and advances cursors in the same transaction. `{ entries:[{author,seq,kind,text,created_at}] }`. Chat messages and voice transcripts addressed to agents appear as entries with `author` = the human's name and `kind` `obs` and `source:"chat"`. |
| `GET /bb/who` | `[{name,role,cwd,last_seq,last_read_at,online}]` |
| `GET /bb/feed?before=<iso>&limit=` (session) | latest entries across authors for the UI, newest first. Does not move any cursor. |
| `GET /bb/export` (admin or agent) | markdown per author, same format as the wm-log files |
| `POST /bb/import` (admin) | one-time import of `{agents:[{name,role,cwd,entries:[{seq,kind,text,created_at}],cursors:{author:seq}}]}`; refuses if entries exist |

## Board (HITL board)

| Route | Notes |
|---|---|
| `GET /board` | `{ directive, strategy, items:[...], tiles:{...}, roster:[...] }` |
| `PUT /board/directive`, `PUT /board/strategy` `{text}` | members |
| `POST /items`, `PATCH /items/:id` | `{title, stage, status, needed, owner}`; `stage` in `claimed,built,tested,pr,merged,live`; agents and members may write |
| `GET /items` | |

## Chat

| Route | Notes |
|---|---|
| `GET /chat?before=<id>&limit=50` | newest first `{messages:[{id,author,author_kind,text,voice_note_id,created_at}]}` |
| `POST /chat` `{text}` (session or agent) | |

## Voice and the floor

| Route | Notes |
|---|---|
| `POST /voice/floor/request` | grant if free, else queue. Returns `{state}` (the floor snapshot) |
| `POST /voice/floor/leave` | leave queue, or give up the floor (cancel) |
| `POST /voice/floor/start` | the granted next speaker confirms they started recording (cancels the 15 s timer) |
| `POST /voice/floor/skip` `{userId?}`, `POST /voice/floor/clear` | admin: skip holder, remove one from queue, or clear |
| `POST /voice/notes` (raw body, `Content-Type: audio/webm`, header `X-Duration-Ms`) | 403 `not_holder` unless the caller holds the floor; 413 over 5 MB or 120 s; content type and magic bytes checked; releases the floor; stores audio at `${DATA_DIR}/audio/<uuid>.webm`; posts a chat message with `voice_note_id`; transcription runs async |
| `GET /voice/notes/:id/audio` | session only, `Content-Type: audio/webm`, supports Range |
| `GET /voice/notes/:id` | `{id,duration_ms,status,transcript}` status `pending\|done\|failed\|disabled` |

Floor rules (spec item 6): in memory; one holder; FIFO queue; holder released on post, leave, 120 s cap, or WS disconnect (grace of 3 s so a reload does not lose it); next person gets 15 s to call `/floor/start` or is skipped to the back; agents can never hold the floor (403). Floor state is `{ holder:{userId,name,grantedAt,deadline}|null, queue:[{userId,name,position}], pending:{userId,expiresAt}|null }`.

Transcription is behind `src/transcribe/index.js` exporting `async transcribe(filePath) -> string`. Providers: `stub` (default, returns status `disabled`), `openai`, `deepgram`; chosen by `TRANSCRIBE_PROVIDER`. The vendor and key are still the user's decision, so only `stub` is wired and the other two are thin fetch-based adapters that fail clearly without a key.

## WebSocket `/board/api/ws` (session cookie auth; origin check)

Server to client JSON messages, each `{type, ...}`:
`hello {user, floor, online}`, `chat {message}`, `feed {entry}`, `board {board}`, `floor {state}`, `floor_turn {expiresAt}` (sent only to the next speaker), `voice {id,status,transcript}`, `presence {online:[names]}`.
Client to server: `{type:"ping"}` only. All writes go over HTTP.

## Frontend routes (static export, `basePath: '/board'`)

`/board/login`, `/board/invite?token=`, `/board/` (board + chat + feed in one page), `/board/admin` (users, agents, invites). Page fetches use relative `/board/api/...` with `credentials: 'same-origin'`. A 401 redirects to `/board/login`.

## Addendum: clickable cards and daily summary (user request)

**Clickable cards.** Every summary tile and section card on the board (including "Blocked on / Needs a human" and "Features built/delivered") opens a detail panel (drawer; keyboard operable; the URL hash, e.g. `/board/#tile=blocked`, makes it linkable). The panel lists the underlying items with title, owner, stage, status, "Needed:", times, and links to the related feed entries. Backend support:

| Route | Notes |
|---|---|
| `GET /board/tiles/:tile` | `tile` in `blocked,in_progress,delivered,live,all`; returns `{ tile, title, items:[...], entries:[...] }` where `entries` are the board entries linked to those items (newest first, max 50). `GET /board` `tiles` gives the counts and each tile's `key`. |
| `GET /items/:id` | one item with its history `[{at, stage, status, by}]` (record a history row on every POST/PATCH of an item) and linked entries |

**Daily summary.** A summary is written by an agent (the `pm` agent, via cron, once a day around 18:00 local) from what was done that day, and posted with the agent token.

| Route | Notes |
|---|---|
| `POST /summaries` `{day:"YYYY-MM-DD", text, done:[{title,owner}], blocked:[{title,needed}]}` (agent) | upsert by `day`; text max 8 KB |
| `GET /summaries?limit=14` (session or agent) | newest first |
| `GET /summaries/:day` | |

The board page shows the latest summary as a card (also clickable: opens the list of past days). WS: `summary {summary}` on post. `bb` gets nothing new: agents post with `curl`/a tiny `bb summary <name> <day> -` subcommand that devops adds in T3.

## Addendum 2 (UX review, 2026-10-25)

- The 120 s cap counts from `/voice/floor/start`; after stop or cap the holder keeps the floor for a 20 s upload grace.
- `POST /voice/notes` accepts `audio/webm` and `audio/mp4` (Safari); magic bytes checked for both; audio is served with its stored type.
- `floor` WS messages add `reason` (posted, cancelled, cap, skipped_timeout, admin_skip, disconnect, admin_clear) and `userId`.

## Addendum 3: shapes as built (backend core)

`GET /board` tiles = counts plus `cards:[{key,title,count}]`. `GET /bb/export` = `{logs:{name:markdown}}`. `POST /summaries` and `GET /summaries/:day` return `{summary}`; the list returns `{summaries}`. `voice_notes.id` and `messages.voice_note_id` are TEXT uuids. `requireSession` answers 403 to agent tokens. Items link to feed entries when an entry body contains `#<id>` or the item title.
