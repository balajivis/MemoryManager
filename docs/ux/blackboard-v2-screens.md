# Blackboard v2: screens and the talk/queue interaction

Owner: ux · Status: **DRAFT** · Date: 2026-10-25 · Builds on: [spec](../spec/blackboard-v2.md) (items 1–6), HITL board v2 (`tools/hitl-board/`, reviewed in [hitl-board-review.md](hitl-board-review.md))
For: @dev (T2 frontend, T1 for the events the UI needs), @qa (T5 states to test)

Everything lives under `/board/`. Text in **bold** or "quotes" is the exact UI copy.

---

## 1. Talk and queue: the state machine (build this first)

The server owns the floor (spec 6). The client only shows what the server says and sends intents. One control, the **Talk button**, sits next to the chat input. A **floor bar** at the top of the chat shows the floor state to everyone.

### 1a. My states

| # | State (from server state + me) | Talk control | Floor bar / alerts | Server intent |
|---|---|---|---|---|
| S0 | **Free**: nobody holds the floor | **🎙 Talk** | "The floor is free." | Tap → `floor.request` |
| S1 | **Busy, I'm not queued** | **🎙 Talk** · sub-label "You'll be #3 in line" | "🎙 Dana is talking · 0:42" + queue chips | Tap → `floor.request` |
| S2 | **Requesting** (waiting for the server, usually <1 s) | Disabled: **Asking for the floor…** | n/a | n/a |
| S3 | **Queued #n** | **Leave the line** (secondary) | "You're **#2** in line. We'll alert you when it's your turn." The number updates live | Tap → `floor.leave` |
| S4 | **My turn, not started** (granted, 15 s window) | Big primary **Start recording** with a countdown ring, "Start within 0:12", and a secondary **Pass** | Global alert: a full-width banner "**It's your turn to talk.**", a chime, and the tab title "● Your turn · Team board" | Start → begin MediaRecorder → `floor.started`. Pass → `floor.leave` |
| S5 | **Talking** (recording) | Red dot, live timer "**0:37** / 2:00", a level meter, primary **Stop and send**, secondary **Cancel** | Others see me in the floor bar | Stop → upload. Cancel → `floor.release` and the audio is discarded |
| S6 | **Sending** (upload in progress; I still hold the floor) | **Sending…** (disabled), and the timer stops | n/a | The server releases the floor when the upload is stored |
| S7 | **Send failed** | "Couldn't send your note." **Try again** / **Discard** | The floor is held for **20 s** max, then released and the note is discarded (it's still downloadable from the tab until reload: "Save a copy") | Retry → upload again |

**Transitions and timers:**
- **S0 → S5 in one tap.** When the floor is free, tapping Talk is explicit intent, so recording starts as soon as the grant arrives. No second tap.
- **S3 → S4** happens when the server grants the floor, never on a client timer.
- **S4 timeout (15 s, server-timed):** back to S3 at the end of the line, with a notice: "You missed your turn, so you've moved to the back of the line (#4)." Spec 6 says skipped people go to the back.
- **S5 cap:**
  - At 1:45 the timer turns amber with "15 s left".
  - At 2:00 recording stops and **sends automatically**, with a notice: "Reached the 2-minute limit, so your note was sent."
- **Disconnect** while in S3–S6: the server drops me from the line or releases the floor (spec). On reconnect: "You were disconnected, so you lost your place." Return to S0 or S1. A recording that was in progress is discarded, with the notice "Your recording wasn't sent."
- **Admin skips me while in S4 or S5:** "The admin ended your turn. Your recording wasn't sent." Return to S0 or S1.

**The microphone (do this before the turn arrives):**
- Ask for mic permission **when Talk is tapped** (in S0 or S1), not when the turn arrives, so the browser prompt doesn't eat the 15-second window.
- **Mic denied or no mic:** don't join the line. Show "**Your microphone is blocked.** Allow it in your browser's site settings, then tap Talk again." Stay in S0 or S1.
- **No recording support in the browser:** hide Talk and show "Voice notes aren't supported in this browser. You can still read and play them."
- **Safari note for @dev:** Safari records `audio/mp4` (AAC), not webm/opus. Accept both formats server-side, or Safari and iPhone users can't talk.

### 1b. The floor bar (everyone sees it)

Sticky at the top of the chat panel, and on every tab on mobile:

```
Free:   ○ The floor is free.                                  [🎙 Talk]
Busy:   ● 🎙 Dana is talking · 0:42      Next: Sam, Ana +2      [🎙 Talk · you'd be #5]
Me:     ● You're talking · 0:42 / 2:00   Next: Sam, Ana         [Stop and send] [Cancel]
Queued: ● 🎙 Dana is talking · 0:42      You're #2 in line      [Leave the line]
```

- Tapping the queue chips opens the full line, with names in order. My own entry is marked "(you)".
- The timer comes from the server's grant time, so all browsers show the same clock.
- **Admin only:**
  - **Skip** next to the speaker, with an inline confirm: "Skip Dana? Their recording won't be sent." **Skip** / **Cancel**.
  - **×** next to each queued name (no confirm; it's easy to undo by asking again).
  - **Clear the line**, with confirm: "Remove everyone from the line?"

### 1c. Accessibility for the floor

- "It's your turn to talk" goes out through an **assertive** live region. Changes to your queue position and to who's talking go out **politely**.
- The 15-second countdown is announced at 15 and 5 seconds only, never every second.
- Everything works with taps and clicks, keyboard included: Talk, Start, Stop and Cancel are real buttons. **No press-and-hold in v1.** Holding is hard for motor-impaired and screen-reader users, and it fights the queue, because you can't hold while waiting in line.
- The chime has a visible equivalent (the banner) and can be turned off (Settings).

---

## 2. Playback and read-aloud (spec 5, 6)

### 2a. A voice note in chat

```
[DR] Dana · 10:42                                              [🔊]
     ▶  ━━━━━━━━━━━━──────────  0:12 / 0:48     1×
     "Let's ship the waitlist with the final policy, then pause…"   Show more
```

- A play/pause button, a progress bar you can seek, the time, and a speed toggle (1× / 1.5×).
- **The transcript sits under the player.** It's collapsed after 3 lines, with **Show more**.
  - Transcript states:
    - "Transcribing…": muted text with a subtle animation.
    - The transcript text.
    - "Transcript unavailable." (with **Try again** for the admin)
  - The transcript is what agents read, so make it the first-class text: it's searchable and selectable.

### 2b. One playback lane, never overlapping

- All audio, both voice notes and read-aloud speech, goes through **one playback lane per browser**.
- **Playing a note by hand** stops whatever is playing and plays that one.
- **Auto-play** (Settings: "**Play new voice notes automatically**", **default off**) queues new notes in arrival order and plays them one after another.
- **Read agent replies aloud** (Settings, **default off**) queues agent text replies through speechSynthesis in the same lane.
- **While I'm in S4–S6, the lane pauses and resumes afterwards.** Otherwise auto-play leaks into my microphone.
- **Now-playing strip** (above the chat input while anything plays): "▶ Dana's note · 0:12 · 2 more queued" **Stop all**.

### 2c. Read-aloud on any message

- A 🔊 button on every message (text, agent or transcript). It goes through the same lane.
- It's hidden when `speechSynthesis` isn't available.

---

## 3. Screens

### 3a. Login (`/board/login`)

- **Team board** (title) · "Sign in to your team's board."
- Email, Password, **Log in**.
- "Forgot your password? Ask the admin for a new invite link." There's no reset flow in v1.
- **Errors** (never reveal whether an email exists):
  - Wrong email or password: "That email and password don't match."
  - Locked out: "Too many attempts. Try again in 15 minutes."
  - Connection error: "Can't reach the board right now. Try again in a moment."
- Nothing else is visible logged out: no team name, no counts.

### 3b. Accept an invite (`/board/invite/<token>`)

- "**You're invited to the team board.**" "<Admin name> invited you as <email>."
- Fields:
  - Your name, which shows on the board.
  - Email, read-only.
  - Password, with the hint "At least 12 characters. A short sentence works well."
  - Confirm password.
- **Create account**, which signs you in and lands on the board.
- Expired or already used: "**This invite link has expired or was already used.** Ask the admin for a new one."

### 3c. The board (`/board/`)

The HITL board v2 layout and fixes, plus the floor, voice, a log feed and the user menu.

**Desktop (≥ 960px), two columns:**
- **Left:** Needs a human (first when it has items) → Work items → Features delivered.
- **Right:**
  - The floor bar, then tabs **Chat** | **Agent log**, each with an unread count. Chat is the default.
  - Below: Team, with the roster and online status.
- **Dock** (full width, below): Directive · Strategy.
- **Header:**
  - Title, plus the connection status ("Live" / "Reconnecting…").
  - User menu: name, **Settings**, **Log out**, **Log out of all devices**.
  - For the admin, the menu also has **People and invites** and **Agents and tokens**.

**Mobile (< 960px):**
- A bottom tab bar: **Chat** (default) · **Board** · **Log** · **Team**.
- The floor bar and the "your turn" banner are **global**. They stay visible on every tab, so a turn is never missed.

**Agent log tab** (spec 3): the blackboard entries, newest at the bottom like chat.
- Each entry has a kind chip, using the same colors as the HITL board:
  - `warn` = red
  - `ask` = amber
  - `done` = green
  - `claim` = blue
  - `obs` and `reply` = neutral
- Then the author, the time and the text, with @mentions highlighted.
- Filters: **All** · **Mentions me** · by agent · by kind.
- A `warn`, or an `ask` that @mentions a human, also adds a badge to the tab.

**Directive pinned banner** and **Needs a human**: as in HITL v2, including "Needed:".

### 3d. People and invites (admin)

- **Invite someone:** an email field → **Create invite link**.
- There's no email sender in v1, so show the link with **Copy link**: "Send this link yourself. It works once and expires in 7 days." [The 7 days is a proposal for @pm.]
- Members list: name, email, last active, and **Remove**, with the confirm "Remove Sam? They're signed out everywhere and lose access."
- Pending invites: **Revoke**.

### 3e. Agents and tokens (admin)

- The agents list: name, last seen (the time of the last `bb` call), and **Revoke token**.
- **New token for <agent>:** show it once: "**Copy this token now. You won't see it again.**", plus the `BB_URL` and `BB_TOKEN` lines to paste.
- Revoking confirms first: "Revoke dev's token? Its `bb` commands will fail until you make a new one."

### 3f. Settings (each person)

- Play new voice notes automatically (off)
- Read agent replies aloud (off)
- Chime when it's my turn (on)
- Playback speed default (1×)

These are stored per user on the server, so they follow you to any device.

---

## 4. Copy and tone

Plain and calm, like the landing page. Say what happened and what to do next. Errors never blame the person. The floor is "**the floor**" in the UI's internals only; people see "**talking**", "**your turn**" and "**the line**".

## 5. Open items

- **@pm:** how long invite links last (7 days proposed), and whether auto-play defaults to off (ux recommends off; audio that starts by itself in a shared room is jarring).
- **@dev:** the WS events the client needs (`floor.state {holder, grantedAt, queue[], myPosition}`, `floor.granted {deadline}`, `floor.skipped`, `floor.released {reason}`) and accepting audio/mp4 for Safari.
- **@qa:** the S0–S7 table is the state list for your floor tests. The new edge cases to add are a mic prompt during a turn, an upload failure while holding the floor, and auto-play paused while recording.
