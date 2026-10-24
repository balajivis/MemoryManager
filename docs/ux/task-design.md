# Task design: "one workflow measurably faster"

Owner: ux · Status: **DRAFT** (spec phase) · Date: 2026-10-24
Pairs with: [docs/qa/time-on-task.md](../qa/time-on-task.md), which owns timing, sample size, stats and reporting. This doc owns **which tasks get timed and how they are worded**.
Inputs: [flows](flows.md), [eval plan](../qa/eval-plan.md), and the PM's ask of 2026-10-24 12:04:38. The PM chooses the workflow with Raj. Until then, everything here stays workflow-agnostic.

No real team content appears here. Examples are invented. Real tasks are written with Raj's team and stay on their side, like the eval test set.

---

## 1. Choosing the workflow (criteria for @pm and Raj)

A good workflow to time has **all** of these properties:

| Criterion | Why |
|---|---|
| **It recurs** (weekly or more, across several people) | A one-off speedup isn't a workflow, and the team needs reps during the two weeks |
| **It depends on team context that lives in past AI chats** | Otherwise memory can't help, and we'd be timing the AI tool, not the memory |
| **Its end state can be checked** (a sent answer, a filled section, a decision written down) | "Done" has to be unambiguous for timing (qa owns the stopwatch rules) |
| **One instance takes about 8 to 20 minutes today** | Shorter tasks get lost in noise. Longer ones don't fit a 45 to 90 minute session (qa time-on-task) |
| **It involves no client data, account numbers or MNPI** | The same block list as flows Q3. The test must not create a compliance problem |
| **Raj can judge whether the result is correct** | Speed only counts when the result is right (§3, rule 6) |

### Candidate workflow shapes (illustrative, to start the conversation with Raj)

| Shape | Example (invented) | What memory should save |
|---|---|---|
| **W1. Answer a recurring "why/how do we" question** | A stakeholder asks why the team stopped using a vendor report. The answer sits in a decision someone reached in a chat two months ago | Digging back through threads and asking around |
| **W2. Get a new or rotating teammate unstuck** | Someone covering for a colleague has to run the monthly data reconciliation and hits a known gotcha | Re-explaining, waiting for the one person who knows |
| **W3. Draft a recurring document section with team-specific constraints** | Writing the "risks and dependencies" part of a feature brief that has to follow the team's agreed review path | Re-establishing constraints in every new chat |
| **W4. Diagnose a recurring issue** | A dashboard shows stale numbers, and the cause and fix were worked out in an earlier chat | Re-diagnosing from scratch |

ux leans toward **W1 or W2**: their end states are crisp, and they show the "lose what we knew when people leave" problem from the product frame most directly.

## 2. Task template

Each participant does **4 timed instances from the one chosen workflow**: two different tasks (pair **A** and pair **B**), each in two matched forms (1 and 2). That's 4 cards (T-A1, T-A2, T-B1, T-B2), plus the stale-memory card (§5). Write every card **before** the freeze, and don't change them after.

**Pick tasks from real work without looking at the memory store.** Choosing tasks because a memory exists for them biases the test in memory's favor (qa time-on-task §4 rule 2). If @pm wants a best-case demo, label it a best case, not the proof.

| Field | Content |
|---|---|
| **ID** | e.g. T-A1 (pair A, form 1). A and B are two different tasks inside the chosen workflow, not workflow shapes |
| **Matched form** | The equivalent card in the other form (T-A2). See §4 |
| **Scenario** | 2 to 4 sentences in the participant's own work language: who needs what, and why now. Not instructions |
| **Start state** | What's open when the timer starts (the AI tool, an empty chat, the request message) |
| **Done when** | One observable end state, e.g. "the reply to the stakeholder is pasted into the response box" |
| **Correct when** | A reference answer plus a rubric (correct / partly correct / wrong), written by Raj, the same format as eval-plan |
| **Allowed** | The tools and sources the participant may use in **both** conditions (their AI tool, team chat, wiki) |
| **Reference output** | Written before the session (by Raj or a delegate). Grading compares against it |
| **Piloted time** | Measured on someone who isn't a participant. Instances should run about 8 to 20 minutes |
| **Time cap** | 2× the piloted time (qa). Hitting the cap counts as "not done" |
| **Source chats** | The real chats the answer depends on. They must **predate the memory snapshot** |
| **Memory dependency** | Filled in **after** the card is frozen: which memory IDs, if any, cover it. Hidden from the participant, used only in analysis |
| **Traps** (optional) | e.g. a Due for review memory that is now wrong (§5) |

### Example card (invented)

```
T-A1 · matched form T-A2
Scenario   Priya from Distribution messages you: "Why did your team stop using the weekly
           flows report from the old vendor? My director is asking." Reply so she can
           forward it to her director.
Start      Your AI tool open with a new chat; Priya's message in the response box.
Done when  Your reply is in the response box and you say "done".
Correct    States the reason (the report double-counted transfers, decided in Q2) and what
           replaced it. Partly: right reason, no replacement. Wrong: anything else.
Allowed    Your AI tool, team chat search, team wiki. Same in both conditions.
Cap        20 min
Memory     M-0xx (vendor report decision), M-0yy (replacement report)
```

## 3. Wording rules (so the task doesn't lead)

1. **Describe the situation, not the steps.** "Priya needs to know why…", never "Search team memory for…".
2. **Never name the feature** ("team memory", "MemoryManager") in either condition. Whether people reach for it is part of what we measure (flows Q10: retrieval is automatic plus explicit).
3. **Don't put the answer's keywords in the task.** Write "why did your team stop using that report", not "the double-counting issue".
4. **Use the same voice, length and structure for both forms of a pair** (§4).
5. **Run every card past one teammate first** (a pilot) and fix anything they ask about. Don't explain it live in the real session.
6. **Correctness gates speed.** A wrong answer is reported as wrong, never as fast. qa's protocol applies this in the analysis. Wording just has to make "correct" checkable.

## 4. A/B pairs and order

People learn the answer once they've done a task, so nobody does the same task twice.

- Write each task as **two matched forms** (A1 and A2, B1 and B2): same shape, same difficulty, same kind of source, a different fact.
- Each participant does all four: one form of each pair **without memory**, the other **with memory**. qa's counterbalancing (time-on-task §3) makes each form appear in each condition equally often, with half the people starting with memory and half doing pair B first.
- Check that the forms are equivalent in the pilot: their baseline times should be close. If not, rewrite the slower one.

## 5. One stale-memory task (trust check)

Add **one extra slot**, always **last**, where the most relevant memory is **Due for review and now wrong**. It goes last because meeting a stale memory early would make people trust memory less and skew their later with-memory times (agreed with qa). It is adversarial by design: unlike the timed cards, it's built around a memory on purpose. It always runs with memory on, and the stale memory comes back with its ⚠ warning (flows Flow 3).

- What we learn: do people heed the warning and verify, or copy the stale answer? That's the human side of the eval's guardrail.
- It's scored for the guardrail and kept **out of the timing median**.
- Reveal it in the debrief, and say this task was built to test the warning, so people don't leave trusting the tool less than they should.

## 6. What to observe besides time

Capture these per task, in both conditions:

| Observation | How |
|---|---|
| Correctness | Raj grades with the card's rubric, blind to condition if possible (as in eval-plan 1.5) |
| Re-explaining context to the AI | Count the turns spent giving background ("our team uses…") |
| Asking a human | Did they message a colleague? How long did they wait? |
| Opened the source chat | Yes or no (with memory only): is provenance used, or just shown? |
| Verified a ⚠ memory | Yes or no (stale task) |
| Ease | Single Ease Question (1–7) right after each task |
| Confidence in the answer | 1–5, right after each task |

After the session: 3 open questions, including *"What would you tell another team lead about this?"*. The lead's answer is a candidate for the **team lead quote** that the product frame's proof needs. Ask permission before quoting.

## 7. Ground rules (match flows principle 5)

- Tell participants it's **the tool** being tested, not them.
- Results are reported **for the team only**: no per-person times in any report, and nothing goes to a manager as individual performance.
- Participants can stop at any point. Any real content that comes up in a session stays on Raj's side.

## 8. Open items

- **@pm and Raj:** which workflow shape (A to D, or another), and how many people can take part (4 to 6 expected).
- ~~@qa: tasks per person and counterbalancing~~. Settled: 2 pairs (4 timed instances) plus the stale task last, 45 to 90 minutes per person (time-on-task §3).
- **Timing risk:** with a freeze on Oct 30, the team's real source chats have under a week to build up, so many tasks may have no memory behind them. That's an honest result, not something to fix by choosing tasks that have memories (§2). If the store is thin, the report says so.
