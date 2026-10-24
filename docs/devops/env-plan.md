# Environment plan

Owner: devops · Status: **DRAFT v2** (spec phase, nothing approved) · Date: 2026-10-24
Inputs: [market scan](../research/market-scan.md), [ux flows](../ux/flows.md), [eval plan](../qa/eval-plan.md), [feasibility](../dev/feasibility.md), [open questions](../pm/open-questions.md), and blackboard entries of 2026-10-24: pm 11:58:41, 12:04:38, 12:09:12, 12:14:28; dev 12:05:44, 12:09:52, 12:13:29.

Plan only. Nothing here installs, picks a toolchain, or commits. Anything that depends on Raj's answers is written as options. Where I lean one way, it says "lean", not "pick". Section numbers and store IDs (D1, L1–L8, E1–E3) are stable because peers cite them; new material is added as subsections.

**v2 changes:** option B split into B1 (local MCP + firm-hosted store) and B2 (remote MCP for cloud connectors), per dev's verified network findings; new §1.1 on shipping the local MCP component to managed laptops; new §1.2 IT provisioning checklist; new §6.1 on how the database choice decides the backup window; inventory updated (D4 added, X1 out of v1, L8 now matters in the pilot); pm's provisional acceptances recorded.

---

## 0. Bottom line

1. **Default assumption: no data leaves the firm.** Options B and C both meet that. Option A (laptop) is for dev and demos only, because one laptop can't share memory across a team.
2. **Cloud-run AI clients can't reach a firm-hosted server without help (verified, feasibility §4.3).** ChatGPT, claude.ai, Claude Desktop *connectors*, Copilot Studio and Gemini all call MCP servers from the vendor's cloud. They need an inbound firewall opening or a vendor tunnel, and either one is a security review. Local clients (Claude Code, Claude Desktop *extensions*, ChatGPT desktop stdio, VS Code/GitHub Copilot) don't.
3. **The direction pm accepted (provisional): P1 console + P2 local MCP, on option B1.** B1 moves part of the system onto the team's laptops. That brings a second approval gate: installing software on firm-managed laptops (§1.1).
4. **Usage logs are built so they can't hold content.** Events are an enum, an opaque team ID, an hour bucket, a tool name and an integer. No free text, no user or memory ID, so no per-person scoring.
5. **Backup retention window: 14 days** (pm accepted, provisional pending compliance). A deleted memory is gone from every backup within 15 days, and a restore replays deletions. **Caveat (§6.1):** if we use a firm-managed database, its backups follow the firm's policy, and the 14 days may not hold.
6. **We never hold an org-wide compliance API key.** dev confirmed no vendor offers a team-scoped one (feasibility §0.2). v1 needs no export anyway.

---

## 1. Deployment options

| | Option | Data stays in the firm? | Team sharing | Which AI clients can use it | Who runs it | dev path / ux surface |
|---|---|---|---|---|---|---|
| **A** | **Laptop.** MCP server and store both local | Yes (one machine) | **No** | Local clients only | The developer | Dev, demos, synthetic data |
| **B1** | **Firm-hosted store, local MCP.** Store and console on a firm host; each laptop runs a small stdio MCP server that calls the store over the firm network | Yes | Yes | **Local clients:** Claude Code, Claude Desktop extensions, ChatGPT desktop (stdio), VS Code/GitHub Copilot, probably Cursor. Plus the console from any browser | Firm IT hosts; our runbook | P1 + P2 / S1a + S4 |
| **B2** | **Firm-hosted store, remote MCP.** Same host, plus an MCP endpoint that cloud clients can reach | Yes, but retrieved text goes to the AI vendor (it does anyway, as part of the chat) | Yes | Cloud clients, through (i) an inbound opening for vendor IP ranges with a public-CA cert, or (ii) a vendor tunnel (OpenAI Secure MCP Tunnel; Claude MCP tunnels, Enterprise preview by request) | Firm IT + security review | P3 / S1b |
| **C** | **Inside the firm's AI gateway** (the unconfirmed "AI Control Plane") | Yes | Yes | Whatever the gateway serves | The firm's AI platform team | P4 / S2 |
| **D** | **Hosted by us** (single-tenant SaaS) | **No** | Yes | All | Us | Listed only |

- **D is listed for completeness only.** Vendor-oversight rules (amended Reg S-P, FINRA 21-29, SOC 2 Type II, subprocessor disclosure) make it unrealistic in a two-week window.
- **Lean (pm-accepted, provisional): B1** if Raj's team has desktop or IDE clients. B2 is an add-on, only if the team is web-only and security approves a path. C is better long-term if the gateway exists, but the platform team owns that timeline.
- **A vendor tunnel is itself an egress path.** It avoids an inbound rule but still needs security's sign-off, and its client credential is a secret (§5).
- **Model data flows:** v1 lean is full-text search and rule-based redaction, so no model call at all (feasibility §5.3, §5.4). If embeddings or model-based redaction come in, the model endpoint is a new data flow: the firm's gateway models, a local model on the host, or a vendor API that needs approval.

### Network checklist per option

| Need | A | B1 | B2 | C |
|---|---|---|---|---|
| TLS cert | none (stdio) | Firm internal CA for the store API and console | **Public CA** cert on the MCP endpoint (or the tunnel's) | Gateway's |
| Inbound firewall rule | none | none (laptops call out over the firm network) | (i) vendor IP ranges, or (ii) none with a tunnel | none |
| Outbound | none | Laptop → store, inside the firm network | (ii) tunnel client → vendor | Gateway's |
| Identity | Local OS user | Firm IdP: browser or device-code sign-in from the local MCP server; OIDC for the console | OAuth 2.1 through the firm IdP (MCP spec 2026-07-28) | Gateway identity |

### 1.1 Shipping the local MCP component (B1)

B1 puts our code on 4–6 firm-managed laptops. That's a distribution and update job, and probably its own approval.

| Concern | Plan |
|---|---|
| **Approval to install** | Firm-managed laptops usually allow only approved software. Expect an endpoint-software request, separate from the client admin's MCP allowlist. **Ask early; it can be slower than the hosting.** Lean (with ux 12:26:54): ask IT to **push** it through endpoint management (e.g. Intune or Jamf), so each teammate only signs in and checks. That's the surest way to hit Flow 0's under-10-minute goal. |
| **Per-client setup** | Claude Desktop extension: one click once an admin allowlists it. Claude Code, VS Code, ChatGPT desktop, Cursor: a config block (ux Flow 0, under 10 minutes). |
| **What it stores** | **Nothing but the user's token**, kept in the OS keychain. No memory cache, no local database, no content on disk. |
| **What it logs** | Status and errors to stderr, no content. The *client* may still log tool calls and results (L8, §3); that's outside our control. |
| **Updates** | The store API reports a minimum client version. An older local server refuses calls with a plain message: "Update the team memory connector: <link>." No silent auto-update on managed laptops. |
| **Versions in play** | At most two at once (current and previous) during a rollout. The store API stays backward compatible across that window. |
| **Toolchain criterion (for later, not a pick)** | Prefer a component that ships as one self-contained package and doesn't need a language runtime installed on the laptop. Every runtime is one more thing for endpoint approval. |

### 1.2 What we need from Raj's IT for B1 (provisioning checklist)

| # | Item | Notes |
|---|---|---|
| 1 | A host on the firm network: one small VM or container slot | Store, console, store API. One team's load is tiny |
| 2 | A database: firm-managed if they offer one, otherwise on the host | Decides the backup window, see §6.1 |
| 3 | An internal DNS name and a TLS cert from the firm's CA | For the console and store API |
| 4 | An IdP app registration (OIDC client), plus a team group for membership | Access checked at query time (pm C5.2). Okta also enables MCP Enterprise-Managed Authorization (feasibility Q3) |
| 5 | A path in the firm's secret manager | §5 |
| 6 | Encrypted backup storage, **separate from the host** | §6 |
| 7 | A decision on log forwarding | If logs go to the firm's platform (L6), QA's grep has to cover it |
| 8 | Endpoint-software approval for the local MCP component | §1.1 |
| 9 | The client admin's MCP allowlist entry, and built-in vendor memory turned off for pilot users wherever the admin can scope it per user or group | Claude managed MCP, GitHub enterprise allowlist, Cursor allowlist. Vendor memory: pm 12:39:30, compliance Q12; dev is checking which tools allow per-user scoping |
| 10 | B2 only: a security review of an inbound opening or a vendor tunnel | Weeks to months (feasibility §3) |
| 11 | Crypto-shredding only: access to the firm's KMS for per-memory data keys | Only if item 2's backups can't be set to 14 days, or compliance wants immediate deletion (§6) |

---

## 2. Environments

| Env | Where | Data | Who has access | Purpose |
|---|---|---|---|---|
| **dev** | Developer laptop (option A) | **Synthetic only**, with canary strings | Developer | Build and debug |
| **test** | Same deployment option as the pilot | **Synthetic only**, with canary strings | Team agents, QA | qa's C1–C9 acceptance tests, restore drills, schedule-compressed backup tests |
| **pilot** | Raj's side (option B1, B2 or C) | Real team data | Raj's team, records admin | The two-week pilot and the north-star eval |

**Rules**
- Real data never enters dev or test, and never enters this repo, including blackboard logs. Once committed, blackboard logs are permanent history.
- No debug switch in pilot builds can log request or response bodies. Debugging happens in dev on synthetic data.
- Each environment has its own secrets. dev and test never hold pilot credentials.
- **Optional, needs Raj's OK:** plant one synthetic canary memory in the pilot (owned by QA, labeled as a test) and grep the pilot's logs for it weekly. That turns C9.1 into an ongoing check.

**If the user allows a build before the Oct 30 freeze:** the minimum is option A for dev, plus a B1 pilot host with the IdP wired in (§1.2 items 1–6 and 8–9). Backups (§6) and usage events (§4) must be live from the first real memory, since the two-week proof starts then. Per feasibility §7, hosting approval, not dev work, probably decides the date.

---

## 3. Data inventory: every place data lands

This is the master list. Deletion (C4) must reach every row marked **content: yes**. The canary grep (C9.1) must cover every row marked **grep**.

| # | Store | Content? | What's in it | Lives in | Retention | Backed up? | C9.1 |
|---|---|---|---|---|---|---|---|
| D1 | **Memory store** (primary DB) | **yes** | Memories, **every version** (pm Q8), statements, tags, source (locator always, URL when the tool has one), reviewer notes on the version | Firm host (B/C), laptop (A) | Per classification schedule (compliance) | yes, §6 | n/a (content store) |
| D2 | **Search index** (full-text in v1; embeddings optional) | **yes** (derived) | Index terms; vectors only if embeddings come in | Same as D1 | Follows D1 | **no**, rebuilt from D1 | n/a |
| D3 | **Cache** (if any) | **yes** | Recent results | Same as D1 | Minutes; cleared on delete | no | n/a |
| D4 | **Local MCP component on each laptop** (B1) | **must be no** | Only the user's token, in the OS keychain | Team laptops | Until sign-out | no | **grep** our component's files and stderr (C9.9) |
| L1 | **Usage events** (§4) | **no** | Enum events, counts | Same as D1 | Raw: pilot + 30 days. Weekly rollups: kept | no | **grep** |
| L2 | **App server log** (stdout/stderr, incl. stdio MCP stderr) | **must be no** | Status, errors, request IDs, latency. Never bodies or query text | Host log / gateway log | 30 days | no | **grep** |
| L3 | **HTTP access log** (console, store API, remote MCP) | **must be no** | Method, path, status, timing. Search is a POST (MCP's transport already is), so query text never lands in a URL | Proxy on host / gateway | 30 days | no | **grep** |
| L4 | **Audit log** (append-only) | **no** | Memory ID, action, actor, time, **reason code** (ux codes). Matter reference only for holds, never matter names. No content, no hash (pm Q11) | Separate store from D1 | Set by compliance (multi-year under 17a-4) | yes, own policy | **grep** |
| L5 | **Job logs** (retention job, backup job) | **must be no** | Counts, IDs, durations | Same as L2 | 30 days | no | **grep** |
| L6 | **Firm's central log platform**, if L2–L5 are forwarded | Copy of L2–L5 | Same as source | Firm | Firm's policy | Firm's | **grep**, or confirm we don't forward |
| L7 | **Error tracker / crash reports** | n/a | **None in the pilot.** No third-party error service | n/a | n/a | n/a | confirm absent |
| L8 | **AI client's own MCP logs** on users' laptops | **can be yes** | Desktop and IDE clients may log tool calls and results locally (e.g. under `~/Library/Logs/Claude/` on macOS; verify per client). **Under B1 this is a pilot concern, not just a test one** | Team laptops; **outside our control**; stays on firm-managed machines | Client's | n/a | **grep on a test machine** (C9.4); documented per client for compliance (C9.10) |
| E1 | **Eval trace** (feasibility §6: run ID, time, calling user, client, the AI's query string, returned IDs with status/age/rank) | **yes** (query text) | Eval runs only. **Off by default**; turning it on writes an audit event | Raj's side, with the test set | Deleted with the test set after the report | no | **excluded**: content by design |
| E2 | **Eval memory snapshot** (frozen at the freeze) | **yes** | A full copy of D1 at freeze | Raj's side | Deleted after the report is accepted. Erasure requests during the eval window apply to it too (qa adopted) | no | n/a |
| E3 | **Test set, transcripts, time-on-task data** | **yes** | Raj's team's work content; pseudonymous timing data | Raj's side, never this repo | pm/Raj | Raj's | n/a |
| X1 | **Ingestion staging** | **yes** (raw chats) | **Not in v1** (feasibility §0.1). Phase 2 only, if an export path is used: temp space, never backed up, deleted right after processing | — | — | **no** | n/a |
| V1 | **The AI vendor's chat history and the firm's compliance archive** | **yes** | Retrieved memory text, because it appears in the chat | Vendor / archive; **outside our boundary** | Theirs | Theirs | n/a. qa's C4 "known gap" |

**Settled since v1:** reviewer notes live on the memory version in D1 and are deleted with it; L4 keeps only a reason code (dev, ux and qa agreed; C4.7). If compliance rules a note is a FINRA 3110 supervisory record, it moves to a separate retained review record, still not L4 (feasibility Q6).

---

## 4. Usage logging: counts and events only

Purpose: pm's "usage logs over two weeks" proof, and ux's Flow 4 team usage panel, without logging chat content or anything that allows per-person scoring.

### Event schema

```
{ "event": "memory_retrieved", "team": "t-7f3a", "hour": "2026-11-02T14Z", "tool": "claude", "surface": "S1a", "n": 2 }
```

| Field | Type | Values |
|---|---|---|
| `event` | enum | see below |
| `team` | opaque ID | Team alias, not the team's real name |
| `hour` | UTC hour bucket | No minutes or seconds, so events can't be lined up with audit-log entries by timestamp |
| `tool` | enum | `claude`, `chatgpt`, `copilot`, `cursor`, `gemini`, `gateway`, `console`, `other` |
| `surface` | enum | `S1a`, `S1b`, `S2`, `S3`, `S4` (ux) |
| `n` | integer | Count (memories returned for retrievals; otherwise 1) |

**What's deliberately missing:** user ID, memory ID, query text, memory text, IP address, session ID. Without user IDs there's no per-person count. Without memory IDs, retrievals can't be joined to authors in the audit log ("whose memories get used").

**Enforcement, not just policy:** events are written through a schema allowlist. An unknown field, or a value that isn't in its enum, drops the event and bumps a `rejected_events` counter. The rejected value itself is never logged (C9.5).

### Events

| Event | Required by | Emitted when |
|---|---|---|
| `memory_proposed` | ux Flow 4 | `propose_memory` or the console form creates a Pending memory |
| `memory_shared` | ux Flow 4 | A reviewer shares a memory |
| `memory_retrieved` | ux Flow 4 | `search_memory` returns ≥ 1 memory (`n` = number returned) |
| `memory_flagged` | ux Flow 4 | `flag_memory` is called |
| `search_empty` | included (pm 12:26:47) | `search_memory` returns nothing. A gap signal: questions the memory can't answer yet |
| `memory_sent_back`, `memory_rejected`, `memory_deleted` | included (pm 12:26:47) | Counts only; the audit log has the details |

**Active members (pm 12:26:47: collect it; ux 12:26:54: never on the panel):**
- **Collected** as option (b): a distinct-user count, computed in memory with a salt that's thrown away at the end of each window. Only the integer is stored.
- **Shown nowhere live.** Not on the lead's panel at any granularity, because in a 4–6 person team "4 of 5 active" tells the lead who isn't using it. It appears **once**, in the end-of-pilot report.
- **Which figure: (b1), decided by pm 12:39:30 (provisional).** A daily salt gives daily counts, and daily counts can't be added up into "how many different people used it over the pilot". The two options were:
  - **(b1) Median daily active.** Daily salt, as above. Weakest identity footprint, but answers "how many on a typical day", not "how many ever".
  - **(b2) Distinct over the pilot.** One salt for the whole pilot, held in the secret manager. The server keeps only a set of salted hashes with no timestamps or counts attached, readable by no screen or API. The count is computed once at pilot end, then the set and salt are destroyed. Answers "N of M teammates used it".
  - **Chosen: (b1).** pm: "4.2 of 5 active per working day" is the stronger adoption evidence, and b1 has the smallest identity footprint. ux added that b2's "5 of 6" in a small team singles out the one who didn't. (b2) is kept below for the record only; qa's C9.12 runs the b1 branch.
- **Where the salt and hashes live (qa C9.12):**
  - **(b1):** the salt and the day's set of hashes exist **only in process memory**. They're never written to disk, logs, the database or backups. At midnight UTC the integer is written to L1, then the set and salt are dropped. **Restart caveat:** a restart mid-day starts a new salt and an empty set, so overlap across the restart can't be known. That day records the larger of the two segment counts (a lower bound) and is marked approximate in the report.
  - **(b2):** the salt lives in the **firm secret manager** (it must survive restarts for two weeks). The hash set lives in its own small store, **excluded from D1's backups**, so destroying it at pilot end leaves no copies behind. If the host is lost mid-pilot, the figure is lost too; fall back to (b1)-style daily counts and say so in the report.

**Small-team caution:** with 4–6 people, small breakdowns re-identify people ("only one person uses Cursor"). The console panel shows **weekly team totals of events only**. The per-tool split (the cross-tool proof) and the active-members figure appear only in the end-of-pilot report.

**Retention (pm 12:26:47):** raw events for the pilot plus 30 days; weekly rollups kept.

### Reporting
- The console home panel (ux Flow 4) reads weekly rollups from L1.
- At the end of the pilot, a counts-only CSV of weekly rollups by team alias can go into `docs/` as the adoption proof, if pm and Raj agree. Raw events stay on the deployment.

---

## 5. Secrets

| Secret | Used for | Sensitivity | A (laptop) | B1 / B2 (firm-hosted) | C (gateway) |
|---|---|---|---|---|---|
| **Vendor compliance API / archive credential** | Phase 2 only (P5) | **Highest**: org-wide read of every employee's chats, and no vendor offers a team-scoped key | Never | **We never hold it.** Compliance runs the export and hands us the team's slice | Platform team |
| IdP client secret | Console login; OAuth for remote MCP (B2) | High | Fake IdP or none | Firm secret manager | Gateway's |
| **Per-user tokens** | Local MCP → store (B1); cloud client → MCP (B2) | High | n/a | B1: browser or device-code sign-in, token in the **OS keychain** on the laptop. B2: short-lived OAuth tokens. **No shared team key in either case**: the audit log needs a real actor, and access must follow identity | Gateway identity |
| Database credentials | D1, L4 | High | OS keychain | Firm secret manager. **Never on laptops**: the local component talks to the store API, not the DB | Platform team |
| **Backup encryption key** | §6 | High | OS keychain | Firm secret manager, **never on the backup storage host** (C4.6) | Platform team |
| Audit-log signing key (if hash-chained) | Tamper evidence for L4 | High | OS keychain | Firm secret manager | Platform team |
| Vendor tunnel credential (B2 option ii) | OpenAI Secure MCP Tunnel or Claude MCP tunnel client | High | n/a | Firm secret manager | n/a |
| Model / embedding API key (only if a model is used) | §1 data flow | High | Dev key, synthetic data only | Firm secret manager, or the gateway handles it | Gateway's |

- **Firm secret manager** = whatever Fidelity standardizes on (e.g. HashiCorp Vault, CyberArk, or the cloud provider's key vault in the firm's tenant). Use theirs.
- Secrets never go in the repo, in logs, or in blackboard entries. `.gitignore` excludes `.env*` files (except `.env.example`). A secret-scanning check in CI comes with the toolchain, after the spec.
- Rotate any secret that's ever exposed. Scope every credential to least privilege.

---

## 6. Backup, restore and retention

### What gets backed up

| Store | Backup | Why |
|---|---|---|
| D1 memory store | **Daily encrypted snapshot, 14 kept** (pm accepted, provisional) | The only primary content store |
| D2 index, D3 cache | **None.** Rebuilt from D1 after a restore | Fewer copies for deletion to chase |
| L4 audit log | Its own backup, matching its compliance retention | It's the record. It holds no content, so it's outside the deletion window |
| L1 usage events | None | Loss is tolerable; weekly rollups get exported |
| D4, E1–E3, X1 | **Never** | Tokens, or content copies with their own short lifetimes |

### The backup retention window (qa C4.4)

- **14 days.** A memory deleted on day D is gone from every backup by **day D + 15** (14 kept, plus the snapshot taken that day). That's inside GDPR's one-month response window.
- **Restores replay deletions (C4.5).** After any restore, a reconciliation step deletes every memory whose ID has a tombstone. A restore never brings a deleted memory back.
- **Legal hold never extends backups.** A hold blocks deletion in D1, so the held memory stays there. Backups are for disaster recovery only.
- **If 15 days is too long for compliance, or IT can't set 14-day DB backups (§6.1):** crypto-shredding, designed in [feasibility §5.5](../dev/feasibility.md). Each memory's content gets its own data key wrapped by the firm's KMS; deleting the memory destroys its key, so old backups hold ciphertext nothing can decrypt. Ops consequences:
  - **The key store's backup window becomes the real deletion window.** Data keys get no backups, or backups shorter than the promised window. Losing the key store then means losing content, so the KMS must be the firm's highly available one, not ours.
  - **Legal hold must block key destruction,** the same as it blocks deletion (qa C4.4 crypto branch).
  - Adds a KMS dependency (§1.2 item 11) and about 2–3 dev days (dev's estimate).
- **Testing without waiting two weeks:** in test, run the same job on a compressed schedule (a snapshot every few minutes, keep 3).

### 6.1 The database choice decides who controls the window

dev's §5.3 lists SQLite on one host or Postgres, preferring whatever the firm already runs. From the backup side:

| | Firm-managed DB (likely Postgres) | DB on our host (e.g. SQLite or a self-run Postgres) |
|---|---|---|
| Who runs backups | The firm's DBAs, on the firm's schedule | Our backup job, on our schedule |
| Backup window | **The firm's policy**, often 30–90 days or longer, plus point-in-time recovery logs | **14 days, as proposed** |
| C4.4 holds? | **Only if** the firm sets this DB to 14 days, or we add crypto-shredding | Yes |
| Ops burden | Low for us | We own the backup job, the restore drill and monitoring |
| Approval | Usually easier: already sanctioned | One more thing on the host to approve |

**Lean:** take whichever lets the window match what compliance approves. In practice, a firm-managed DB with a 14-day policy if IT will set one, otherwise a DB on our host with our own job. Either way, C4.4 must be tested against the real window, not the proposal. (Engine choice stays with the toolchain decision after the spec; this table is the backup criterion for it.)

### Recovery targets (pilot, proposed)

- **RPO 24 hours.** At worst, the last day's proposals are lost and re-proposed.
- **RTO 1 business day.**
- **One restore drill in test before the pilot starts**, including the deletion replay. A backup that's never been restored isn't a backup.

### The audit log as a record (SEC 17a-4: WORM or an audit-trail alternative)

Options for compliance:
- **(a)** Ship audit entries to the firm's compliance archive, which already meets 17a-4.
- **(b)** Object storage with an immutability lock, in the firm's tenant.
- **(c)** An append-only, hash-chained log. Tamper-evident, but not WORM by itself.

Lean: (a), if the archive accepts it, since the firm already trusts it for exams.

### End of pilot

Export the memories and the audit log to the firm. Then destroy D1 and its backups: destroying the backup key makes every backup unreadable at once. Uninstall the local component from laptops (D4) and revoke tokens. Record all of it in the audit log. This covers the "data return when the contract ends" expectation in the market scan.

---

## 7. Repo layout

```
MemoryManager/
  CLAUDE.md                 agent startup instructions
  .gitignore                bb cursors, machine-local Claude files, .env*, .DS_Store
  blackboard/               agent coordination: bb, PROTOCOL.md, registry.md, agents/*/wm-log.md
    tests/bb-test.sh        bb's regression suite (bash blackboard/tests/bb-test.sh)
  docs/
    research/               pm: market scan
    pm/                     pm: open-questions.md (single list of open items)
    spec/                   pm: spec.md (after the frame is approved)
    dev/ ux/ qa/ devops/    each role's prep docs, DRAFT until the spec is approved
  site/                     marketing landing page: static HTML, no build step (dev builds, ux owns copy)
  deploy/                   devops: nginx + logrotate config and deploy.sh for the landing page on dev-vm (deploys only from main)
  (product code, deploy configs: decided with the toolchain, after the spec)
```

- **Never in the repo:** real team data, the test set, eval transcripts or traces, timing data, secrets, or backups.
- **`bb-test.sh` moved** from `qa/` to `blackboard/tests/` on 2026-10-24 (42 passed after the move). devops owns `bb`; qa owns the suite's test cases.
- **Commits:** none until the user approves. **Remote:** pushing to any remote is the user's call too. The repo already names Raj and Fidelity (docs/research), which matters if the remote isn't private.

---

## 8. Acceptance checks proposed by devops

C4.5–C4.7 and C9.4–C9.7 are adopted in qa's eval plan. New in v2:

| ID | Check |
|---|---|
| C9.9 | After a full B1 session on a test laptop (save, search, flag), our local component has written no canary to disk or stderr. Only the token exists, and only in the OS keychain. |
| C9.10 | For each AI client chosen for the pilot, document what it logs locally about MCP calls (L8) and where. Not pass/fail, since we don't control it; it goes to compliance. |

---

## 9. Open questions

pm keeps the single list in [docs/pm/open-questions.md](../pm/open-questions.md). devops items sent to pm:

| For | Question |
|---|---|
| **Raj / IT** | The §1.2 checklist, especially: does IT offer a managed database, and can its backup retention be set to 14 days (§6.1)? |
| **Raj / IT** | Can a small local component be installed on the team's managed laptops, and through which process (§1.1)? |
| **compliance** | Is a 15-day backup lag for deleted content acceptable, or is crypto-shredding needed? Audit-log retention period and WORM option (a/b/c)? The audit log names actors: how does that square with GDPR erasure? |
| **user** | First commit, and whether or where to push a remote. |
