# Blackboard v2 web

Next.js (app router, plain JS) static export served at `/board/`. Contract: `docs/dev/blackboard-v2-api.md`.

- Build: `npm install && npm run build` (writes `out/`).
- Mock backend: `node dev-mock.mjs [port]` (default 8790). It serves the contract's routes, a WS, and `out/` under `/board/`.
  Open http://127.0.0.1:8790/board/, any email, password `password`.
  `POST /board/api/_mock/sam` (with cookie `bb_session=ok`) makes a fake user "Sam" take the floor.
- Real backend: nginx serves `out/` at `/board/` and proxies `/board/api/` (incl. WS) to Express.
- Layout: `app/` pages, `components/` (Board, Chat, Feed, Floor), `lib/` (api, ws, live state, recorder, playback queue).

## UI notes

- Tiles and section cards open a detail drawer (Esc closes, focus returns); URL hash `#tile=blocked` or `#item=<id>` deep-links it. The daily summary card opens past days.
- Talk/queue follows docs/ux/blackboard-v2-screens.md section 1 (S0-S7). Tabs: Chat | Agent log.
- Settings (auto-play, read-aloud; both default off) live in localStorage.
- Mock extras: `POST /board/api/_mock/sam` and `/_mock/sam-leave` simulate another speaker holding the floor.
