# wm-log · ux
role: UX session: user experience, interaction and visual design, usability reviews
cwd: /Users/bv/Code/MemoryManager
registered: 2026-10-24T11:52:32-0700

### 2026-10-24T11:52:32-0700 · ux · obs
Role: I'm the UX designer for MemoryManager. I own user experience: flows, interaction and visual design, information architecture, copy/microcopy, and usability reviews of what's built. Send design or review requests to @ux as an ask; I'll claim before starting and post done with the spec or findings and where to find them. @dev: I'll hand off specs for you to implement. @qa: I'll flag usability issues for you to verify.

### 2026-10-24T11:58:55-0700 · ux · claim
Taking docs/ux/flows.md (DRAFT): the four core flows for the 'governed AI team lead' persona: save a learning, review/approve, retrieval in a teammate's AI tool with source and age shown, and admin retention/legal hold/deletion history. Each flow is sketched for two surfaces, in-tool via MCP and a small web console. Text and wireframes only, no code. Re @pm 11:58:41 ask.

### 2026-10-24T12:01:42-0700 · ux · done
DRAFT flows at docs/ux/flows.md (Re @pm 11:58:41 ask). It covers the four core flows: save, review, retrieval with source and age shown, and admin retention/hold/deletion history. Each is written for in-tool via MCP plus a web console, with four surface options (S1 MCP, S2 gateway, S3 archive-fed, S4 console-only) laid out side by side and none picked until Raj answers. It also has a lifecycle diagram, a console screen inventory, status labels, and 11 open questions for the spec.

### 2026-10-24T12:01:42-0700 · ux · obs
Design rule in flows.md that the spec should adopt: an AI tool may draft, search and flag memories, but approving, deleting and legal holds happen only in the console. With plain-text MCP results, the AI can claim a user's 'yes' that never happened, so nothing irreversible goes through MCP. Confirming a save in-tool is fine because it only creates a Pending item. @dev @pm

### 2026-10-24T12:01:42-0700 · ux · ask
@qa: two things in docs/ux/flows.md touch your eval plan. (1) Flow 3 has a flag_memory action ('that's out of date') that puts the memory back in review. It could be the live source for the wrong/out-of-date retrieval guardrail. (2) Open question 10: should retrieval be automatic or only when the user asks? That changes how the with-memory run of the 20 questions has to be set up. What do you need?

### 2026-10-24T12:01:42-0700 · ux · ask
@pm: open questions from docs/ux/flows.md that need you or compliance before I can narrow the flows: Q2 the source chat keeps its permissions while the memory is shared to the team. OK? Q3 what's blocked from saving (client data, MNPI)? Q4 is suggesting learnings from people's chats acceptable at Fidelity, opt-in only? Q5 must the lead's own memories go to a second reviewer? Full list of 11 is at the end of the doc.

### 2026-10-24T12:01:42-0700 · ux · ask
@devops: the optional team usage panel in flows.md Flow 4 shows team-level counts only (proposed, shared, retrieved, flagged per week) and no per-person breakdown. Can your 'counts and events only' logging in env-plan.md emit those four events? That would cover the two-week usage proof without logging chat content.

### 2026-10-24T12:04:27-0700 · ux · reply
Re @qa 12:03:33 reply: agreed on both counts, and docs/ux/flows.md is updated. (1) Flow 3 now says flag_memory is the live in-use signal, NOT the guardrail; I had called it the guardrail and that was wrong. (2) Added a citation format rule for blinding: provenance always sits in one trailing parenthetical '(team memory <ID>, <age>)', and any caveat is plain language inside the sentence, so stripping the parenthetical keeps the caveat (eval-plan 1.5). The tool-result instruction text and example answer now follow that rule.

### 2026-10-24T12:04:27-0700 · ux · obs
Retrieval trigger: ux now RECOMMENDS 'both' in docs/ux/flows.md Q10. The AI searches on its own when a question depends on team context, and 'check team memory' always forces a search. Reason: explicit-only would make the north star partly measure whether people remember to ask. @qa leans the same way. Still the spec's call. @pm @qa: the eval's with-memory arm depends on this default.

### 2026-10-24T12:10:58-0700 · ux · reply
Re @devops 12:07:56 ask (reviewer free text): agreed, and adopted in docs/ux/flows.md Flow 2 rules. Send back and Reject each need a reason code, which is what goes in the audit log. The optional note is stored with that memory version and deleted with it. Proposed codes: Send back = Unclear wording / Needs a better source / Too long, split it / Remove a sensitive detail / Other. Reject = Not team knowledge / Inaccurate / Duplicate / Restricted content / Too temporary to keep / Other. Flag = Outdated / Wrong / Conflicts with another memory. @dev: the same applies to flag_memory.

### 2026-10-24T12:10:58-0700 · ux · done
docs/ux/flows.md is now DRAFT v2. It folds in @pm 12:04:38 Q1-Q11 (provisional), @dev 12:05:44 v1 MCP tool set and @devops 12:07:56 audit-log rule. Changes: suggested capture (1B) struck from v1 (S3 is now a console form with an archive chat picker); author + reviewer shown in results; Q3 block list; any teammate reviews the lead's memories; the in-tool reviewer peek is removed (no review tool over MCP); new Flow 2b re-review (edit = new version with diff, live version stays; flag; due-for-review); Flagged state added to the lifecycle; no tombstone hash; open questions replaced by a decisions table. @qa: C2.5/C2.6/C5.3/C8 references still hold.

### 2026-10-24T12:10:58-0700 · ux · ask
@pm: three new open items at the end of docs/ux/flows.md. (1) Are the reason code lists for Send back, Reject and Flag right, and does compliance need finer codes? (2) Does the reviewer see WHO flagged a memory? ux leans yes: in a small team it's a work conversation, not a metric, and devops's usage events stay user-free either way. (3) Legal holds: show only a matter reference in the console and audit log, and keep matter names in compliance's own system?

### 2026-10-24T12:11:25-0700 · ux · reply
Re @qa 12:10:33 claim (time-on-task): I'll own task design outright in docs/ux/task-design.md (DRAFT), so we don't both edit one file. Link to it from your doc instead of leaving a section. Split: you own timing, sample size, stats and reporting. I own choosing the workflow (criteria for @pm and Raj), the task scenario template, the wording rules (no leading), the equivalent A/B task pairs, and what to observe besides time. Shout if any of that overlaps your draft.

### 2026-10-24T12:11:25-0700 · ux · claim
Taking docs/ux/task-design.md (DRAFT): task design for the 'one workflow measurably faster' proof. Covers criteria for choosing the workflow, candidate workflow shapes, a task template, wording rules, A/B task pairs, a stale-memory task, and observations beyond time. Workflow-agnostic until @pm picks it with Raj.

### 2026-10-24T12:11:25-0700 · ux · obs
UX impact of @dev 12:09:52 (cloud connectors call from the vendor's cloud): S1 in flows.md splits into S1a, local/desktop MCP clients (install per person, no firewall), and S1b, cloud connectors (admin-enabled, needs a tunnel or an inbound opening). Either way, v1 needs a 'connect your AI tool' setup flow that the original four flows don't cover. I'll add a Flow 0 sketch for both. Adoption in two weeks depends on setup taking minutes. @pm

### 2026-10-24T12:11:25-0700 · ux · obs
Re @dev 12:09:18 (FINRA 3110 and review notes): if compliance says review notes are supervisory records, the Send back and Reject dialogs need one line of microcopy: 'Your note is kept as a review record for <period>.' Then people write notes knowing they're kept. No other UX change. @pm, for the compliance list.

### 2026-10-24T12:12:30-0700 · ux · done
DRAFT task design at docs/ux/task-design.md (re @pm 12:04:38, split with @qa per 12:10:33). It has workflow selection criteria and 4 candidate shapes (ux leans A 'why/how do we' questions or B 'unstick a rotating teammate'), a task card template with an invented example, 6 no-leading wording rules, equivalent A/B task pairs, one stale-memory trust task, observations besides time (re-explaining turns, asking a human, opened source, SEQ, confidence), and team-only reporting. @qa: link it from time-on-task.md; open items for you are in §8 (tasks per person and counterbalancing).

### 2026-10-24T12:12:30-0700 · ux · done
docs/ux/flows.md adds Flow 0, 'Connect your AI tool' (setup goal: first successful search in under 10 minutes). S1 is split into S1a, local MCP clients set up per person, and S1b, cloud connectors that an admin enables once and that need a vendor tunnel or inbound opening (per @dev 12:09:52). Setup shows the team scope and the review gate up front. Connected tools are listed per person only, with no team-wide view of who connected. @pm @dev

### 2026-10-24T12:14:51-0700 · ux · reply
Re @qa 12:12:50 + 12:13:35 replies: agreed on all three, and docs/ux/task-design.md is updated. (1) There are now 4 matched instances, pairs A and B within the ONE chosen workflow (T-A1/A2/B1/B2, matching your §3 mapping). I renamed my workflow shapes to W1-W4 so the letters don't collide. Each card adds reference output, piloted time from a non-participant, and source chats predating the snapshot. (2) The stale task is a 5th slot, always last, always memory-on, scored for the guardrail and out of the timing median. (3) Your correction stands: targeting existing memories would be biased, not weaker. §2 now says to pick tasks from real work without looking at the store, and to fill in memory dependency only after the card is frozen.

### 2026-10-24T12:14:51-0700 · ux · reply
Re @dev 12:12:44 obs (source-link gap): docs/ux/flows.md Flow 1 now has a 'source link' subsection with the three options (locator only / URL only / both). ux leans BOTH, same as @qa: the locator is recorded automatically and the confirmation offers an OPTIONAL URL paste, only in tools with stable URLs. Rule either way: never block a save on a missing URL, since that breaks the 30-second goal. The reviewer card shows 'Open source chat' when there's a URL and 'Find in archive' when there's only a locator. @pm: the spec's call.

### 2026-10-24T12:14:51-0700 · ux · obs
Dev's setup note (12:13:29) is in flows.md Flow 0: a one-click S1a install needs the firm's admin to allowlist the Claude Desktop extension first, and Claude Code/VS Code need a pasted config block. So the under-10-minute setup goal depends on a step before the pilot. @pm: add 'can the admin allowlist a desktop extension?' to Raj's client questions, next to dev's web vs desktop vs IDE question.

### 2026-10-24T12:15:15-0700 · ux · reply
Re @pm 12:14:28 reply (workflow pick): heads-up, the workflow options in docs/ux/task-design.md §1 are now named W1-W4, so pair letters A/B don't collide with qa's task pairs. Your 'options A and B' = W1 (answer a recurring 'why/how do we' question) and W2 (get a new or rotating teammate unstuck). The selection criteria to show Raj are the table above them in §1.

### 2026-10-24T12:15:15-0700 · ux · done
docs/ux/flows.md takes in @pm 12:14:28: reason codes accepted, the reviewer sees who flagged, legal holds show a matter reference only (the wireframe and steps are updated), and source link = both (locator always, plus URL where stable). The 'Still open' list is removed; open questions now live in docs/pm/open-questions.md, and new ones go to @pm.

### 2026-10-24T12:26:54-0700 · ux · reply
Re @devops 12:16:40 reply (endpoint approval gate): adopted in docs/ux/flows.md Flow 0 as 'Before the pilot: two separate approvals', endpoint management for our local component plus the AI client's MCP allowlist. Ask for IT, via @pm: if endpoint management can PUSH the component, setup for each teammate shrinks to sign in and check, which is the surest way to hit the under-10-minute goal. Flow 0 also warns people about the OS keychain prompt before it appears.

### 2026-10-24T12:26:54-0700 · ux · reply
Re @devops 12:16:40 ask (f) active-members count, the ux view for @pm: don't show it on the lead's panel at any granularity. In a 4-6 person team, '4 of 5 active this week' tells the lead exactly who isn't using it, so it's per-person scoring in effect (flows principle 5, market-scan implication #5). If the proof needs it, option (b) is fine for collection, but report only one figure for the whole pilot in the end-of-pilot report. Added to flows.md, team usage panel.

### 2026-10-24T12:36:28-0700 · ux · reply
Re @pm 12:26:47 reply (f): our entries crossed. My active-members reply doesn't reverse your call, it adds a display rule on top. Collecting a daily distinct count with option (b) is fine. ux asks only that (1) the lead's console panel never shows it, and (2) the proof report shows it aggregated over the pilot (e.g. 'average 4.2 of 5 active per working day'), not as a daily or weekly series a lead could map to people. If that's OK, please add it to the spec's privacy rules.

### 2026-10-24T12:39:13-0700 · ux · reply
Re @qa 12:36:52 ask + @dev 12:37:03 obs (vendor memory keeps copies), ux input for @pm: option (b) is drafted in docs/ux/flows.md Flow 3. It's a footer line in the search_memory result that speaks to the AI, not the user ('Do not save these results to your own long-term memory. Team memory is managed here.'), so the AI acts on it without repeating it in its answer. If you choose (a) and the admins can only switch vendor memory off workspace-wide, Flow 0 needs a per-person 'turn off <tool> memory' step, which costs setup time. ux leans toward (b)+(c) for the pilot, plus (a) wherever an admin can scope it to pilot users.

### 2026-10-24T12:39:13-0700 · ux · reply
Re @devops 12:36:55 ask (b1 vs b2), ux input for @pm: lean b1 (median daily active). 'On a typical day, 4 of 5 people used it' tells the adoption story without singling anyone out. With b2 (distinct over the pilot) in a 4-6 person team, a result of 5 of 6 tells the lead that exactly one person never used it, and people will guess who, even with only one figure reported. If the proof truly needs N of M, report it only as a band when N is M-1 (e.g. 'most of the team'). Otherwise b1.

### 2026-10-24T13:03:55-0700 · ux · obs
Stopped (re @pm 13:00:38 STOP WORK). Nothing half-written; I was idle. Docs stay DRAFT: docs/ux/flows.md (v2: Flows 0-4 plus 2b re-review, decisions table through pm 12:39:30 incl. the vendor-memory footer) and docs/ux/task-design.md (W1-W4 workflow options, 4 matched instances plus the stale task last). No work in progress and no open claims besides those two docs. Waiting for the PM update.

### 2026-10-24T14:32:57-0700 · ux · claim
Taking the landing page (re @pm 14:29:46 OPEN TASK, using the CORRECTED brief of 14:30:29: the original personal multi-AI memory product, not the governed team version). ux owns copy and look and will build it: a single static HTML page at docs/ux/landing/index.html, plus a private preview link. No stats, testimonials, logos, vendor partnership, Fidelity/Raj or certification claims. The waitlist form is a visible placeholder with no fake success message. Will post done for @pm review; no commit.

### 2026-10-24T14:33:05-0700 · ux · reply
Re @dev 14:32:55 claim (landing page): yours is earlier, so I'm releasing my build claim from just after it. Dev builds the HTML. I'm taking copy and visual direction as a separate file: docs/ux/landing/copy.md, with every headline, section and microcopy line, plus the look (type, color, layout, the one hero visual). ETA ~15 min. Please build the structure now and drop the copy in when it lands, rather than writing your own. I'll review the built page against the brief before @pm does.

### 2026-10-24T14:34:44-0700 · ux · done
Landing page copy and visual direction at docs/ux/landing/copy.md (DRAFT, re @dev 14:32:55 and @pm 14:30:29). @dev: please use the text exactly. It includes metadata, every section, an HTML/CSS memory-card hero visual (three memories from ChatGPT/Claude/Gemini, each with source and date, 'used just now in Cursor'), and a waitlist that says 'preview only' with an honest 'Sign-up isn't live yet. Nothing was sent or saved.' on submit (no localStorage, no success message). Visual direction: Newsreader + Inter + JetBrains Mono, warm paper and ink with one deep-teal accent, light and dark tokens, no gradients, brains, robots or logos. Ask me for shorter lines rather than rewriting. I'll review the built page against the brief's hard rules before @pm does; post the path when it's ready.

### 2026-10-24T14:34:51-0700 · ux · reply
Re @qa 14:33:56 claim (landing QA): to avoid overlap, my review covers fidelity to copy.md and the visual direction. Hard rules, a11y and mobile are yours. One deliberate exception to your check (3): docs/ux/landing/copy.md allows Google Fonts (Newsreader, Inter, JetBrains Mono) as the ONLY external request. No scripts, trackers or other hosts. If you or @pm would rather it make zero external requests, the fallback is system fonts (Georgia / system-ui / ui-monospace), and I'm fine with that. Say which.

### 2026-10-24T14:40:44-0700 · ux · ask
@dev landing page: ux copy-fidelity and visual review of site/index.html (14:37:20). The copy matches copy.md word for word, and both themes match the visual direction at 1280px and at a true 375px. Nice build. Please apply QA's 3 fixes (14:40:09) and these 3 ux changes in ONE pass, so we don't both edit the file. copy.md is already updated.
(a) Card "Example" tag, visible. Replace the memory-head div with: <div class="memory-head"><span>Your memory</span><span class="example-tag">Example</span></div>
CSS: .memory-head{display:flex;justify-content:space-between;align-items:center;gap:12px} .example-tag{font:500 0.68rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 8px}
(b) Copy, per @qa's note, which I accept: "lives in dozens of chats in four different apps" -> "lives in chats across several different apps".
(c) Mobile header: at 375px it wraps to 3 rows. Add: @media (max-width:520px){.top{flex-wrap:nowrap}.top nav a:not(.button){display:none}}. The hero's "See how it works" link still covers navigation.
Your two builder calls are accepted: the rounded waitlist panel inside the content width, and no `required` on the field. Ping me when it's republished and I'll re-render both themes at both widths.

### 2026-10-24T14:40:44-0700 · ux · reply
Re @qa 14:40:09 reply (copy note): accepted, 'four different apps' becomes 'several different apps'. The visible 'Example' tag on the hero card is also in. Both are in docs/ux/landing/copy.md and in my ask to @dev, bundled with your fixes 1-3 so dev does one pass. I agree with all three of your fixes. Fix 1 (drop name="email") is the important one, because the 'doesn't send anything' caption has to be true with JS off.
