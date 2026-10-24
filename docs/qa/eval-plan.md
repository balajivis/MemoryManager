# Evaluation plan

Owner: qa · Status: **DRAFT** · Date: 2026-10-24
Inputs: [market scan](../research/market-scan.md), [ux flows](../ux/flows.md), [env plan](../devops/env-plan.md), dev's feasibility work, and pm blackboard entries of 2026-10-24 (11:53, 11:58, 12:04). The product frame is still pending the user's approval, so this plan may change with it.

**Decided so far (pm, 2026-10-24 12:04, PROVISIONAL until the spec):** question sourcing A; guardrail thresholds of 0 leaks, at most 1 in 20, and every control item passes; the retrieval trigger is auto plus explicit, and the eval tests the auto default; edits are re-reviewed (C2.5); access is checked at query time (C5.2); memories are returned only to their share scope (C5.3); v1 is one team; saving is explicit only. **Still the user's call:** the freeze and report dates (proposed Fri Oct 30 and Sun Nov 1).

This plan covers two things: how we measure the north star (part 1), and the acceptance tests for the compliance must-haves (part 2). Anything that depends on Raj's answer about which tools his team may use is written as options, with no pick.

---

## Part 1. North-star evaluation

**Metric (from pm):** Context-dependent questions answered correctly: X/20 without memory vs. Y/20 with memory. The questions are real questions from Raj's team, frozen on a Friday. Raj judges the answers. **Guardrail:** count wrong or out-of-date retrievals.

### 1.1 Design rules, fixed before the freeze

These are the choices that decide whether X vs. Y means anything. Each is fixed before any with-memory run and can't change after the freeze.

1. **Pick questions by human judgment, never by model results.** We don't drop a question because the no-memory arm got it right. Doing that would push X toward 0 and inflate the gap, which is the problem with the old "0 to 5" metric. The test for a question is: *a capable new hire couldn't answer it without the team's chat history.*
2. **Freeze the questions and the memory together.** At freeze we hash the test set and snapshot the memory store. With-memory runs use only that snapshot. A memory created after the freeze doesn't count, even if it would help. That stops anyone from saving memories aimed at known questions.
3. **The with-memory arm sees exactly what a teammate's retrieval returns,** following the display rules in ux Flow 3: Shared, Due for review, and Flagged memories within their access. Pending, Rejected, Retired, and Deleted memories never appear.
4. **The memory manager is the only difference between the arms.** Same AI tool, model version, account, prompt text, and day. Every question gets a fresh chat with no context carried over.
5. **Blind the judging.** Raj judges answers without knowing which arm produced them (see 1.5).
6. **The headline counts "correct" only.** "Partly correct" is reported beside it but doesn't add to X or Y.

### 1.2 Test-set format

Twenty questions, one row each. The file holds the team's work content, so **it lives where Raj's team keeps work data, not in this repo.** The repo gets only this format, the file's SHA-256 at freeze, and the scores.

| Field | Required | Description |
|---|---|---|
| `id` | yes | `Q01`…`Q20` |
| `question` | yes | Verbatim, as a teammate would type it into their AI tool |
| `category` | yes | One of: `decision`, `fact`, `how-to`, `rationale`, `status`, `ownership` |
| `asker_role` | yes | Role, not name. No per-person scoring, per pm's constraint |
| `source_chats` | yes | One or more chats the answer depends on: tool, chat link or ID, date, author **role**. Every source must be dated before the freeze |
| `cross_tool` | yes | `y` if the source chat is in a different AI tool from the one the question is asked in |
| `cross_person` | yes | `y` if the source chat's author isn't the person asking |
| `reference_answer` | yes | Written by the question's owner and approved by Raj before the freeze |
| `must_include` | yes | 1–4 key points a correct answer needs |
| `must_not` | if any | Statements that make an answer wrong, e.g. a superseded value |
| `superseded` | if any | Earlier answers and the date each stopped being true. Used to spot out-of-date retrievals |
| `cleared_for_eval` | yes | `y` once the owner confirms the content can be used in an eval run in the chosen tool |

**Suggested mix,** so the 20 questions exercise the product's claims: at least 5 `cross_tool`, at least 5 `cross_person`, and at least 3 with a `superseded` entry (otherwise the guardrail never gets tested). The rest follow whatever the team really asks.

**Where questions come from (options for pm):**
- **A. Prospective (chosen by pm):** during the usage period, teammates add real questions to a shared sheet as they come up. This is the most realistic option, and nobody writes questions while looking at the memory. Raj's team starts the sheet now.
- **B. Retrospective (fallback only):** at freeze, the team writes questions they've needed answered recently. Used only to top up if A has fewer than 20 usable questions at the freeze. Every B question is tagged `sourcing: B` and reported separately. People tend to remember the questions that have tidy answers.

**Control items, scored apart from the 20:**
- 3 *no-answer* questions: plausible questions with no source chat anywhere. The right behavior is to say it doesn't know. These test whether retrieval invents answers.
- 2 *no-access* questions: the answer exists only in a memory the asker can't see (pending review, or another scope). The right behavior is no retrieval and no hint the memory exists. These overlap with tests C2 and C5 in part 2.

### 1.3 Runbook

1. **Freeze (proposed Fri Oct 30, the user's call):** lock the test-set file (E3 in env-plan), record its SHA-256 and the memory-snapshot ID (E2) in `docs/qa/eval-runs.md`, and record the tool, model version, and account for each arm.
   - **Erasure during the eval window:** if an erasure request arrives between the freeze and the report, apply it to the E2 snapshot too. That memory then drops out of the eval. Note which questions it affected and report the score with and without them.
   - **Which AI tool:** the eval tool must be one that can actually reach the memory server under the chosen deployment. Cloud connectors (ChatGPT, claude.ai, Copilot Studio) call from the vendor's cloud, while desktop or local clients can reach a firm-network server (dev 12:09:52, feasibility.md). Pick the tool once deployment is settled. Don't run the eval on a client the pilot itself won't use.
2. **Run both arms on the same day, interleaved** (Q01 without, Q01 with, Q02 without, …), so a model update can't land between arms.
3. **Who asks:** options, depending on what Fidelity allows:
   - **A. Neutral eval account (recommended if allowed):** a team-standard account with no personal chat history, used for both arms. This isolates the memory manager.
   - **B. A real teammate, not the source chat's author,** asks each question. More realistic, but their own vendor memory can leak into the baseline. Note which questions this affects.
4. **Retrieval trigger:** test the product's shipped default, because the north star measures real use. **pm decided (provisional): auto by default, plus an explicit "check team memory". So the first row applies:** questions asked verbatim, trigger rate logged. The other rows stay in case the decision changes.

   | If the default is… | With-memory arm | Also log |
   |---|---|---|
   | **Auto** (or auto plus an explicit phrase) | The question is asked verbatim, the same text as the no-memory arm | Whether `search_memory` was called on each question (trigger rate k/20) |
   | **Explicit only** | Verbatim, as a user who forgets to ask would type it. The headline then also measures whether people remember to ask | Same |
   | **No live retrieval** (surfaces S3/S4: console search plus "copy context pack") | The asker searches the console, pastes the pack, then asks. This measures a human-in-the-loop workflow; time each one | Time spent and memories pasted |

   **Diagnostic, not the headline:** for any question where `search_memory` wasn't called, re-run once with "check team memory" appended. That separates trigger misses from retrieval misses.
5. **Vendor built-in memory** (ChatGPT, Claude, Copilot memory): same setting in both arms. Under C4.9 it will be off for pilot users wherever the admin can do that per user, so the baseline is usually "off". Record the setting per tool.
6. **Capture for every with-memory run:** the answer text, plus the list of memory IDs retrieved, each with its creation date and source link. We need these IDs to count the guardrail. The server's **eval trace (E1)** logs each `search_memory` call: question, timestamp, returned IDs with state and age, and calling user. It's off by default, and switching it on writes an audit event (C9.7). Whether the AI *cited* a memory comes from the transcript, since the server can't see that. Transcripts and the trace stay on Raj's side with the test set.
7. **Runs per question:** one per arm for the headline (40 answers for Raj to judge). If Raj has time, run the with-memory arm twice more and report how stable it is. Not required.

### 1.4 Judging rubric

| Grade | Meaning |
|---|---|
| **Correct** | Has every `must_include` point, nothing that contradicts the reference, and no `superseded` value presented as current |
| **Partly correct** | Some `must_include` points and no contradiction, or right but too vague to act on |
| **Wrong** | Contradicts the reference, presents a superseded value as current, or makes something up |
| **Abstained** | Says it doesn't know, or asks for information it would need. Not correct, but not counted as wrong in the guardrail |

Raj grades each answer against the reference answer and adds a one-line reason for anything other than Correct.

### 1.5 Blinding

With-memory answers will show their sources and age (ux Flow 3), which gives the arm away. Before judging:
1. Strip the trailing provenance parenthetical, `(team memory <ID>, <age>)` per the ux Flow 3 citation rule, plus any source links. That also removes the author and reviewer names (ux Q1). Keep plain-language caveats ("this may be out of date, verify it"), because they're part of what makes an answer right or wrong. Raj grades the content only.
2. Shuffle all 40 answers and label them with random codes. QA keeps the key.
3. After grading, QA unblinds and checks the citations separately for the guardrail (1.6).

The blinding will be partial: answers that use team context will often still read as different. Report that as a limitation; don't claim the judging was fully blind.

### 1.6 Guardrail: wrong or out-of-date retrievals

Classify every memory retrieved during the 20 with-memory runs:

| Class | Rule |
|---|---|
| `current` | Relevant and still true |
| `outdated` | Matches a `superseded` entry, or a newer memory on the same point exists in the snapshot |
| `wrong` | The memory doesn't match its own source chat (for example, a bad summary) |
| `irrelevant` | Unrelated to the question. Counted, but not a guardrail failure |
| `leaked` | Outside the asker's access. **Severity 1: one leak fails the eval no matter the score** |

**Report:** (a) total `outdated` + `wrong` retrievals; (b) the number of answers where one of them **reached the answer**, i.e. the answer was graded Wrong because of it. Measure (b) is the one users feel.
A Due-for-review or Flagged memory that the AI passes on *with* its warning still counts in (a). It counts in (b) only if the answer presents it as current.
**Thresholds (pm, provisional):** 0 leaks; (b) ≤ 1 of 20; and every control item (1.2) must pass. Missing any one of them fails the eval, whatever X and Y are.

**The in-use signal (secondary).** ux Flow 3's `flag_memory` ("that's out of date") gives a live team-level count over the two weeks: flags per week, and flags per 100 retrievals. Report it next to the eval, but it **can't replace (a) and (b)**. It only counts errors someone noticed, and silent wrong answers are the dangerous ones. If the eval finds wrong retrievals that nobody flagged in real use, report that gap. Flags made after the freeze don't change the eval snapshot.

### 1.7 Reporting

One page in `docs/qa/eval-runs.md`:

- **X/20 and Y/20** (correct only), plus counts of partly correct and abstained in each arm.
- **Flip table,** the honest view at n = 20:

  | | with memory: correct | with memory: not correct |
  |---|---|---|
  | **without memory: correct** | stayed right | **got worse (c)** |
  | **without memory: not correct** | **got better (b)** | stayed wrong |

- **When to claim a gain.** Use an exact paired (McNemar) test, two-sided, p < 0.05. Claim the gain only if b ≥ 6 when c = 0, b ≥ 8 when c = 1, b ≥ 10 when c = 2, or b ≥ 12 when c = 3. Below that, report the numbers as directional only. Example: 6/20 → 11/20 with b = 5, c = 0 has p = 0.06. It looks good but isn't conclusive.
- Guardrail counts, the control-item results, and a breakdown by category, `cross_tool`, and `cross_person`.
- Test-set hash, memory-snapshot ID, tool and model versions, account option, vendor-memory setting.
- Limitations: n = 20, one judge, one team.

### 1.8 Threats to validity

| Threat | Mitigation |
|---|---|
| The judge wants it to work (Raj is the champion) | Blinding (1.5); the reference answer is written before the freeze |
| Memories saved with the questions in mind | Memory snapshot at freeze (rule 2); source chats must predate the freeze |
| Questions picked because memory has the answer | Option A sourcing; rule 1 |
| Vendor memory helps the baseline | Same setting in both arms, recorded; neutral account option |
| Model changes between arms | Same day, interleaved |
| n = 20 is noisy | Flip table and exact test, so we don't over-claim |

---

## Part 2. Compliance acceptance tests (draft)

These run on **synthetic data in a test environment, never on Raj's real data.** Each test is pass/fail. Many tests plant **canary strings**: unique tokens such as `CANARY-7f3a-…` put in synthetic source chats. A grep for the token then proves where content did or didn't end up.

Roles in the tests: `author` (saves a memory), `reviewer` (approves it), `teammate` (same team), `outsider` (no access to the source), `admin`.

### C1. Every memory links to its source chat
*pm decided (provisional): **both**. The AI can't see its own conversation URL (dev 12:12:44), so every memory records a locator (tool, client, user, time) automatically, plus a chat URL wherever the tool has a stable one. A save never fails for a missing URL.*
- **C1.1** 100% of approved memories carry a locator. Every memory saved from a tool with stable chat URLs (e.g. Claude) and given a URL carries that URL too.
- **C1.2** URL: following it as someone with access lands on the right chat and message. Locator: an archive lookup on it returns the right chat. Measure the hit rate on a seeded set; whether a locator alone is acceptable is compliance question 10 in [open-questions.md](../pm/open-questions.md).
- **C1.2b** The reviewer card shows "Open source chat" when there's a URL and "Find in archive" when there's only a locator (ux Flow 1).
- **C1.3** When the memory is retrieved in an AI tool, the answer shows the source and the memory's age (ux flow 3).
- **C1.4** An outsider who sees a source link learns nothing from it: no chat title and no snippet.

### C2. Review before sharing
- **C2.1** A memory the author has just saved is `pending`. A teammate's query that would match it returns nothing, and no count or hint either.
- **C2.2** Once the reviewer approves it, the same query returns it.
- **C2.3** A rejected memory is never retrievable by anyone except, optionally, its author.
- **C2.4** Every approve and reject decision writes an audit entry with the reviewer, the time, and the memory ID.
- **C2.5** Every edit creates a new version that needs re-review (pm, Q8). While it's pending, teammates still get the previously approved version. After approval they get only the new one. There's no shortcut for typo fixes.
- **C2.6** No self-approval: the author's approve action is refused, including for the lead. Any other teammate can review the lead's memories (pm, Q5).
- **C2.7** Nothing irreversible goes through MCP (ux principle 6): the MCP tool list has no approve, delete, or hold tool. An AI that claims "the user said yes" can create at most a Pending memory, and passes C2.1.

### C3. Legal hold blocks deletion
- **C3.1** With a hold on a memory (or on its custodian or matter), deletion by the author, by an admin, and by the retention job is each refused. Each attempt writes an audit entry.
- **C3.2** A held memory past its retention date isn't deleted.
- **C3.3** After the hold is released, a deletion succeeds and the audit entry records the earlier hold.

### C4. Deletion leaves an audit trail and no content
- **C4.1** After a memory is deleted, its canary string is gone from the primary store, the search index, the vector embeddings, and any cache. MCP retrieval of it returns nothing.
- **C4.2** The tombstone keeps the memory ID, its timestamps, the actor, and a reason code. It keeps no content and, by default, no content hash (pm, Q11, pending compliance).
- **C4.3** The audit trail is append-only. An admin can't edit or remove entries, which meets SEC 17a-4 (WORM storage or an audit-trail alternative).
- **C4.4** Backups (14 days of daily encrypted snapshots, env-plan §6): a memory deleted on day D is gone from every backup by D+15. In test, run this on a compressed schedule (a snapshot every few minutes, keep 3). *If the firm's IT keeps database backups 30 to 90+ days (env-plan §6.1), this test turns into crypto-shredding (dev, feasibility §5.5): after deletion, the memory's data key is destroyed, and its ciphertext in older backups can't be decrypted. Two extra checks then apply. (i) The key store's own backups must not outlive the deletion window, because otherwise that becomes the real window. (ii) A legal hold blocks key destruction, which extends C3.1. Which branch applies depends on the Raj/IT and compliance answers.*
- **C4.5** Restore a backup taken *before* a deletion, then run reconciliation. The memory stays deleted, and its canary is absent from D1–D3. (Proposed by devops.)
- **C4.6** The backup encryption key can't be read from the backup storage host. (devops)
- **C4.7** Reviewer notes (send-back notes, reject reasons) are deleted with their memory version, and the audit log keeps only a reason code. *If compliance rules under FINRA 3110 that a review note is a supervisory record (dev 12:09), this changes: the note moves to a separate retained review record, and the test follows.*
- **Vendor-memory copies** (pm 12:39, compliance Q12, PROVISIONAL): C4 promises complete deletion **only within our own system**. Against copies a vendor tool's own memory may keep:
  - **C4.8** Every `search_memory` result ends with the do-not-save footer meant for the AI (ux Flow 3), and the AI doesn't repeat it to the user. Best effort only: also record, per client, whether the vendor memory saved it anyway. That's not pass/fail, and it goes to compliance.
  - **C4.9** For every pilot user in a tool whose admin can switch memory off per user or group, built-in memory is off. Checked from the admin console before the pilot and again at the freeze.
  - Whatever is left is documented as a known gap in the spec.

### C5. No cross-team leak; access follows the source
- **C5.1** An outsider queries text that only appears in team A's memories, including the canary. Zero results, and no count, title, or snippet.
- **C5.2** When a user is removed from the team, their very next query returns none of the team's memories, because access is checked at query time (pm).
- **C5.3** A memory is returned only to its share scope, which in v1 is the one team it was shared with (pm, ux Q2, Q9). The source chat keeps its own permissions; C1.4 covers that.

### C6. PII redaction
- **C6.1** Seeded synthetic PII in source chats (SSN, account numbers, phone, email, card numbers) is redacted in the stored memory and never comes back on retrieval. **Pass:** 100% for structured identifiers.
- **C6.2** Free-text PII (client names, addresses): measure recall on a seeded set and report it. pm sets the bar.
- **C6.3** Saving content on the block list (client data, account numbers, MNPI, plus whatever compliance configures) is refused with the ux Flow 1 message, and no draft is kept. A blocked save leaves its canary nowhere: not D1–D3, not the logs.

### C7. Retention
- **C7.1** A memory past its retention date and not on hold is deleted by the retention job, with an audit entry (and it passes C4.1).

### C8. Retrieval display rules (from ux Flow 3)
- **C8.1** Each state from the Flow 3 table, seeded in turn: Pending, Rejected, Retired, and Deleted memories are never returned. Due-for-review and Flagged memories are returned, ranked below Shared ones, with their ⚠ label. A superseded memory isn't returned; the newer one says "Replaces M-0xx".
- **C8.2** When two memories conflict, both are returned with the "these disagree" note.
- **C8.3** A memory on legal hold is retrieved normally and shows no hold badge in-tool.
- **C8.4** `flag_memory` moves the memory to Flagged in the reviewer's queue, and the teammate gets a receipt.

### C9. Constraints from the market scan
- **C9.1** Usage logs (the two-week adoption proof) hold counts and events only. A grep for every canary string across every log location finds nothing. The locations are L1–L6 and L8 from env-plan §3; E1 is excluded because it holds content by design.
- **C9.2** No screen, API, or export shows per-employee scores or quality metrics.
- **C9.3** No capture path depends on a browser extension.
- **C9.4** The C9.1 grep really covers L1–L6 and L8 (L8 is stdio mode on a test machine), and L7, the error tracker, is confirmed absent. (devops)
- **C9.5** Sending free text in any usage-event field drops the event and increments `rejected_events`. The text appears nowhere. (devops)
- **C9.6** At the highest log level, a request carrying a canary leaves no trace in L2, L3, or L5. Search requests are POSTs, so the query never sits in a URL. (devops)
- **C9.7** The eval trace (E1) is off by default, and switching it on writes an audit event. (devops)
- **C9.8** Saving is explicit only: no memory is created unless a user deliberately saves it (pm, Q4: suggested capture is out of v1).
- **C9.9** After a full B1 session on a test laptop, our local MCP component has written no canary to disk or stderr, and its token exists only in the OS keychain. (devops, env-plan v2 §1.1)
- **C9.10** For each chosen AI client, document what it logs locally about MCP calls (L8). Not pass/fail; the result goes to compliance. (devops)
- **C9.11** The active-members count is never shown on the lead's console panel, at any granularity. It appears only as one aggregate figure for the whole pilot in the end-of-pilot report (pm 12:36, ux 12:36).
- **C9.12** The daily salt behind the active-members count can't outlive its day. pm picked **b1** (12:39): median daily active, with an in-memory salt dropped daily.
  - The salt and the day's hash set exist only in process memory: never on disk, in logs (L1-L6, L8), the DB or backups. At midnight UTC only the integer count reaches L1.
  - Restart case: a mid-day restart starts a new salt. That day records the larger of the two segment counts and is marked approximate. Test it by restarting mid-day and checking both the label and that no salt survived the restart.

### Integration-specific checks (options; pick once Raj answers)

| Ingestion path | Extra checks |
|---|---|
| Vendor compliance API (OpenAI, Anthropic, Graph/Purview, Vault) | Ingestion delay is measured and stated; a deletion at the source shows up in memory; API scopes are least-privilege |
| Firm AI gateway | Only gateway-approved models and tools can retrieve; gateway identity is the access identity |
| Manual save-to-memory | The save action records the user and the source link; nothing is captured without an explicit save |

---

## Open questions

All open questions now live in pm's consolidated list, [docs/pm/open-questions.md](../pm/open-questions.md). New ones go to @pm on the blackboard. Those this plan depends on: the freeze dates (user 2), the backup window and crypto-shredding (Raj/IT, compliance 4), review notes as supervisory records (compliance 5, C4.7), tombstone fingerprint (compliance 6, C4.2), the block list (compliance 2, C6.3), and locator acceptability (compliance 10, C1.2). The vendor-memory copy gap is now compliance Q12 (C4.8, C4.9).
