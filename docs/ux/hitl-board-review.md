# Usability review: HITL team board

Owner: ux · For: pm (owner and publisher) · Date: 2026-10-25 · Source reviewed: `tools/hitl-board/index.html` at cb96b6f
Method: code read, plus an offline render at 1366px and at 375px in light and dark mode. The offline copy has no live data, so I reviewed the item, chat and roster states from the code.

Ranked by impact. Each item names a fix that pm can apply without a redesign.

## Must fix

**1. An empty "Directive · pinned" banner shows when nothing is pinned.** `.directive-banner { display: grid }` overrides the `hidden` attribute, so the banner never hides. Every first visit opens with an empty amber alert.
Fix: add `[hidden] { display: none !important; }` near the top of the CSS. That also protects every other element that uses `hidden`.

## High

**2. First-run join is hard to find.** A newcomer's first action is to join, but "Join the team" sits at the bottom of the Team panel: right column on desktop, sixth panel down on mobile. It's also right next to "Add agent", which reads as just as important.
Fix: while the viewer hasn't joined, show a strip under the header: "You're viewing the team board. Join to chat and take on work. [Your role] [Join the team]". Hide it once they've joined. Put "Add agent" behind a "+ Add an agent" disclosure.

**3. "Needs a human" doesn't say what the human needs to do.** An item can be marked waiting or blocked, but there's no field for the ask, so the person reading the list can't act without going to chat.
Fix: when status changes to waiting or blocked, ask for a one-line **"Needed:"** (e.g. "Needed: approve the privacy policy text"), store it on the item, and show it in bold on both the item and the Needs-a-human row. Clear it when the status goes back to working.

**4. Make "Needs a human" the most visible panel when it has items.** Right now it sits below the work list, which will grow.
Fix: when it's non-empty, render it first in the left column (first on mobile). Make the Blocked and Waiting stat tiles links to it (`#h-attn`).

**5. Info notices look like errors.** `.notice` is `--block` red, so "@pm is an external session. It will see this the next time it reads the board" reads as a failure.
Fix: neutral `--muted` for info, and red only for errors (e.g. `.notice[data-kind="error"]`). If several external agents are mentioned at once, combine them into one notice; right now each overwrites the last: "@pm and @dev are external sessions. They'll see this the next time they read the board."

**6. View-only visitors see forms that fail on submit.** With `canWrite === false`, every form still renders and only errors when used.
Fix: when view-only, hide the add, join, composer, directive and strategy forms, and show one line under the header: "View only. Ask the owner for Contributor access to join in."

## Medium

**7. The chat's `aria-live` sits on a list that's rebuilt on every snapshot.** `renderChat` empties `#msgs` and re-adds every message whenever anything changes, so screen readers can re-announce the whole chat.
Fix: remove `aria-live` from `#msgs` and announce only new messages through a separate visually hidden `role="status"` element (e.g. "pm: <first 80 characters>").

**8. Pick one name for the waiting state.** It appears as "Waiting on a human" (stat), "waiting on a human" (chip), "Needs a human" (dropdown and panel).
Fix: use **"Needs a human"** everywhere. It's shorter and tells you what to do.

**9. Empty "Features delivered" has a blank gap.** The `.features` grid keeps its padding when it's empty.
Fix: `.features:empty { display: none; }`.

**10. The "In progress" stat counts blocked and waiting items too.**
Fix: rename it **"Open"**, or count only `status === "working"`.

## Low

- The header tagline "Humans and agents, one board" gets replaced by the counts on the first render, and "HITL" is jargon for a human joining. Keep the tagline and move the counts into the Team panel header.
- "Clear" on the directive and "Save strategy" overwrite shared text with no undo. Consider keeping the previous version, with one "Restore previous" link.
- Humans can't be @mentioned. Agents asking a specific person for something would make "Needs a human" more actionable. Worth considering after #3.

## What works well

- The directive and strategy show who wrote them and when, so you can see who changed what.
- The step bar plus mono labels read clearly. Steps have aria-labels, and the ◀ ▶ buttons are labelled.
- Dark mode tokens are complete. The layout stacks cleanly at 375px with no horizontal scroll.
- Agent replies say they use the sender's account (footer), and their prompt tells them not to claim actions they can't take. That's honest.
