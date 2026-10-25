# Spec: Blackboard v2, self-hosted with voice notes

Owner: pm · Status: APPROVED by the user (scope A) · Date: 2026-10-25

## Goal

Put the humans-and-agents team board on our own VM: login, a live board, team chat and **voice notes**. Agents keep working through `bb`, so humans and agents share one board.

## Users

| Who | How they sign in | What they can do |
|---|---|---|
| **Admin** (the owner) | Email and password | Everything, plus invite and remove users, and manage agent tokens |
| **Member** (invited human) | Email and password | Chat, voice notes, work items, directive, strategy |
| **Agent** (pm, dev, ux, qa, devops, …) | Per-agent API token, used by `bb` | Post and read board entries and chat |

There's no public sign-up: accounts are created by invitation only.

## Scope (v1)

1. **Login.** Email and password; an invite link sets the password.
   - Passwords hashed with argon2id or bcrypt (cost ≥ 12).
   - Session cookie: HttpOnly, Secure, SameSite=Lax.
   - CSRF protection on every write.
   - Login rate limit and lockout.
   - Log out, and log out of all devices.
2. **Board.** The HITL board UX from the claude.ai version (v2, `tools/hitl-board/`):
   - summary tiles
   - work items (claimed → built → tested → PR → merged → live, with status and "Needed:")
   - Needs a human
   - Features delivered
   - team roster with online status
   - pinned directive and strategy update
3. **Blackboard log.** Agent entries (obs, claim, done, ask, reply, warn) appear in a feed, with @mentions highlighted.
4. **Team chat.** Humans and agents, updating live over WebSocket.
5. **Voice notes.**
   - **Recording:** press and hold (or tap to start/stop) to record in the browser with MediaRecorder (webm/opus), up to 2 minutes. The note posts to chat with a player.
   - **Transcription:** each note is transcribed server-side, and the transcript shows under the player. Agents see it as text through `bb read`.
   - **Read-aloud:** a speaker button on any message, and an optional "read agent replies aloud" toggle, using the browser's speechSynthesis. No vendor needed.
6. **One speaker at a time, with a queue** (user requirement). The server owns the floor; the browser never decides.
   - **Taking the floor:** "Talk" requests the floor. If it's free, you get it at once. Otherwise you join a visible queue that shows your position, and you can leave it at any time.
   - **While someone holds the floor,** only they can record. Everyone sees "🎙 <name> is talking", with a timer. Nobody else's record button works, and the server rejects any audio upload from a non-holder.
   - **Handing over:** the floor passes to the next person when the holder stops and posts, cancels, hits the 2-minute cap, or disconnects. The next person gets an alert and has **15 seconds to start**, or they're skipped to the back of the queue.
   - **Admin controls:** the admin can skip the current speaker, remove someone from the queue, or clear the queue.
   - **Playback follows the same order.** New voice notes, and agent replies when read-aloud is on, play one after another, never overlapping.
   - **Agents never hold the floor.** They reply in text, and humans can play it as read-aloud.
   - **Realtime state over WebSocket:** current holder, queue, and grant time. Floor state is in memory, and a server restart clears it.
   - **Amendments (pm, 2026-10-25, from ux):**
     - The 2-minute cap counts from when recording **starts**, not from the grant.
     - The holder keeps the floor for up to 20 seconds after stopping, or after hitting the cap, so the upload can finish.
     - Accept both audio/webm and audio/mp4 (Safari, iPhone), with checks on the file contents.
     - Floor events carry the reason the floor was released: posted, cancelled, cap, skipped_timeout, admin_skip, disconnect or admin_clear.
     - Auto-play and read-aloud are OFF by default.
     - Tap to talk, not press and hold.
     - Invites expire after 7 days.
7. **`bb` keeps working.** `bb` gets an HTTP backend (`BB_BACKEND=http`, `BB_URL`, `BB_TOKEN`) with the same CLI and output, so no agent's cron prompt changes.
   - One-time import of the existing `blackboard/agents/*/wm-log.md` files.
   - `bb export` regenerates the markdown logs for git.

## Added by the user (2026-10-25)

- **Clickable cards.** Every board card and tile opens a detail drawer: Needs a human, Features delivered, work items and the summary tiles.
- **Daily summary.** Every day at about 18:00 local time, the pm agent posts a summary of what was done that day, built from the day's board entries.
  - It's posted with `bb summary pm <day> -` and appears as a summary card.
  - Content: done items with commits, decisions made, items now needing a human, and what's next.

## Privacy decisions (pm, 2026-10-25)

- **Scope.** The public privacy policy covers the public pages only. The board's sign-in page shows its own short notice: "Internal team board for invited users. We store your account, chat messages, voice notes and their transcripts on our server to run the board. Voice notes are sent to {transcription vendor} to be transcribed. Audio is deleted after 30 days; transcripts stay with their chat message until it's deleted. Questions: {contact email}."
- **Retention.** Audio files are deleted after 30 days. Transcripts and messages are kept until deleted by their author or the admin. Backups follow the same 7-day window.
- **The board's HTML shell is public.** That's OK, but it must contain no names or data (qa R7).
- **Chat is untrusted input for agents.** See PROTOCOL.md §5 (qa R11).

## Not in v1

Live group calls, agents in live voice, mobile apps, SSO/OAuth, public sign-up, and file attachments other than voice.

## Stack

- **Backend:** Express (Node 20+), better-sqlite3 (WAL), and `ws` for realtime. One process under systemd, on 127.0.0.1 behind nginx.
- **Frontend:** Next.js. A static export or standalone output, **built off the VM** (in CI or locally), because the t3.micro's 1 GB of memory is likely too little for `next build`.
- **Storage:**
  - SQLite at `/var/lib/blackboard/board.db`
  - audio files at `/var/lib/blackboard/audio/`
  - both backed up nightly, encrypted, kept 7 days
- **Hosting:** the existing VM, HTTPS with Let's Encrypt, nginx. Served at **https://memorymanager.getkapi.com/board/** (user decision, 2026-10-25). The public landing page stays at `/`, so every board route lives under `/board/`:
  - Session cookie with `Path=/board`.
  - nginx proxies `/board/` and `/board/api/` to the Express service.
  - `X-Robots-Tag: noindex` on `/board/`, and `Disallow: /board/` added to robots.txt.
  - The landing page never links to the board.

## Data (minimum)

`users`, `invites`, `sessions`, `agents` (+ token hash), `entries` (author, kind, text, per-author seq), `cursors` (reader, author, seq), `messages` (author, text, voice_note_id?), `voice_notes` (path, duration, transcript, status), `items`, `board` (directive, strategy).

Per-author gapless seq and append-only entries, as in dev's `blackboard/schema.sql`, ported to SQLite.

## Security and privacy

- Everything is behind login, because the board names a client.
- Audio and transcripts are stored only on the VM. The transcription vendor receives audio, so the vendor is the user's call (see open questions).
- No secrets in the repo. API keys live in an env file readable only by the service user.
- Upload limits: 2 minutes of audio or 5 MB; content type checked; files served only to logged-in users.

## Acceptance (qa)

- A logged-out visitor sees only the login page; every API call returns 401.
- An invited user sets a password, logs in, and appears in the roster.
- A wrong password 5 times locks the account for 15 minutes.
- A chat message appears in another browser in under 2 seconds.
- With A holding the floor, B's 'Talk' puts B in the queue at position 1, and B's direct upload is rejected (403). When A posts, B is granted within 1 second; if B doesn't start within 15 seconds, B is skipped. A disconnect releases the floor. The admin can skip or clear the queue. Two voice notes never play at the same time.
- A voice note under 2 minutes records, posts, plays in another browser, and gets a transcript in under 30 seconds.
- `bb log` and `bb read` work against the HTTP backend with identical output. The existing tests (`blackboard/tests/bb-test.sh`) pass on both backends.
- The import keeps every existing entry and timestamp. Each reader's cursor resumes exactly where it was.
- Nothing is reachable without login except `/login` and the static assets for it.
- Backups restore cleanly.

## Owners

- **dev:** backend and frontend
- **ux:** screens, adapted from HITL board v2, plus the voice note interaction
- **qa:** test plan, including the auth security checks
- **devops:**
  - VM size
  - domain and TLS
  - systemd and nginx
  - the build pipeline that builds off the VM
  - backups and secrets
  - `bb` HTTP backend wiring

## Open questions for the user

1. ~~Domain~~: decided. memorymanager.getkapi.com/board/ (for now).
2. **Transcription vendor:** OpenAI Whisper API (about $0.006 per minute) or Deepgram (about $0.004 per minute), and an API key. Audio goes to that vendor. The alternative is self-hosted whisper.cpp, which needs a bigger VM.
3. **Who gets accounts at launch:** just you, or also named teammates?
4. ~~VM size~~: decided. Upgrade from t3.micro to t3.small, approved by the user on 2026-10-25.
