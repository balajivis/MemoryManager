# Core flows: governed team memory

Owner: ux · Status: **DRAFT v2** (spec phase, nothing approved) · Date: 2026-10-24
v2 folds in the PM's provisional answers to the open questions (blackboard, 12:04:38 and 12:14:28), dev's v1 MCP tool set, and devops's audit-log rule. See the "Decisions so far" section at the end.
Inputs: [market scan](../research/market-scan.md), PM's ask of 2026-10-24 11:58:41 on the blackboard.
Persona: **the governed AI team lead** (proposed, not yet approved). The users are the lead and the team. The AI platform team and compliance approve.

Text and wireframe level only. Every name, number and tool name here is illustrative. The PM's spec owns scope, and dev owns the interfaces.

---

## Foundations

### Roles in these flows

| Role | Who | Main surface |
|---|---|---|
| **Contributor** | Any team member who learns something in an AI chat | Inside their AI tool |
| **Reviewer** | The team lead, or a teammate the lead delegates to | Web console (notices by email or Teams) |
| **Teammate** | Anyone on the team asking their AI tool a question | Inside their AI tool |
| **Records admin** | Compliance, records management, or the AI platform team | Web console only |

### Design principles

1. **Saving is cheap and sharing is deliberate.** Anyone can propose a memory in one step. Nothing reaches a teammate's AI tool until a human reviewer approves it.
2. **Save the learning, not the chat.** A memory is a short statement of 1 to 3 sentences that links to its source chat and doesn't copy it. That keeps records and PII small, which market-scan implication #4 calls for.
3. **Every memory shows where it came from and how old it is**: on every surface, in every result, and in the AI's answer.
4. **Governance is visible but stays out of the way.** Contributors never pick a retention schedule. It follows from the classification. Admins see everything.
5. **No per-person scoring.** No leaderboards, no "top contributors", no per-person counts on any dashboard. Team-level counts only (market-scan implication #5). The audit log names actors because it is a record, not a metric.
6. **A human approves, never the AI.** An AI tool may draft, search and flag. Approving, deleting and placing holds always need a deliberate human action that the AI can't perform on someone's behalf.
7. **The surface follows the job.** Contributors and teammates stay in their AI tool. Reviewers and admins use the console, where there is room for the source, the history and the controls.

### Memory lifecycle

```
                 send back (with note)
               ┌──────────────────────┐
               ▼                      │
 [Draft] ──► [Pending review] ──► [Shared] ──► [Due for review] ──► [Retired / Superseded]
   │               │                 ▲               │                      │
   │ cancel        │ reject          └── re-confirm ─┘                      │ retention ends
   ▼               ▼                                                        ▼
 (gone,       [Rejected]  ── retention ends ───────────────────────────► [Deleted]
 no record)   (kept for audit,                                          (tombstone: ID, dates,
               never retrieved)                                          reason; no content)

 [On legal hold] sits on top of any state from Pending onward, like [Flagged] sits on Shared. It blocks deletion and expiry,
 not retrieval. Releasing the hold restores the normal schedule.
```

Only **Shared**, **Due for review** and **Flagged** memories are ever returned to an AI tool. The last two come back with a warning. **Flagged** is an overlay on Shared: a teammate said it may be wrong, and it's back in the queue (Flow 2b).

**Edits make versions** (Q8): editing a Shared memory creates a new version in Pending review. The approved version stays Shared and keeps being returned until the reviewer shares the new version, which makes the old one Superseded.

### Surface options (these depend on Raj's answer, so none is picked here)

| | Option | When it applies | Contributor and teammate | Reviewer | Admin |
|---|---|---|---|---|---|
| **S1a** | In-tool via a **local** MCP client plus console | Desktop or IDE clients that run the MCP link on the user's machine and reach a firm-network server: Claude Desktop *extensions*, Claude Code, ChatGPT desktop (stdio), VS Code/GitHub Copilot, probably Cursor | In-tool | Console (notices by email or Teams) | Console |
| **S1b** | In-tool via a **cloud** connector plus console | ChatGPT Enterprise apps, claude.ai connectors, Copilot Studio. They call our server from the vendor's cloud, so it needs a vendor tunnel or an inbound firewall opening, which security must approve (dev, 12:09:52) | In-tool | Console (notices by email or Teams) | Console |
| **S2** | Gateway-integrated plus console | The firm routes AI through one internal gateway (the unconfirmed "AI Control Plane") and we plug in there | In-tool, through the gateway's own UI or tooling | Console | Console |
| **S3** | Archive or export-fed plus console | We can read the compliance export or archive but can't add anything to the AI tools | Console: propose by hand, picking the source chat from the archive so the link is verified; copy a "context pack" into the AI tool | Console | Console |
| **S4** | Console only, by hand | Nothing can connect | Console: paste a learning plus the chat link; copy a context pack out | Console | Console |

The flows below are written for **S1** (S1a and S1b behave the same once connected; the richest case). Each one notes what changes under S2, S3 and S4. S1a and S1b differ mainly in **setup** (Flow 0).

**MCP constraints that shape the in-tool design:** most clients render a tool result as plain text, so the in-tool "UI" is the text the tool returns and how the tool description tells the AI to relay it. Client support for MCP elicitation (a server asking the user directly for input) varies. Where it exists, we use it for confirmations. Where it doesn't, the AI asks in chat. That is why nothing irreversible happens in-tool (principle 6).

---

## Flow 0: Connect your AI tool (setup)

**Goal:** a teammate goes from "the lead says we're trying this" to the first successful search in **under 10 minutes**, with no help desk ticket. Adoption over two weeks depends on it. Not one of the PM's four flows, but without it none of them happen.

| Step | S1a: local client (per person) | S1b: cloud connector (admin, once) |
|---|---|---|
| 1. Who acts | Each teammate | The firm's AI tool admin enables it once for the team. Teammates just see it appear |
| 2. Install | Open the console → **Connect a tool** → pick the client → one-click install (Claude Desktop extension, once an admin has allowlisted it) or a copy-paste config block with the firm's server address already filled in (Claude Code, VS Code). Packaging this is part of dev's P2 build | Admin adds the connector and scopes it to the team (most clients let admins restrict which connectors exist) |
| 3. Sign in | Firm SSO in the browser, the same identity the console uses. Team membership comes from the identity provider | Teammate authorizes the connector once with firm SSO |
| 4. Check it works | The console shows **"Connected: Claude Desktop · last used just now"** after the first call. Suggested first prompt: *"Check team memory: what's our team's newest memory?"* | Same |
| 5. If it fails | Plain-language checks in the console: not on the firm network/VPN, SSO expired, client version too old. Each with a fix | Admin-side status page, plus "ask your admin" copy for teammates |

**Before the pilot (S1a), two separate approvals** (devops env-plan §1.1, §1.2), or the 10-minute goal can't hold:
1. The firm's **endpoint management** (e.g. Intune or Jamf) approves installing our local component on managed laptops, and ideally pushes it, so teammates don't install anything themselves.
2. The **AI client's admin** allowlists our MCP server or extension.

If IT pushes the component, Flow 0 shrinks to steps 3 and 4: sign in and check. In step 3, the sign-in token goes into the OS keychain. If the OS shows a keychain prompt, the setup page explains it ahead of time ("Your Mac will ask to store a sign-in key. Choose Always Allow").

Rules:
- **Setup shows team scope up front:** "You'll see memories shared with *Fund Ops PMs*. Your proposals go to your reviewer first." People learn the governance model in one line, before they use it.
- **One teammate per client type does a test run first** (the same idea as the task-design pilot), so issues get found before the whole team tries.
- The console's **Connected tools** list belongs to each person (their own tools, last used). There is no team-wide view of who connected, per principle 5.

---

## Flow 1: A contributor saves a learning to team memory

**Goal:** turn something the contributor just learned in a chat into a proposed memory in under 30 seconds, without leaving the chat.

### Entry points

| Entry | Surface | Notes |
|---|---|---|
| **1A. Ask in chat** ("save that to team memory") | S1, S2 | The default path. The AI calls the proposed `propose_memory` tool *only* when the user asks. The tool description says so. |
| ~~1B. Confirm a suggestion~~ | **Out of v1** (PM Q4) | Saving is explicit only. If suggestions ever come back, they are opt-in per person, and the author confirms each one. |
| **1C. Propose in console** | S3, S4 (available under every option) | A form for the statement, the source chat, the tool, and the chat date. Under S3 the contributor picks the chat from the archive, so the link is verified. Under S4 they paste a link or reference, and we can't check it. |

### Steps (1A)

1. The contributor asks: *"Save to team memory: the fact-sheet feed refreshes T+1 at 6am ET."* Or just *"save what we figured out about the feed."*
2. The AI drafts the memory: a **statement** (1 to 3 sentences), an optional **why it matters**, suggested **tags**, and a suggested **classification**. The server runs PII detection and redacts by default.
3. The AI shows the **exact text** that will be saved and asks the contributor to confirm, through elicitation where supported and in chat otherwise.
4. On "yes", the memory is created as **Pending review** and the tool returns a receipt.
5. The reviewer gets a notice (Flow 2). The contributor's work is done.

### In-tool wireframe (S1, text result)

Confirmation (step 3):

```
Team memory · ready to propose

  "The fund fact-sheet data feed refreshes T+1 at 6:00am ET. Dashboards
   viewed before 6am show the prior day's NAV."

  Why it matters: explains the 'stale NAV' reports from the London desk.
  Tags: data-feeds, fact-sheets     Classification: General team knowledge
  Source: this chat (Claude, Oct 24, 2026, 11:42 ET). It is referenced, not copied.
  Add this chat's link? Paste it here (optional, makes it one click for reviewers).
  Redacted: 1 item (an email address) → [email removed]

  This goes to your team's reviewer before anyone else sees it.
  Save as written?  yes · edit · cancel
```

Receipt (step 4):

```
Proposed to team memory as M-151 · Pending review
Reviewer: Dana Ruiz (team lead). You'll hear back when it's shared or sent back.
Track it: https://<console>/m/M-151
```

### The source link (dev feasibility §1, §5.2)

The AI inside a chat doesn't know its own conversation URL, and MCP calls carry no conversation ID. So `propose_memory` can't link the chat by itself. Options for the spec (qa C1 has a pass test for each one):

| Option | What the contributor does | What reviewers and teammates get |
|---|---|---|
| **Locator only** | Nothing | "Claude chat by Sam Patel, Oct 24, 11:42 ET", plus **Find in archive** for people with archive access. Works for every tool |
| **URL only** | Pastes the chat URL every time | One click to the chat, but it costs effort on every save and only works in tools with stable URLs (Claude, ChatGPT; Copilot and Gemini have none documented) |
| **Both**: **PM decision, provisional (12:14:28)** | Nothing required. The confirmation offers an *optional* paste where the tool has stable URLs | The locator always, plus one click when a URL was given |

Rules either way: **never block a save on a missing URL** (it would kill the 30-second goal), and never ask for a URL in tools that don't have stable ones.

### Edge cases

| Case | What the contributor sees |
|---|---|
| **Near-duplicate** of an existing memory | "Looks like M-097 already says this: '…'. **Add this chat as another source for M-097**, **propose as an update to M-097**, or **save as new**?" |
| **Contradicts** a shared memory | Saving still works. The receipt says: "This conflicts with M-088. Your reviewer will decide which one stands." The reviewer sees both side by side. |
| **PII found** | Redacted by default and listed in the confirmation. The contributor can remove more but **can't un-redact**. Only the reviewer can restore an item, with a reason that is logged. |
| **Restricted content** (client data, MNPI, or anything the classifier blocks) | "This can't be saved to team memory because it looks like it contains client information. Rewrite it without client details, or ask your reviewer." No draft is kept. Blocked in v1 (PM Q3, compliance to confirm): client data and client PII, account numbers, MNPI. Compliance owns a configurable block list. |
| **The AI calls `propose_memory` without being asked** | The confirmation step still runs. Nothing is created without the contributor's yes. |
| **Contributor cancels** | Nothing is stored. No record, because it was never proposed. |

### Changes by option
- **S2:** same steps if the gateway exposes tools. If the gateway has its own "save" UI, we only define the payload.
- **S3:** the console form (1C), with a chat picker that searches the contributor's own chats in the archive. They choose the chat and write the learning; nothing is suggested to them.
- **S4:** the console form only. The "source chat" is a link or reference the contributor pastes, and we can't check it.

---

## Flow 2: The reviewer approves a memory before it's shared

**Goal:** the reviewer can decide on a typical memory in under a minute and trust that the decision is recorded.

### Steps

1. **Notice.** The reviewer gets a digest by email or Teams (channel TBD) with a console link: "3 memories waiting for review · oldest 2 days."
2. **Queue.** The console's review queue lists Pending items, oldest first, with flags (conflict, PII restored, near-duplicate, sent back before).
3. **Review card.** The reviewer reads the statement, opens the source chat if needed, and checks the flags.
4. **Decide.** One of four actions:
   - **Share with team** (optionally edit first). Sets a **review-by date**, 90 days by default for every memory in v1.
   - **Send back** with a reason code and an optional note → the contributor sees both and can edit and resubmit.
   - **Reject** with a reason code and an optional note → kept as Rejected for audit, never retrieved.
   - **Merge** into an existing memory (for near-duplicates) → the source is added to that memory.
5. **Confirmation.** "M-151 is now shared with Fund Ops PMs. It will ask for review on Jan 22, 2027."

### Rules
- **No self-approval** (PM Q5). Nobody approves their own memory. The lead or a delegated reviewer reviews teammates' memories, and **any other teammate** can review the lead's memories. In the console, the lead's own proposals appear in every teammate's queue under "From your lead".
- **Approval happens only in the console** (principle 6, adopted as a spec rule). The v1 MCP tools are `search_memory`, `get_memory`, `propose_memory` (creates Pending only) and `flag_memory` (dev feasibility). There is no review tool in-tool, not even a read-only one. Reviewers reach the queue from the notice link.
- **Reason codes, not free text, go in the audit log** (devops env-plan §3). The optional note is stored with that memory version and deleted with it, so the audit log stays content-free.
  - *Send back:* Unclear wording · Needs a better source · Too long, split it · Remove a sensitive detail · Other
  - *Reject:* Not team knowledge · Inaccurate · Duplicate · Restricted content · Too temporary to keep · Other
- **Stale queue.** Items Pending for 14 days nudge the reviewer once. At 30 days they move to "Expired unreviewed" and the contributor is told. Nothing is shared by default.

### Console wireframe: review card

```
┌ Review queue (3) ─────────────────────────────────────────────────────────────┐
│ ● M-151  Fact-sheet feed refresh time          Sam Patel · 2d   ⚑ near-dup    │
│   M-152  Pricing sign-off threshold            Ana Chen · 1d    ⚑ conflict    │
│   M-153  Where the Q3 board deck template lives Ana Chen · 4h                 │
└───────────────────────────────────────────────────────────────────────────────┘

┌ M-151 · Pending review ───────────────────────────────────────────────────────┐
│ "The fund fact-sheet data feed refreshes T+1 at 6:00am ET. Dashboards viewed  │
│  before 6am show the prior day's NAV."                                [Edit]  │
│                                                                               │
│ Why it matters   Explains the 'stale NAV' reports from the London desk.       │
│ Proposed by      Sam Patel · Oct 24, 2026                                     │
│ Source           Claude chat · Oct 24, 2026 11:42 · [Open source chat ↗]      │
│                  (locator only? → [Find in archive ↗] instead)                │
│ Classification   General team knowledge  → retention: <schedule A>  [Change]  │
│ Redactions       1 (email address)                          [View] [Restore…] │
│ Tags             data-feeds, fact-sheets                                      │
│                                                                               │
│ ⚑ Similar to M-097 "NAV data lands overnight" (shared Aug 2, 2026)            │
│   [Compare]  [Merge into M-097]                                               │
│                                                                               │
│ Review by  [ Jan 22, 2027 ▾ ]   Share with  Fund Ops PMs (this team only)     │
│                                                                               │
│ [ Share with team ]   [ Send back… ]   [ Reject… ]                            │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Changes by option
- **S1 to S4:** the same, since the console is the reviewer's surface everywhere. Only the notice channel differs.

### 2b. Re-review: edits, flags and due dates

Three things send a Shared memory back to the queue. In every case **the approved version stays live** until the reviewer decides (PM Q8).

| Trigger | Who starts it | What the reviewer sees | Actions |
|---|---|---|---|
| **Edit** | The author or a reviewer proposes a change (console, or `propose_memory` as an update in-tool) | A diff between the live version and the proposed one. Every edit is a new version, with no typo shortcut in v1 | Share new version (replaces the live one; the old one becomes Superseded) · Send back · Reject (the live version is unchanged) |
| **Flag** | A teammate says it's wrong or outdated (`flag_memory`) | The flag reason code, and when and in which tool the flag was raised. Also **who flagged**, so they can follow up (PM, provisional) | Re-confirm (resets review-by and clears the flag) · Edit · Retire |
| **Due for review** | The 90-day review-by date passes | The memory plus how often it was retrieved since sharing (a team count, not per person) | Re-confirm (another 90 days) · Edit · Retire |

```
┌ M-097 · Due for review ─────────────────────────────── live since Aug 2, 2026 ┐
│ Live    "NAV data lands overnight from the custodian."                        │
│ Edit    "NAV data lands overnight from the custodian; the fact-sheet feed     │
│ (v2)     picks it up T+1 at 6:00am ET."                  proposed by S. Patel │
│ Also    ⚑ Flagged Oct 21 · "Outdated" · from ChatGPT                          │
│                                                                               │
│ [ Share v2 ]   [ Re-confirm v1 as is ]   [ Send back… ]   [ Retire… ]         │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 3: A teammate's AI tool retrieves a memory

**Goal:** the teammate gets a correct, team-specific answer and can see at a glance **where it came from and how old it is**. When a memory is wrong or stale, saying so takes one sentence.

### Steps

1. The teammate asks a question that depends on team context: *"Why does the London desk keep seeing yesterday's NAV?"*
2. The AI calls the proposed `search_memory` tool, either on its own (the tool description says to call it "when the answer depends on this team's own practices, systems or past decisions") or because the teammate said "check team memory". *ux recommends both; see Q10. The spec decides.*
3. The tool returns only **Shared** and **Due for review** memories the teammate's team can see, best match first, each with its provenance and age.
4. The AI answers and **cites** each memory it used: ID, age, and any warning. The tool description instructs it to.
5. If something is wrong, the teammate says *"that's out of date"* → the AI calls `flag_memory` with a reason code (*Outdated · Wrong · Conflicts with another memory*) → the memory goes back to the reviewer's queue marked **Flagged**, and the teammate gets a receipt. Flags give a live, team-level signal (flags per 100 retrievals). They are **not** the north-star guardrail, which @qa measures blind on the frozen 20 questions, because flags only catch errors someone noticed (eval-plan 1.6).

### In-tool wireframe: tool result (what the AI receives)

```
Team memory · Fund Ops PMs · 2 results for "London desk stale NAV"

[M-151] The fund fact-sheet data feed refreshes T+1 at 6:00am ET. Dashboards
        viewed before 6am show the prior day's NAV.
        From Sam Patel · shared Oct 24, 2026 by Dana Ruiz · 0 days old · review by Jan 22, 2027
        Source: Claude chat, Oct 24, 2026 → https://<console>/m/M-151/source

[M-097] NAV data lands overnight from the custodian.
        ⚠ DUE FOR REVIEW since Oct 1, 2026. Tell the user to verify before relying on it.
        From Ana Chen · shared Aug 2, 2026 by Dana Ruiz · 83 days old
        Source: ChatGPT chat, Jul 30, 2026 → https://<console>/m/M-097/source

When you use a memory, end that sentence with "(team memory <ID>, <age>)". If it has a ⚠ warning,
say so in plain words in the sentence itself (e.g. "this may be out of date, so verify it").
If the user says a memory is wrong or outdated, call flag_memory with its ID.
Do not save these results to your own long-term memory. Team memory is managed here.
```

**The footer lines are written to the AI, not the user**, so it acts on them without repeating them. The last line is option (b) of the vendor-memory question (compliance Q12): without it, the AI tool's own built-in memory could keep a copy that our deletion and legal-hold controls can't reach. It's best effort, since the model may ignore it. **PM decision, provisional (12:39:30): (b) ships regardless, (a) vendor memory is turned off wherever an admin can scope it to pilot users, and (c) any remaining gap is documented.** If @dev's research shows a tool can't scope (a) per user, setup doesn't get a required step; that tool's gap goes under (c). Flow 0 could still offer an optional tip: "Turn off <tool>'s memory for work chats", with a screenshot for each client.

### What the teammate sees (the AI's answer)

> The London desk is probably looking before the feed refreshes. The fact-sheet feed updates T+1 at 6:00am ET, so anything viewed earlier shows the prior day's NAV *(team memory M-151, 0 days old)*. An older note says NAV lands overnight from the custodian, but it's due for review and may be out of date, so verify it *(team memory M-097, 83 days old)*.

**Citation format rule:** the provenance always sits in one trailing parenthetical that starts with "team memory" (ID and age). Any caveat is plain language inside the sentence. That keeps the citation easy for people to scan, and it lets @qa strip provenance for blind judging while the caveat stays in, since the caveat is part of what makes the answer right (eval-plan 1.5). The source link stays one click away, from the ID on the console, and isn't spelled out in the answer.

### Display rules for age and status

| Memory state | Returned? | How it's labeled |
|---|---|---|
| Shared, inside its review-by date | Yes | "Shared <date> · <n> days old" |
| Due for review (past its review-by date) | Yes, ranked lower | "⚠ Due for review since <date>. Verify before relying on it." |
| Flagged by a teammate, not yet re-reviewed | Yes, ranked lower | "⚠ Flagged as possibly outdated on <date>." |
| Superseded | No (the newer memory is returned instead) | The newer memory says "Replaces M-0xx". |
| Pending, Rejected, Retired, Deleted | Never | |

### Edge cases

| Case | Behavior |
|---|---|
| **No match** | The tool returns "No team memory on this." The AI answers from general knowledge and, if the teammate works something out, may *offer* to save it (Flow 1, only with the user's yes). |
| **The teammate can't open the source chat** (it belongs to someone else) | The link opens a page that says: "The original chat belongs to Sam Patel and isn't shared. This memory was reviewed and shared with your team on Oct 24, 2026." Per Q2, the chat's permission doesn't gate the memory. The memory follows its share scope. |
| **Two memories conflict** | Both are returned, and the result says "These two disagree. M-088 is newer." The AI must tell the user about the conflict and not quietly pick one. |
| **Memory on legal hold** | Retrieval is unaffected. Holds stop deletion, not use. No hold badge appears in-tool (a hold is confidential to compliance). |

### Changes by option
- **S2:** the same, if the gateway injects memory as a tool result or context. Citation then depends on the gateway passing our provenance text through unchanged. That must be a requirement on the integration.
- **S3 and S4:** no live retrieval. The console has **Search** (the same result cards) and **Copy context pack**: a block of selected memories, with IDs, ages and warnings already in the text, for pasting into any AI tool. Flagging happens in the console.

---

## Flow 4: An admin views retention, legal hold and deletion history

**Goal:** a records admin can answer an examiner's question ("show me what this team's memory held on date X, what was deleted, and why") from one place, and export the proof.

The console is the only surface. In-tool, these actions don't exist (principle 6).

### 4a. Retention

```
┌ Admin · Retention ─────────────────────────────────────────────────────────────┐
│ Policy by classification                         (values set by compliance)    │
│   General team knowledge     <schedule A>    412 memories                      │
│   Client-adjacent process    <schedule B>     38 memories                      │
│   Rejected proposals         <schedule C>     21 records                       │
│                                                                                │
│ Expiring in next 30 days (14)                                  [Export CSV]    │
│   M-012  "Old CRM export steps"     expires Nov 3, 2026    Retire early · Hold │
│   …                                                                            │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Every memory's detail page shows its classification, schedule and expiry date.
- Changing a policy shows a preview first ("This changes the expiry date of 412 memories") and then needs a confirmation. The change is logged.

### 4b. Legal hold

Steps:
1. **New hold** → matter reference (no matter name, per Q-new-3), scope (team, contributor, date range, tags, keyword).
2. **Preview:** "This hold covers 57 memories and 9 rejected records." The admin can open the list.
3. **Apply** (with a typed confirmation) → every memory in scope gets **On legal hold**. Deletion and expiry stop for them.
4. **Release** later, with a reason → the normal schedules resume, and anything already past its expiry is queued for deletion review, not deleted at once.

```
┌ Admin · Legal holds ───────────────────────────────────────────────────────────┐
│ ● Matter ref 2026-117                          Active since Oct 20   57 memories │
│   Scope: team Fund Ops PMs · Jun 1 – Sep 30, 2026 · tag: fees                  │
│   Placed by J. Okafor (Compliance)                    [View items] [Release…]  │
│                                                                                │
│ [ + New hold ]                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

Wherever a held memory's delete action appears (detail page, reviewer actions, deletion requests), it is disabled and says: **"Can't delete: on legal hold (Matter 2026-117). Contact Compliance."**

### 4c. Deletion requests and history

- **Requests** come from contributors ("remove my memory"), reviewers (retire), the retention schedule, or erasure requests (GDPR). Each one shows up in a **Deletion requests** list with its basis.
- When nothing blocks it, **Delete** leaves a **tombstone**: ID, created, shared and deleted dates, actor, and basis. No content and no content hash (PM Q11, pending compliance).
- **Deletion history** is append-only, filterable, and exportable (CSV or PDF) for an exam.

```
┌ Admin · Deletion history ──────────────────────────────── [Filter] [Export] ──┐
│ When              Memory  Event             Actor          Basis               │
│ Oct 22 14:03 ET   M-044   Deleted           system         Retention expired   │
│ Oct 21 09:12 ET   M-131   Delete BLOCKED    S. Patel       On hold 2026-117    │
│ Oct 19 16:40 ET   M-120   Deleted           D. Ruiz        Erasure request     │
│ Oct 18 11:05 ET   M-102   Retired           D. Ruiz        Superseded by M-140 │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Team usage panel (optional, for the two-week proof)

The lead's console home can show **team-level counts only**: proposed, shared, retrieved and flagged this week. No per-person breakdown. This lines up with @devops's "counts and events only" logging and gives Raj the usage evidence without any per-employee scoring.

**No "active members" count on the panel.** In a 4 to 6 person team, "4 of 5 active" tells the lead exactly who isn't using it, which is per-person scoring by another name (principle 5). If @pm wants the number for the proof (devops env-plan §4, option b), it goes only in the end-of-pilot report, as one figure for the whole two weeks, not daily or weekly.

---

## Console screen inventory (all options)

| Screen | Who | Flow |
|---|---|---|
| Home (queue count, team usage panel) | Reviewer, lead | 2, 4 |
| Connect a tool and my connected tools | Everyone | 0 |
| Review queue and review card | Reviewer | 2 |
| My proposals (status, sent-back notes) | Contributor | 1 |
| Propose a memory (form) | Contributor | 1C |
| Search and memory detail (with source link, history, version) | Everyone with team access | 3 |
| Copy context pack | Teammate | 3 (S3, S4) |
| Admin: Retention, Legal holds, Deletion requests, Deletion history | Records admin | 4 |
| Settings: team members, reviewers and delegation (permissions inherited from the identity provider) | Lead, admin | all |

## Status labels and core microcopy

| Label | Meaning |
|---|---|
| **Pending review** | Proposed. Nobody but the contributor and the reviewers can see it. |
| **Sent back** | The reviewer asked for changes. The note is shown. |
| **Shared with team** | Approved. Returned to teammates' AI tools. |
| **Due for review** | Past its review-by date. Still returned, with a warning. |
| **Flagged** | A teammate said it may be wrong or outdated. It's back in the queue. |
| **Superseded** | Replaced by a newer memory. Not returned. |
| **Rejected** | Not shared. Kept only as a record. |
| **On legal hold** | Can't be deleted or expire. Shown to admins and reviewers only. |
| **Deleted** | Content removed. A tombstone stays in the history. |

Tone: plain, specific and calm. Say what happened, what it means for the person, and what they can do next. Never say only "Error" or "Not allowed".

---

## Decisions so far (PM, PROVISIONAL until the spec; blackboard 12:04:38)

(C) = compliance must still confirm, through the user.

| # | Question | Decision | Where it shows up |
|---|---|---|---|
| Q1 | Show the author? | **Yes.** Teammates see both the author and the reviewer | Flow 3 result, console search |
| Q2 (C) | Source permission vs. team sharing | **The source chat keeps its own permissions. The memory is visible only to the scope it was shared with** | Flow 3 edge cases, qa C5.3 |
| Q3 (C) | What can't be saved? | **Client data and client PII, account numbers, MNPI.** Redaction plus a configurable block list owned by compliance | Flow 1 edge cases |
| Q4 | Suggested capture | **Out of v1.** Saving is explicit only | Flow 1 (1B struck), S3 |
| Q5 | The lead's own memories | **No self-approval.** Any other teammate can review the lead's memories | Flow 2 rules, qa C2.6 |
| Q6 (C) | Retention values | Placeholders <schedule A/B/C> until compliance sets them | Flow 4a |
| Q7 | Review-by default | **90 days, the same for every memory** in v1 | Flow 2, 2b |
| Q8 | Edits after sharing | **Every edit is a new version that needs re-review.** The approved version stays live meanwhile. No typo shortcut | Flow 2b, qa C2.5 |
| Q9 | Scope in v1 | **One team only** | Flow 2 review card |
| Q10 | Retrieval trigger | **Both**: automatic by default, plus explicit "check team memory". The eval tests the default | Flow 3, eval-plan 1.3 |
| Q11 (C) | Tombstone content hash | **No hash by default**: ID, timestamps, actor, reason only | Flow 4c |
| Rule | Irreversible actions | **The AI can draft, search and flag. Approve, delete and legal hold happen only in the console** | Principle 6, Flow 2, qa C2.7 |
| Rule | Reviewer notes | **Reason codes go in the audit log. Free-text notes live with the memory version and are deleted with it** (devops env-plan §3) | Flow 2 rules |
| Q-new-1 | Reason code lists | **Accepted for v1.** Compliance is asked whether it needs finer codes | Flow 2 rules, 2b |
| Q-new-2 | Who flagged? | **Shown to the reviewer.** Usage events stay user-free | Flow 2b |
| Q-new-3 | Legal hold names | **Matter reference only** in the console and audit log. Names stay in compliance's own system | Flow 4b |
| Source link | Locator vs. URL | **Both**: a locator on every memory automatically, plus the URL where the tool has stable links. Whether a locator alone counts as "link to source chat" is compliance question #10 | Flow 1 source link, qa C1 |

All open questions now live in [docs/pm/open-questions.md](../pm/open-questions.md). ux sends new ones to @pm instead of listing them here.

## Next from ux (once the spec and Raj's answer land)
- Pick the surface option and cut the flows down to it, Flow 0 setup included.
- Click-through wireframes of the console screens above.
- Exact tool descriptions and result templates for the in-tool surface, written with @dev, since that text *is* the in-tool UI.
- A usability test script for Raj's team, tied to the north-star test set from @qa.
