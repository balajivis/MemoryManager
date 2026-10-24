# Technical feasibility: sources, retrieval and store

Owner: dev · Status: **DRAFT v2** · Date: 2026-10-24 · Answers pm's ask of 11:58:41

**pm 12:14:28 accepted the direction, pending Raj's answers:** v1 has no capture integration; the two-week bet is P1 (console) + P2 (local MCP + firm-hosted store); P3 only if the team is web-only and security approves a tunnel; P5 is phase 2.

Research is from vendor docs as of 2026-10-24. Anything not marked **[unverified]** was checked against the linked source. The OpenAI help-center pages blocked fetching, so OpenAI claims marked **[excerpt]** rest on search excerpts of those pages. Nothing here picks a toolchain. Where Raj's tool answer matters, options are listed and the decision is left open.

---

## 0. Bottom line

1. **v1 needs no capture integration.** pm Q4 makes saving explicit, so capture is just two things: the `propose_memory` MCP tool, and a paste form in the console. The compliance exports drop out of the two-week path. Later they're useful for checking source links, carrying source deletions, and suggested capture in phase 2.
2. **No vendor offers a key scoped to one team.** The OpenAI Compliance Logs Platform, the Anthropic Compliance API, the Graph Copilot export and Purview eDiscovery all read org-wide or tenant-wide. The only narrower routes are Graph per-user webhooks and OU-scoped Vault privileges. This backs devops's rule (env-plan §0.5): we never hold an org-wide key. If an export is used, the firm's compliance team runs it and hands us the team's slice.
3. **The critical path is delivery, not capture.** Every cloud-run AI client calls an MCP server from the vendor's cloud, Claude Desktop *connectors* included. A firm-hosted server therefore needs one of three things: an inbound firewall opening, a vendor tunnel, or local MCP clients. Security review is the longest pole (§4.3).
4. **Fastest realistic path:** the console (P1), plus local MCP clients (P2) if Raj's team uses desktop or IDE AI tools. Neither needs a vendor's cloud to reach the firm network (§3).
5. **The store is small.** One team over two weeks makes tens to low hundreds of memories. A single relational DB with full-text search covers it. Embeddings are optional, and any model used for them is a new data flow that needs approval (§5.3).
6. **An Oct 30 freeze can be met only if building starts very soon.** Sizing for the user's decision is in §7.

---

## 1. What v1 needs from each side

| Need | v1 path | Needs a compliance export? |
|---|---|---|
| Capture a learning | `propose_memory` in-tool (S1/S2) or the console paste form (all surfaces) | **No** |
| Link back to the source chat | The user pastes the chat link, or we record a locator (tool, user, time). See §5.2 | No. An export could *verify* the link later |
| Carry a source deletion through to the memory | Open question for compliance (§8 Q5) | Only if deletions must propagate |
| Suggested capture (S3, flow 1B) | **Out of v1** (pm Q4) | Yes |
| Eval source chats | Raj's team supplies them by hand (eval-plan) | No |

**Source-link gap.** The AI inside a chat doesn't know its own conversation URL, and MCP tool calls carry no conversation ID **[unverified; not in the 2026-07-28 spec]**. So `propose_memory` can't fill in the link by itself. It records the user, tool, client and time, and asks the user to paste the URL. Claude chat URLs are stable (`claude.ai/chat/<uuid>`, the same `href` the Compliance API returns). For ChatGPT, `chatgpt.com/c/<id>` is likely **[unverified]**. Copilot and Gemini have no documented deep links. The spec has to decide whether a *locator* that compliance can resolve in the firm archive counts as "a link to the source chat" (§8 Q4, qa C1).

---

## 2. Ingestion sources

### 2.1 Summary

| Source | What it exposes | Who grants access | Narrowest scope | Latency | Link back | Deletions | Build effort **[unverified]** |
|---|---|---|---|---|---|---|---|
| **Anthropic Claude Compliance API** | Chats, messages, files, artifacts, projects; Claude Code and Cowork sessions; users, groups; activity feed | Enterprise plan. The Primary Owner enables it; an Owner creates the key. Self-service, no partner approval | Org-wide key. A `user_ids[]` filter takes up to 10 users, list by `created_at` only | Activities within 1 min, sessions within minutes. Polling only. 600 req/min per parent org, shared with every other reader | `href` = `claude.ai/chat/<uuid>` | Deleted chats remain as tombstones with `deleted_at` | 3–4 wk |
| **Claude Enterprise inference hooks** | The full transcript of each governed prompt, sent to a firm HTTPS endpoint *before* inference | Firm's Claude admins | All governed users | Real time, 5 s default timeout | Via chat ID **[unverified]** | n/a | 1–2 wk, but it sits in the inference path |
| **OpenAI Compliance Logs Platform** | Immutable JSONL files per event type (`CONVERSATION_MESSAGE`, `AUDIT_LOG`, `CODEX_LOG`, …) with `conversation_id`, author, model, project | Enterprise/Edu only. Only a workspace **owner** can grant the "Conversation messages" permission on an admin key **[excerpt]** | Whole workspace | Minutes to ~30 min (p99). Purview gets it 24 h late | None documented | Not propagated. Logs are append-only **[unverified]** | 2–3 wk |
| **M365 Copilot (Graph export)** | One `aiInteraction` per prompt or response: body, app (Word, Teams, BizChat…), `sessionId`, `requestId`, cited files and meetings | `AiEnterpriseInteraction.Read.All` (application, admin consent). Users need a Copilot license | Pull is tenant-wide. Per-user change notifications can use delegated `AiEnterpriseInteraction.Read` with no admin consent, but they don't backfill | Webhooks under 10 s on average, 60 min max, best-effort. Polling: 30 rps, no delta query | None documented; store `sessionId` and `requestId` | `deleted` events in notifications | 2–3 wk |
| **Microsoft Purview (as a hub)** | Copilot, Copilot Studio, ChatGPT Enterprise, Claude Enterprise (preview), registered apps. Lands in user mailboxes | Text only via eDiscovery export: premium cases (E5 or add-on), service principal in eDiscovery Manager, pay-as-you-go for non-Microsoft AI | Admin units for people; for service principals **[unverified]** | Batch, about a day | None (exports look like email) | Follows Purview retention | 4–6 wk, mostly approvals |
| **Copilot Studio agents** | Dataverse `ConversationTranscript` | Bot Transcript Viewer role per environment | One environment (a natural team boundary) | Batch | n/a | Bulk-deleted after 30 days by default | ~1 wk |
| **Google Vault (Gemini)** | Gemini app: prompts, responses, model, `ConversationId` (API corpus `GEMINI`). Workspace side panel: export only (since Oct 22, 2026); its API is still pending | Vault privileges. Business Plus / Enterprise or higher | Search and export can be restricted to one **OU** | Batch, at most 20 concurrent exports per org | None; store `ConversationId` | Holds override user deletion | 1–2 wk |
| **Internal LLM gateway** | Request/response logs via callbacks or log sinks (LiteLLM, Portkey, Kong, Azure APIM, Bedrock, Cloudflare) | Platform team plus security, privacy, records. Probably 1–3 months **[unverified]** | Whatever the gateway tags | Seconds to minutes. APIM resource logs take 3–10 min | Only if the caller passes a trace ID | n/a | Days to build; months to approve |
| **Firm's archive** (Smarsh, Global Relay, Theta Lake, Purview) | Whatever the firm already captures | Archive owner (compliance/legal) | Custodian scoping | Adds lag | Often lost | Archive's retention | Unknown until we know the vendor |
| **Manual save** | What the user chooses to save | Connector approval (MCP) or nothing (console) | The user | Immediate | User-pasted URL or locator | Ours | Part of the core build |

### 2.2 Notes per source

- **Anthropic** is the cleanest export: self-service, a stable `href`, tombstones, and a user filter that fits a 10-person team. The catch is that the key can still read "every chat, file, project, and session transcript in every linked organization," and incremental sync means walking the whole org by `updated_at`. Claude Code and Cowork sessions have no `href`. Not covered: Console/API prompts, Claude Code via Bedrock/Vertex/API keys, and thinking blocks. Every call logs a `compliance_api_accessed` event, which helps with audit.
- **OpenAI.** The old Compliance API, which could list conversations, GPTs and memories and could delete, was **removed on 2026-06-05** **[excerpt]**. Don't build on it. The Logs Platform keeps files for **30 days**, so a reader must ingest continuously and alert on gaps. Ten people's chats can't be read without downloading every message in the workspace. At Fidelity that's a privacy and volume problem.
- **Microsoft.** Pulling history is tenant-wide only, and Exchange RBAC for Applications doesn't cover this permission. Per-user webhooks are the one least-privilege route, but they need a sign-in per member and an endpoint Microsoft can reach. Unexplained 403s from licensing gates are a known gotcha. Purview is the only cross-vendor hub, but reading from it is an eDiscovery job owned by legal. Phase 2 at best.
- **Google.** Scoping to an OU is the best least-privilege option of any vendor. Workspace side-panel conversations only exist if conversation history was on, and users can delete them by default.
- **Gateway.** It sees only traffic that goes through it. The ChatGPT and Claude web and desktop apps talk to their vendors directly, so a gateway misses them **[unverified]**. Logs are per request, with no thread unless a trace ID is passed through. User identity is often a shared service role. The slow part is the governance review of a new reader of full prompt logs, not the build.

---

## 3. Paths ranked by how fast Raj's team could use them

| Rank | Path | ux surface | What it needs | Our build **[unverified]** | Approval time |
|---|---|---|---|---|---|
| **1** | **P1 Console only.** Paste a learning plus a link; review; search; copy a context pack into any AI tool | S4 | A small web app on the firm network (env-plan option B), login through the firm IdP | ~1 wk | Internal hosting + SSO. Days to weeks, the firm's process |
| **2** | **P2 Local MCP + firm-hosted store.** A local MCP server on each laptop (stdio) calls the firm-hosted store over the firm network | S1 (desktop/IDE clients) | Clients that run MCP locally: Claude Code, Claude Desktop **extensions**, ChatGPT desktop (stdio), VS Code/GitHub Copilot, probably Cursor | +3–5 days on P1 | The client admin allowlists the server (Claude managed MCP, the GitHub enterprise allowlist, Cursor's allowlist). **No inbound opening** |
| **3** | **P3 Cloud connector.** The same MCP server as a remote connector | S1 (web clients) | Workspace owner adds the connector, plus one of: public HTTPS (IP allowlist + mTLS), **OpenAI Secure MCP Tunnel** (outbound-only), or **Claude MCP tunnels** (research preview, Enterprise, by request). Copilot BYO MCP and Gemini need a vendor-reachable endpoint | +1 wk on P2 (OAuth) | Security review of an inbound path or a new tunnel. Weeks to months |
| **4** | **P4 Gateway-integrated** | S2 | The platform team exposes tools or hooks | Depends on the gateway | The platform team's roadmap |
| **5** | **P5 Export-fed suggestions** (phase 2) | S3 | Compliance runs an export and hands over the team's slice | 2–4 wk per vendor | Compliance + infosec |

P2 and P3 are ux's S1a (local clients, set up per person) and S1b (cloud connectors, enabled once by an admin). Both need ux's Flow 0, "Connect your AI tool".

**By Raj's answer:**

- **Internal web apps only** → P1.
- **Desktop or IDE AI clients allowed** → P1 + P2. This is the best two-week bet.
- **Web ChatGPT, claude.ai, Copilot or Gemini only** → P1 now, P3 once security approves a tunnel or endpoint.
- **Everything goes through a firm gateway** → P1 now, P4 with the platform team.
- **Nothing external can connect, not even an internal web app** → the "tool a team adopted" shape fails (market-scan open risk).

---

## 4. Delivering memory over MCP

### 4.1 Spec (revision 2026-07-28)

- **Transport.** Stateless Streamable HTTP: every message is a POST to one endpoint, with `Mcp-Method`/`Mcp-Name` headers. So query text never lands in a URL, which meets devops's L3 rule by default.
- **Auth.** OAuth 2.1:
  - Servers must publish Protected Resource Metadata (RFC 9728).
  - Clients send the RFC 8707 `resource` parameter.
  - Client ID Metadata Documents are recommended. Dynamic Client Registration is deprecated.
- **Enterprise-Managed Authorization** (ID-JAG / Cross-App Access) is a stable extension since 2026-06-18. So far Okta is the only IdP, and Claude and VS Code the only clients. Worth it only if the firm uses Okta (§8 Q3).
- **Primitives.** Tools are model-controlled; resources are app-controlled. Retrieval has to be a tool so the AI can call it on its own (pm Q10).

### 4.2 Tool surface (follows ux's rule and pm Q10)

| Tool | Annotation | What it does |
|---|---|---|
| `search_memory(query, limit?)` | `readOnlyHint` | Returns approved memories in the caller's share scope, checked at query time (qa C5.2). Each result has ID, statement, age, status, author, reviewer and source link or locator, formatted for ux's Flow 3 citation rule. The **tool description** tells the AI to call it on its own whenever a question depends on team context, and every time the user says "check team memory" (pm Q10). |
| `get_memory(id)` | `readOnlyHint` | One memory, with its version and source. |
| `propose_memory(statement, source_link?, tags?)` | non-destructive | Creates a **Pending** item, nothing more. The description says to call it only when the user asks to save. Redaction and the block list run before anything is stored (§5.4). |
| `flag_memory(id, reason_code)` | non-destructive | Puts a memory back in review ("that's out of date"). Codes per ux Flow 2: Outdated / Wrong / Conflicts with another memory. Only the code reaches the audit log (devops 12:07:56). |

**No approve, delete, legal-hold or edit-shared tools exist over MCP at all** (ux rule, pm-adopted). A model can't call a tool that doesn't exist, even if it hallucinates the user's consent.

Client support for write tools and admin control:

| Client | Custom MCP + write tools | Admin can restrict | Where calls come from |
|---|---|---|---|
| ChatGPT Enterprise | Yes. Write actions in beta, with confirmations | Yes (apps RBAC) | OpenAI cloud. Desktop app can run local stdio |
| Claude Team/Enterprise | Yes. Users can block individual tools | Yes. Owners add connectors; managed MCP allowlists for Claude Code | Connectors: Anthropic IPs, even in Desktop. Extensions and Claude Code: local |
| M365 Copilot / Copilot Studio | Yes. Tools that modify data ask for confirmation | Power Platform DLP; Agent 365 approve/block (preview) | Vendor cloud; BYO MCP needs a public endpoint |
| Gemini Enterprise | Yes. Actions off by default; admin enables up to 100 | Admin only | Public HTTPS or private Cloud Run with a public-CA cert |
| GitHub Copilot (VS Code) | Yes **[write: unverified]** | Enterprise allowlist (GA 2026-08-06) | Local |
| Cursor | Yes **[write: unverified]** | Enterprise allowlist plus a per-server network policy | Not documented |

### 4.3 Network reachability (answers devops 12:07:56)

devops's assumption holds, and it goes further: Claude Desktop **connectors** also call from Anthropic's cloud. Only Claude Desktop **extensions** and Claude Code run locally. For option B (firm-hosted) the choices are:

1. **Local clients (P2).** The stdio server runs on the laptop and calls the firm-hosted store outbound over the firm network. No inbound rule. Side effect: desktop clients may write MCP traffic into their own local logs (devops L8).
2. **Vendor tunnel.** OpenAI Secure MCP Tunnel (outbound-only client, `github.com/openai/tunnel-client`) or Claude MCP tunnels (outbound-only, carried by Cloudflare, can reach RFC 1918 addresses; Enterprise research preview, by request). A tunnel is itself a new egress path that security must approve.
3. **Inbound opening** for vendor IP ranges, with a public-CA certificate (env-plan network checklist). Needed for Copilot BYO MCP and Gemini.

Any of these is a security-team decision. Raise it with Raj's team at the same time as the tool question, not afterward.

### 4.4 Identity

- **Remote (P3):** OAuth through the firm IdP. The server maps the IdP subject to a team member and enforces the share scope on every call.
- **Local (P2):** the stdio server signs the user in to the store with the IdP (device-code or browser OAuth) and keeps the token in the OS keychain **[unverified; depends on the IdP]**. Never pass a shared API key around the team.

---

## 5. Memory store

### 5.1 Records (conceptual; no engine picked)

| Record | Key fields | Notes |
|---|---|---|
| **memory** | `id`, `team_id`, `share_scope`, `status` (pending / approved / sent_back / rejected / expired / deleted), `live_version_id`, `review_by` (default 90 days, pm Q7), `retention_class`, `expires_at`, `legal_hold` | The approved version stays live while an edit is in review (pm Q8, qa C2.5) |
| **memory_version** | `id`, `memory_id`, `statement`, `tags`, `author`, `created_at`, `reviewer`, `reviewed_at`, `reviewer_note`, `source`, `redactions` | The reviewer note lives here and is deleted with the version (devops 12:07:56; possible FINRA 3110 exception in §8 Q6). Author ≠ reviewer is enforced here (pm Q5, qa C2.6) |
| **source** (embedded in the version) | `tool`, `client`, `captured_by`, `captured_at`, `chat_time`, `url?`, `locator?` | Locator per tool: Claude `claude_chat_…` ID or `href`; ChatGPT `conversation_id`; Copilot `sessionId` + `requestId`; Gemini `ConversationId` |
| **audit_event** | `memory_id`, `action`, `actor`, `at`, `reason_code` | A separate, append-only store (devops L4). No content, no hash (pm Q11). Serves as the SEC 17a-4 audit-trail alternative (env-plan §6) |
| **tombstone** | `memory_id`, timestamps, `actor`, `reason_code` | Left after deletion. All versions' content is purged. Legal hold blocks deletion (qa C3) |

### 5.2 Source links

There are three levels of strength:

1. **URL** pasted by the user. Claude's is stable; ChatGPT's is probable.
2. **Locator**: tool + user + time window. The firm's archive can resolve it even when no URL exists.
3. **Verified**: a later export job (P5, compliance-run) matches the locator to the real chat and records its ID.

**pm 12:14:28 (provisional): use both 1 and 2.** A locator is recorded automatically on every memory, plus a URL wherever the tool has a stable one. A missing URL never blocks a save (ux Flow 1). Whether a locator alone satisfies compliance is compliance question #10 in `docs/pm/open-questions.md`.

### 5.3 Search

- **v1 lean: full-text search in the primary DB.** At this scale it's enough, and it adds no model data flow.
- **Embeddings are optional** and can be added later from the same records. The embedding model is a data flow to place in env-plan §1: the firm's gateway models, a local model on the host, or a vendor API that needs approval. The index is derived data and is never backed up (devops D2).
- **Engine options, no pick:** SQLite on one host is simplest and enough for one team. Postgres is likelier to be firm-standard and has better backup tooling, with pgvector available if embeddings come in. Prefer whatever the firm already runs and backs up.

### 5.4 Redaction and block list

- **v1 lean: rules, not a model.** Run patterns for account numbers, SSNs, card numbers, emails and phone numbers, plus compliance's configurable block list (pm Q3), when a memory is proposed, *before* it's stored. On a hit, either redact and show the user what changed, or refuse with a reason. That choice belongs to ux and compliance.
- **Model-based detection** (e.g. for MNPI) is a model data flow; it gets the same placement question as embeddings.

### 5.5 Crypto-shredding (only if backups outlive the deletion window)

devops env-plan §6.1: if the firm's managed DB keeps backups for 30–90+ days, a deleted memory survives in backups well past qa C4.4's 15 days. The standard fix:

- **Per-memory data key.** Each memory's version content (statement, tags, reviewer note, URL) is encrypted with its own key. Those keys are wrapped by a master key in the firm's KMS. IDs, status, timestamps and the audit log stay in plaintext, since they hold no content.
- **Delete = destroy the key.** Old backups still hold the ciphertext, but nothing can decrypt it. Deletion is effective immediately, whatever the backup retention.
- **The key store's backup window becomes the real window.** It must be short (or the keys never backed up). Legal hold blocks key destruction.
- **Costs:**
  - a KMS dependency, which needs IT approval;
  - about 2–3 extra dev days **[unverified]**;
  - full-text search must run over decrypted content. That works because the index is derived data, never backed up, and rebuilt from the store (devops D2). The index must also drop a memory the moment its key goes.
- **Lean:** don't build it if IT can set DB backup retention to 14 days. Build it if they can't, or if compliance requires immediate deletion (devops 12:16:40 e).

---

## 6. Eval trace E1 (answers qa 12:03:33)

The MCP server can write one row per `search_memory` call:

- `eval_run_id`
- timestamp
- calling user
- client/tool
- the **query string the AI sent**
- returned memory IDs, each with status, age and rank

It's off by default, and turning it on writes an audit event (devops E1). Two limits for qa:

- The server sees the AI's rewritten query, not the user's question, so match rows to questions by user and time window.
- "Did the AI cite it" isn't visible to the server. Score it from the transcript, using ux's trailing-parenthetical citation format.

---

## 7. Smallest build for an Oct 30 freeze (sizing only; the user decides)

The eval's with-memory arm needs memories made from real source chats dated before the freeze (pm 12:04:38). The smallest build that could collect them:

| Piece | Effort **[unverified]** | Depends on |
|---|---|---|
| Store + audit log + tombstones (§5.1) | 1–2 days | Engine choice (devops) |
| Console: paste form, review queue, list/search, context-pack copy (P1) | 2–3 days | Firm IdP login, or a demo login for a dry run |
| Rule-based redaction + block list | 1 day | Compliance's block list (a placeholder works for the dry run) |
| Local MCP server with the four tools (P2) | 2–3 days | Raj's client answer |
| Hosting on the firm network (option B) | — | **Not ours to build.** Firm IT, schedule unknown |

That's roughly 1–1.5 weeks of dev work for P1 + P2. Even if building started Monday, Oct 26, the team would have under a week to save real memories before the freeze. pm has already flagged this. The hosting approval is outside our control and probably decides the date.

---

## 8. Open questions

These are folded into pm's consolidated list, `docs/pm/open-questions.md`, which is the live copy; new items go to @pm. The table below is kept for context.

| # | Question | For | Why it matters |
|---|---|---|---|
| Q1 | Which AI clients does Raj's team use: web apps, desktop apps, IDE assistants? | Raj, via user | Decides P2 vs P3, the biggest schedule swing |
| Q2 | Does the firm already archive AI chats (Smarsh, Global Relay, Theta Lake, Purview)? Through which vendor? | Raj / compliance | Phase-2 capture should read that archive, not add new org-wide keys |
| Q3 | Is the firm's IdP Okta? | Raj / IT | Enterprise-Managed Authorization works only with Okta today |
| Q4 | Does a locator (tool + user + time) satisfy "link to the source chat", or must it be a URL? | pm, compliance | Copilot and Gemini have no deep links (qa C1) |
| Q5 | When a source chat is deleted, should the memory be deleted, flagged, or left alone? | compliance | Decides whether we need an export at all in v1 |
| Q6 | Is the reviewer's note a supervisory record under FINRA 3110 that must outlive the memory? | compliance | If yes, notes move to a retained review record, not the audit log (dev 12:09:18) |
| Q7 | Which model endpoint, if any, may we use for embeddings or redaction? | Raj / platform team | Decides full-text-only vs embeddings, and rules vs a model for redaction |

---

## Sources

**Anthropic:**
- [compliance-api](https://platform.claude.com/docs/en/manage-claude/compliance-api)
- [access](https://platform.claude.com/docs/en/manage-claude/compliance-api-access)
- [content data](https://platform.claude.com/docs/en/manage-claude/compliance-content-data)
- [activity feed](https://platform.claude.com/docs/en/manage-claude/compliance-activity-feed)
- [sessions](https://platform.claude.com/docs/en/manage-claude/compliance-sessions)
- [integration patterns](https://platform.claude.com/docs/en/manage-claude/compliance-integration-patterns)
- [inference hooks](https://platform.claude.com/docs/en/manage-claude/inference-hooks)
- [integrations](https://support.claude.com/en/articles/15167101-get-started-with-claude-compliance-api-integrations)
- [access the Compliance API](https://support.claude.com/en/articles/13015708-access-the-compliance-api)

**OpenAI:**
- [compliance platform](https://help.openai.com/en/articles/9261474-openai-compliance-platform-for-enterprise-and-edu-customers) (excerpt only)
- [admin keys](https://help.openai.com/en/articles/20001407-managing-admin-keys-in-admin-console) (excerpt only)
- [Logs Platform cookbook](https://developers.openai.com/cookbook/examples/chatgpt/compliance_api/logs_platform)
- [enterprise compliance API](https://learn.chatgpt.com/docs/enterprise/compliance-api)
- [apps and connectors](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors)
- [MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [tunnel client](https://github.com/openai/tunnel-client)
- [desktop MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Purview: archive ChatGPT](https://learn.microsoft.com/en-us/purview/archive-chatgpt-interactions)
- Secondary: [Cribl](https://docs.cribl.io/stream/sources-openai-compliance/), [Elastic](https://www.elastic.co/docs/reference/integrations/openai_chatgpt_enterprise), [Reveal](https://docs.revealdata.com/onna/docs/chatgpt-how-to-connect-and-collect)

**Microsoft:**
- [getAllEnterpriseInteractions](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/interaction-export/aiinteractionhistory-getallenterpriseinteractions)
- [aiInteraction](https://learn.microsoft.com/en-us/graph/api/resources/aiinteraction)
- [change notifications](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/change-notifications/aiinteraction-changenotifications)
- [permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
- [Copilot retention](https://learn.microsoft.com/en-us/purview/retention-policies-copilot)
- [Purview for AI](https://learn.microsoft.com/en-us/purview/ai-microsoft-purview)
- [Purview: ChatGPT Enterprise](https://learn.microsoft.com/en-us/purview/ai-chatgpt-enterprise)
- [Purview: Claude Enterprise](https://learn.microsoft.com/en-us/purview/ai-claude-enterprise)
- [eDiscovery API](https://learn.microsoft.com/en-us/purview/edisc-ref-api-guide)
- [billing](https://learn.microsoft.com/en-us/purview/purview-billing-models)
- [Copilot Studio transcripts](https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-transcripts-powerapps)
- [Copilot Studio MCP](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [BYO MCP](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-byo-mcp-server)

**Google:**
- [Vault Gemini in Workspace exports](https://workspaceupdates.googleblog.com/2026/10/google-vault-now-supports-filtered-exports-for-Gemini-in-Workspace.html)
- [Gemini app holds](https://workspaceupdates.googleblog.com/2026/06/google-vault-now-supports-retention-rules-and-litigation-holds-for-Gemini-app.html)
- [export contents](https://knowledge.workspace.google.com/vault/exports/vault-export-contents)
- [privileges](https://knowledge.workspace.google.com/admin/vault/set-up-vault-privileges)
- [CorpusType](https://developers.google.com/workspace/vault/reference/rest/v1/CorpusType)
- [limits](https://developers.google.com/workspace/vault/limits)
- [Gemini Enterprise custom MCP](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server)

**Gateways:**
- [LiteLLM](https://docs.litellm.ai/docs/proxy/logging)
- [Portkey](https://portkey.ai/docs/product/enterprise-offering/otel/complete-logs)
- [Kong](https://developer.konghq.com/ai-gateway/policies/kafka-log/)
- [Azure APIM LLM logs](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-llm-logs)
- [Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
- [Cloudflare](https://developers.cloudflare.com/ai-gateway/observability/logging/logpush/)

**MCP and clients:**
- [spec 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Enterprise-Managed Authorization](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/)
- [Claude remote MCP](https://claude.com/docs/connectors/custom/remote-mcp)
- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude MCP tunnels](https://claude.com/docs/connectors/mcp-tunnels/overview)
- [Claude Code managed MCP](https://code.claude.com/docs/en/managed-mcp)
- [GitHub allowlist](https://github.blog/changelog/2026-08-06-mcp-allowlists-in-enterprise-managed-settings/)
- [Cursor enterprise](https://cursor.com/docs/enterprise/model-and-integration-management)
