# Market scan: governed cross-AI team memory

Owner: pm · Status: complete · Date: 2026-10-24
Product frame (visual 2x2): https://claude.ai/artifact/Yc57m857wVyKvnHvrADkKg

## Bottom line

Personal memory that spans several AI tools is crowded. Raj's pain is governed team memory. Capturing AI chats is already solved for tools a firm officially approves. The open gap is **governed reuse**: nobody turns captured chats into reviewed, team-shared knowledge that flows back into the AI tools.

## Product frame

| | Status | Statement |
|---|---|---|
| User | Confirmed | Raj Reddy, Product Manager at Fidelity. His team uses several AI tools with no central way to manage what they learn in chats. He worries about compliance and losing organizational memory. |
| Shape | Confirmed | An internal tool a team adopted. Proof: usage logs over two weeks, one workflow measurably faster, a quote from the team lead. |
| Problem | Pending approval | Teams that work across several AI tools lose what each person learns in chat. It stays in one person's history, one vendor's memory, or a compliance archive nobody can search. The team re-explains context, repeats mistakes, and loses what it knew when people leave. |
| North star | Pending approval | Context-dependent questions answered correctly: X/20 without memory vs. Y/20 with memory. The questions are real questions from Raj's team, frozen on Friday. Raj judges the answers. Guardrail: count wrong or out-of-date retrievals. |
| Persona | Proposed | The governed AI team lead. Leads a small team in a regulated enterprise (financial services first) that uses two or more approved AI tools daily. Answers for what the team knows and for passing audits. Users: the team lead and team. Approvers: the AI platform team and compliance. Out of scope: solo "second brain" users and developers building agents. |

## Landscape

| Category | Players | Works across tools | Shared by a team | Governed | Gives knowledge back to the AI tools |
|---|---|---|---|---|---|
| Built-in memory | ChatGPT (incl. Dreaming, Jun 2026), Claude, Gemini, M365 Copilot, Grok | Import only (Claude, Gemini) | No | Partly. Copilot memory has no audit log, and Microsoft's retention rules don't cover it | Own tool only |
| Personal multi-AI tools | MemoryPlugin ($89/yr; team buckets on the $180 Pro plan), Supermemory ($3M seed), MemoryLake (offices in mainland China), XTrace (team product covers coding agents only), OpenMemory | Yes | Weak | Weak | Yes |
| Enterprise memory | Glean (accepts memory writes over MCP from ChatGPT, Claude, Cursor and Copilot since Jun 2026, with a record of each memory's source) | Yes | **No**: its docs say it doesn't share memory between users | Yes | Yes |
| Compliance archives | Smarsh, Global Relay, Theta Lake; Microsoft Purview; OpenAI, Anthropic and Google compliance export APIs | Yes | Compliance staff only | Yes | **No**. Global Relay's AI Assistant offers plain-language search only |
| Developer infrastructure (building blocks, not competitors) | Mem0 ($24M), Zep, Letta, Cognee, MinIO AIStor Memory | N/A | Built by the app | Varies | N/A |
| Not a competitor | Engram ($98M, Jun 2026): compresses company context inside the model to cut costs. It doesn't collect employee chats. | | | | |

Who could close the gap first: **Glean** (by adding team sharing), **Global Relay** (by adding memory), and **Fidelity's own AI platform team**.

## Fidelity context

- Peer firms run their own multi-model portals: JPMorgan's LLM Suite, Goldman's GS AI Assistant, Morgan Stanley's OpenAI-based assistants, and Vanguard's firm-wide Copilot.
- A July 2026 Fidelity job posting describes an "AI Control Plane": one governed layer through which every AI app is provisioned, with in-house "memory services". **Unconfirmed**: we only saw it on a mirror site.
- If that's right, "multiple AI tools" for Raj means several models behind one approved gateway, plus Copilot and coding assistants. The gateway is the place to integrate, and the buyer is the AI platform team, not a PM.

## Regulation

- **EU AI Act: not a 2026 driver.** The Digital Omnibus (Regulation (EU) 2026/1744, in force Jul 27, 2026) moved the high-risk rules to Dec 2, 2027. An internal memory tool is probably not high-risk, unless it profiles or scores employees. "Lineage tracking" is not a term the Act uses.
- **The real driver is US securities record-keeping:**
  - SEC 17a-4 requires WORM storage or an audit-trail alternative.
  - FINRA 4511 (retention) and 3110 (supervision) apply.
  - FINRA's 2026 oversight report treats prompt/output logs and model-version tracking as good practice.
  - Regulatory Notice 24-09 makes the rules technology-neutral, so they apply to vendor tools too.
- **Softening factors:** whether AI chats legally count as business records is unresolved. Under Chair Atkins, the SEC has dropped off-channel enforcement and may narrow the "business as such" scope of 17a-4. Sell readiness for an exam, not fear of fines.
- **Vendor oversight:** amended Reg S-P requires service providers to report breaches within 72 hours, and FINRA 21-29 covers supervising outsourced functions. Expect SOC 2 Type II, disclosure of LLM subprocessors, audit rights, and data return when the contract ends.
- **GDPR:** US retention rules don't override erasure rights for EU individuals. Needs per-record retention schedules and deletion that leaves an audit trail.

## Implications for the build

1. **Don't build capture as a browser extension.** At a firm like Fidelity it looks like the unapproved AI tool security teams block. Read from vendor compliance APIs, the firm's archive, or its internal AI gateway.
2. **Deliver memory back into the AI tools over MCP**, which ChatGPT, Claude, Copilot Studio and Cursor all support.
3. **Governance is the product.** Needed: a link from each memory to its source chat, a review step before a memory is shared, retention and legal hold, deletion that leaves an audit trail, PII redaction, and access inherited from the source's permissions.
4. **A shared memory turns chats that would disappear into permanent records** that can be pulled into legal discovery. Compliance may see that as more risk. The spec must state how memories are classified and how they expire.
5. **Don't build per-employee scoring or analytics** of AI usage quality. That would push the tool into EU high-risk territory and worries works councils.

## Open risk

Fidelity may not let Raj's team connect or paste work into an outside tool within two weeks. If not, the "tool a team adopted" shape fails, and we fall back to a design-partner shape or a different team. The user is asking Raj which AI tools his team is allowed to use and whether an external tool can connect.

## Sources

- ChatGPT Dreaming: https://openai.com/index/chatgpt-memory-dreaming/
- M365 Copilot memory: https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory
- Glean memory: https://docs.glean.com/user-guide/assistant/memory-personalization
- MemoryPlugin: https://www.memoryplugin.com/
- Supermemory: https://supermemory.ai/pricing
- Engram: https://www.vktr.com/ai-news/engram-launches-with-98m-to-give-enterprise-ai-memory/
- Mem0: https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/
- Smarsh Claude capture: https://www.businesswire.com/news/home/20260521268183/en
- Global Relay AI Assistant: https://www.globalrelay.com/products/global-relay-ai-assistant/
- Purview for ChatGPT Enterprise: https://learn.microsoft.com/en-us/purview/ai-chatgpt-enterprise
- Claude Compliance API partners: https://support.claude.com/en/articles/15167101-get-started-with-claude-compliance-api-integrations
- Google Vault Gemini export: https://workspaceupdates.googleblog.com/2026/10/google-vault-now-supports-filtered-exports-for-Gemini-in-Workspace.html
- Fidelity GenAI platform job (mirror, unconfirmed): https://jobs.leadershiptriangle.com/companies/fidelity/jobs/87812247-vice-president-generative-ai-platform-engineering
- EU AI Act Omnibus: https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes
- FINRA 2026 oversight report, gen AI: https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai
- FINRA Notice 24-09: https://www.finra.org/rules-guidance/notices/24-09
- SEC Chair Atkins on off-channel: https://www.financial-planning.com/news/secs-atkins-criticizes-off-channel-comms-enforcement
