# Time-on-task protocol: "one workflow measurably faster"

Owner: qa (timing, sample size, stats, reporting) · Task design: ux, in [task-design.md](../ux/task-design.md) · Status: **DRAFT** · Date: 2026-10-24
Asked for by pm on 2026-10-24 at 12:04. pm picks the workflow with Raj. Until then, this protocol is workflow-agnostic.
Companion to [eval-plan.md](eval-plan.md). The eval plan measures whether answers are *right*; this protocol measures whether real work gets *faster*.

---

## 1. What the claim means

"One workflow measurably faster" is part of the proof for the "tool a team adopted" shape. We claim it only if all four of these hold, and all four are fixed before the session:

1. **Effect size:** the median time saved per pair is at least **T%** of the without-memory time. **The user sets T** (user question 3 in open-questions.md). Proposed: 30%, which pm accepts provisionally. Smaller savings are hard to tell apart from noise at this sample size, and too small for a team lead to notice.
2. **Consistency:** at least **all but one** participant is faster with memory, comparing each person's median across their pairs.
3. **No quality cost:** the share of outputs graded *correct* with memory is no lower than without.
4. **No guardrail breach:** no participant got a wrong or out-of-date retrieval that made it into their output (same classes as eval-plan 1.6).

**Why no p-value gate.** With 4 to 6 people, significance is out of reach: in an exact two-sided sign test, even 5 of 5 people faster gives p = 0.06. We report the p-value anyway, but the claim rests on effect size plus consistency. Pre-registering both is what keeps the claim honest.

## 2. Choosing the workflow

**ux owns the selection criteria and the candidate workflows** in [task-design.md](../ux/task-design.md), and pm picks with Raj. Timing adds only these hard requirements; a workflow that fails any of them can't produce a valid result:
- One instance takes about **8 to 20 minutes** when piloted, so 4 timed instances plus the stale-memory task fit in a 45 to 90 minute session. ux's estimate is about 45 minutes.
- "Done" is a **submitted output that can be graded** against a reference.
- The work happens **in the AI tool the pilot uses**, where the memory is reachable.
- The task material holds **no client data or MNPI** (eval-plan C6.3).

## 3. Design

**Within-subject and counterbalanced.** Each participant does the workflow **4 times: 2 task instances without memory and 2 with**, using ux's two matched pairs: A = T-A1, B = T-A2, C = T-B1, D = T-B2. Within each pair, each person does one form without memory and the other with it. The order of conditions and instances rotates across participants, so neither learning nor instance difficulty favors one arm:

| Participant | Slot 1 | Slot 2 | Slot 3 | Slot 4 |
|---|---|---|---|---|
| P1 | A without | B with | C without | D with |
| P2 | A with | B without | C with | D without |
| P3 | C without | D with | A without | B with |
| P4 | C with | D without | A with | B without |
| P5, P6 | repeat the P1 and P2 rows with the instance order reversed (D, C, B, A) | | | |

In this scheme, each form gets each condition equally often, half the people start with memory, and half do pair B first. That gives 8 to 12 pairs from 4 to 6 people. Two pairs from the same person aren't independent, so the consistency rule (1.2) works per person, not per pair.

**The stale-memory task always goes last (slot 5), always with memory on** (ux task-design §5). Once someone has met a stale memory, they may trust memory less on later tasks, which would bias their with-memory times.

**Options for where it runs:**
- **A. Scheduled session (chosen by pm, provisional):** one 45 to 90 minute slot per person. Times are clean, and conditions are controlled.
- **B. In the wild:** participants log the start and end of real instances during the pilot. More realistic, but self-timed, with instances that aren't matched, and adoption ramps up over the pilot. Use it as supporting evidence only, never the headline.

## 4. Rules that keep the comparison fair

1. **Memory is the only difference.** Same AI tool, account type, and everyday resources in both conditions: their own chat history, docs, and asking a teammate. "Without memory" means the memory manager is off, not that people are cut off from their usual help. Record which resources each person used.
2. **Instances come from real work, and memory isn't primed for them.** Instances are reconstructed from real past occurrences whose context exists in source chats dated before the session. The memory store is snapshotted before the session. Task designers must not add memories after choosing the instances (the same rule as eval-plan 1.1 rule 2).
   - **Choose instances without looking at the memory store.** Picking instances because a matching memory exists doesn't make a weaker test; it makes a *biased* one, in memory's favor (ux task-design §8 timing risk). If few memories exist by the session, a small saving is the true result. If pm wants a best-case demonstration with instances chosen where memories exist, label it that way, and don't count it as the "measurably faster" proof.
3. **Instances are matched before the session.** ux designs the matched instances (task-design.md). The timing requirement is that each is piloted with someone who isn't participating, and any instance more than about 1.5× slower than the others is replaced.
4. **The clock is objective.** Start is when the participant receives the task card. Stop is when they submit their output. Use system timestamps from a form or the task card's submit, not a stopwatch or self-report.
5. **There's a time cap** of 2× the piloted time. If someone isn't done by then, the instance stops and is recorded as **not completed, at the cap time**. It isn't dropped.
6. **Grading is blind.** Raj, or the workflow's owner, grades every output against the instance's reference (correct, partly correct, or wrong), without knowing the condition.
7. **No coaching during tasks.** The facilitator answers only process questions. There's no think-aloud while timing, because it slows people down unevenly.

## 5. Measurement and privacy

This protocol times individuals, which **is per-person measurement**. That puts it near the "no per-employee scoring" line (market-scan implication 5), so:

- Participation is voluntary, with written consent that explains what's timed and why.
- Participants are pseudonymous (P1 to P6). The mapping and raw times stay on Raj's side with the eval data (env-plan E3) and are deleted after the report.
- **Only aggregates leave Raj's side**, and no individual result is shown to anyone's manager. What's being measured is the tool, not the person.
- Raw times aren't stored in usage logs (C9.1).

**Recorded per instance:** participant code, instance, condition, start and stop timestamps, completed (y/n), grade, and resources used. With memory, also record the memory IDs retrieved and their guardrail class (from the eval trace, E1), plus one optional ease rating after each task (single-question, 1 to 7).

## 6. Report

One section of `docs/qa/eval-runs.md`, aggregates only:

- Median time without and with memory, and the **median paired saving in minutes and %**.
- Persons faster with memory, e.g. "5 of 6", with the exact sign-test p reported for transparency (see section 1).
- Correct-output rate in each condition; completion rate in each condition.
- Guardrail incidents (section 1, rule 4).
- Median ease rating in each condition.
- **Verdict:** "measurably faster" only if all four conditions in section 1 hold. Otherwise "directional" or "no difference", with the numbers shown.
- Limitations: small n, one team, one workflow, matched rather than identical instances, and a facilitated session.

The team-lead quote the proof also needs is a separate ask: Raj's own words after seeing the result, not prompted by the report.

## 7. What this protocol needs from task design

ux owns the task template, wording rules, and A/B pairs in [task-design.md](../ux/task-design.md). For timing to work, the workflow needs:
- **4 matched instances (two A/B pairs)**, because each person does 2 per condition (section 3).
- For each instance: a **reference output** written before the session (for blind grading), a **piloted time** (rules 3 and 5), and the **source chats** holding the helpful context. Those chats must predate the memory snapshot.
- **The stale-memory task** in task-design.md: run it as a 5th, extra slot and score it for the guardrail (did the person catch the stale memory?). Keep it **out of the timing median**, because it's adversarial by design and would distort the time comparison.

## 8. Open questions

These now live in [docs/pm/open-questions.md](../pm/open-questions.md): T% (user 3), which workflow (Raj 7, from ux's W1 or W2), the question sheet (Raj 8), and consent for timing people (compliance 9). Session (A) is chosen. The date is the user's call, because it depends on the build decision, and it must come after enough real source chats exist.
