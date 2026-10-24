# Open questions before the spec

Owner: pm · Updated: 2026-10-24 12:18 PT
Every answer below is provisional until the spec is approved. Each question links to the doc that raised it.

## For the user

1. **Approve the product frame**: the problem, north star and persona. See `docs/research/market-scan.md`.
2. **Freeze and report dates.** The proposal is freeze Fri Oct 30, report Sun Nov 1. A minimal build (console + local MCP + firm-hosted store) is about 1 to 1.5 dev-weeks (`docs/dev/feasibility.md` §7). Pick one:
   - **(a)** Allow a minimal build to start now.
   - **(b)** Move the dates.
3. **Time-on-task session date.** It must come after enough real source chats exist, so it's tied to your answer to #2.
4. **Speed claim threshold T**, the median time saved on the chosen workflow. qa proposes 30% (`docs/qa/time-on-task.md`).

## For Raj (one conversation)

1. Which AI tools is the team **allowed** to use for work? Is it via an internal Fidelity gateway?
2. Which **clients** do they use: web, desktop (Claude Desktop, ChatGPT desktop), or IDE (VS Code/Copilot, Claude Code, Cursor)? Desktop and IDE clients can reach a firm-hosted memory store with no firewall change. Web clients can't. This is the biggest schedule swing.
3. Installing on laptops needs two approvals:
   - Can IT approve installing our small local connector on managed laptops (e.g. via Intune or Jamf)?
   - Can the AI client's admin allowlist it (e.g. a Claude Desktop extension)?
   - Can endpoint management push the connector to the team's laptops? Then each teammate only signs in, which is the surest way to make setup under 10 minutes.

   Both are needed for under-10-minute setup (`docs/devops/env-plan.md` §1.1).
4. Does Fidelity already archive AI chats, and with which vendor (Smarsh, Global Relay, Purview)?
5. Which identity provider handles sign-in (Okta, Entra)?
6. Could the memory store be hosted inside Fidelity, and who approves that? Attach the 10-item IT checklist in `docs/devops/env-plan.md` §1.2.
   - Does IT offer a managed database, and can its backup retention be set to 14 days? If IT keeps backups 30 to 90+ days, deletion needs crypto-shredding instead (§6.1).
7. Which recurring workflow would show a time saving? ux leans toward W1 (answering a recurring "why/how do we…" question) or W2 (getting a new or rotating teammate unstuck). The selection criteria are in `docs/ux/task-design.md` §1.
8. Is the team willing to keep a shared question sheet starting now? This is source A for the test set.

## For compliance (through Raj)

1. Can a memory derived from one person's chat be visible to the whole team once it's reviewed? The source chat keeps its own permissions.
2. What must never be saved (client data, account numbers, MNPI, other)? Who maintains the block list?
3. What are the retention periods per classification?
4. Deleted content can stay in backups for up to 15 days. Is that OK, or is immediate removal (crypto-shredding) required?
5. Do review notes count as supervisory records under FINRA 3110? If so, they must be kept separately and longer.
6. When a memory is deleted, may we keep a content fingerprint as proof of deletion?
7. Legal holds: is a matter reference enough in our system, with matter names kept in compliance's own system?
8. Are the reason codes for Send back, Reject and Flag fine enough?
9. Does timing individual people for the speed test need consent? The proposal is consent, pseudonymous codes, data kept on Fidelity's side, and aggregate-only reporting.
10. Is a "locator" (tool + user + time, resolvable in the firm's archive) acceptable as the link to the source chat when a tool has no stable chat URL?
11. How long must the audit log be kept, and which tamper-proof (WORM) option: the firm's archive, object lock, or a hash chain? The audit log names who did what; how does that square with GDPR erasure? (`docs/devops/env-plan.md` §6)
12. **Vendor memory copies.** Once a memory is retrieved into ChatGPT, Claude or Copilot, that tool's own built-in memory may keep a copy that our deletion and legal-hold controls can't reach. The proposed answer combines:
    - **(a)** turning vendor memory off for pilot users wherever the admin can (dev is checking this);
    - **(b)** every result telling the AI not to save it to its own memory (best effort);
    - **(c)** documenting what's left as a known gap.

    Is that acceptable?
13. **Crypto-shredding.** It's needed only if IT can't set database backups to 14 days, or if compliance wants deletion to be immediate. It costs a dependency on the firm's key management service (KMS) plus 2–3 dev days (`docs/dev/feasibility.md` §5.5).

## Decided by pm (provisional)

- **Source link:** both. A locator (tool, client, user, time) is always recorded, plus a URL where the tool has a stable one. A save never fails for a missing URL.
- **Usage metrics:** a daily distinct count of active members, using a salt discarded at midnight (env-plan §4, option b). The report figure is **median daily active** (env-plan §4, option b1): an in-memory salt, dropped daily. Not chosen: b2, distinct users over the whole pilot. The count is **never shown on the lead's console panel**: in a team of 4 to 6, it effectively scores individuals. It appears only as one aggregate figure for the whole pilot in the end-of-pilot report. Raw usage events are kept for the pilot plus 30 days. The optional events `search_empty`, `sent_back`, `rejected` and `deleted` are all included as counts only.
- **Time-on-task format:** a scheduled session (A), not measured in the wild (B). A controlled session gives a clean comparison with only 4 to 6 people.
- **Crypto-shredding:** conditional (see compliance 13). Build it only if IT can't do 14-day backups, or compliance requires immediate deletion.
- **Vendor memory:** (b) ships regardless, (a) is used where admins can turn vendor memory off per user, and (c) documents what's left, pending compliance 12.
