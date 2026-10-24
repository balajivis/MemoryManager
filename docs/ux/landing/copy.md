# Landing page: copy and visual direction

Owner: ux (copy and look) · Builder: dev · Reviewer: pm · Status: **DRAFT** · Date: 2026-10-24
Brief: pm's corrected brief on the blackboard, 2026-10-24 14:30:29. The page is for the **original product**, personal memory across AI tools, not the governed team version.

Dev: use this text exactly. If something doesn't fit the layout, ask @ux for a shorter line; don't rewrite it. Square brackets mark notes for the builder, not page text.

---

## Hard rules (checked again at review)

- No numbers about results: no stats, percentages, "x times", cost figures or accuracy claims. No specific counts about the reader either ("several apps", not "four apps").
- No testimonials, customer names or logos (including AI vendor logos). Tool names appear as **plain text only**.
- No wording that implies partnership with or endorsement by an AI vendor. Use "designed to work with", never "partners", "integrates with" (as a present fact) or "official".
- No security, privacy-certification or compliance claims: no "encrypted", "secure", "private by design", "SOC 2" or "GDPR-compliant".
- Never mention Fidelity or Raj.
- The waitlist form doesn't send anything, and the page must say so. It never shows a success message.
- Name: **MemoryManager**, a working name.

---

## Page metadata

- `<title>`: MemoryManager: one memory for every AI you use
- Meta description: Your context is scattered across ChatGPT, Claude, Gemini and more. MemoryManager keeps one memory you own, so every AI tool starts with your context.

## 1. Header

- Wordmark: **MemoryManager**
- Nav links: How it works · Your memory, your rules [hidden below 520px; the wordmark and button stay on one row]
- Button: **Join the waitlist** [scrolls to #waitlist]

## 2. Hero

- Eyebrow: Personal memory for people who use more than one AI
- **H1: One memory for every AI you use.**
- Subhead: Your best thinking is scattered across chats in ChatGPT, Claude, Gemini and the rest, and every new chat starts from zero. MemoryManager keeps one memory of you, outside any single AI. It mirrors how you think, so every tool starts with your context.
- Primary button: **Join the waitlist** [#waitlist]
- Secondary link: See how it works ↓ [#how]

### Hero visual: a memory card [see the visual direction below; built in HTML/CSS, not an image]

```
┌ Your memory ────────────────────────────── EXAMPLE ──┐
│ PREFERENCE                                           │
│ Likes answers short, with code first and no preamble.│
│ from ChatGPT · Sep 30                                │
│──────────────────────────────────────────────────────│
│ PROJECT                                              │
│ Rebuilding the pricing page. Launch target is        │
│ mid-November.                                        │
│ from Claude · Oct 18                                 │
│──────────────────────────────────────────────────────│
│ DECISION                                             │
│ Chose Postgres over MongoDB for the side project.    │
│ from Gemini · Oct 12                                 │
├──────────────────────────────────────────────────────┤
│ ↳ Used just now in a new chat in Cursor              │
└──────────────────────────────────────────────────────┘
```

The **EXAMPLE** tag is visible text (a small mono pill in `--muted`), not just an aria-label. The product isn't live, so the card must not read as a screenshot.

Why this visual: in one glance it shows the whole idea. The memory came from three different tools and gets used in a fourth, and every line says where it came from and when. No brains, no robots, no glowing networks.

## 3. The problem  [id="problem"]

- **H2: Your context is scattered.**
- Three short cards:
  1. **Split across tools.** Your best thinking lives in chats across several different apps, and none of them talk to each other.
  2. **Every new chat starts from zero.** The AI doesn't know your project, your preferences or what you decided last week.
  3. **You keep re-explaining.** The same background, pasted in again and again, before you can ask what you came to ask.
- Line under the cards: Built-in memory helps, but only inside the tool that has it. Switch apps and you're a stranger again.

## 4. How it works  [id="how"]

- **H2: How it works**
- Three numbered steps:
  1. **Bring it in.** Import the chat history you already have, or save something as you go. Just say "remember this."
  2. **Keep it in one place.** MemoryManager organizes what matters, like your projects, preferences, decisions and the facts about you, into one memory you own. You can read and edit all of it.
  3. **Use it everywhere.** The AI tools you use pull in the right context when they need it, through MCP where the tool supports it. Every chat starts where you left off.

## 5. What changes

- **H2: What changes when your AI remembers you**
- Three benefits:
  1. **Better context.** Answers fit your project, your stack and your style, because the AI already knows them.
  2. **More accurate answers.** Less guessing at what you meant, and fewer confident answers to the wrong question.
  3. **Less re-explaining.** Skip the preamble. Shorter prompts mean fewer tokens spent setting the scene.

[No numbers anywhere in this section, not even "up to".]

## 6. Trust  [id="trust"]

- **H2: Your memory, your rules.**
- Intro: It's a memory of you, so you're in charge of it.
- Four items:
  1. **You own it.** Your memory belongs to you, not to any AI vendor.
  2. **See everything.** Every memory shows what it says, where it came from and when. Nothing hidden.
  3. **Edit or delete anything.** Fix what's wrong. Remove what you don't want remembered, any time.
  4. **Export any time.** Take your whole memory with you whenever you want.

[Don't add words like secure, encrypted or private here. They're claims we can't back yet.]

## 7. Works with

- Small heading: **Designed to work with the AI tools you already use**
- Plain-text list, styled as quiet chips, never logos: ChatGPT · Claude · Gemini · Copilot · Cursor
- Fine print under it: Connects through MCP where the tool supports it. Product names are trademarks of their owners. MemoryManager isn't affiliated with or endorsed by them.

## 8. Waitlist  [id="waitlist"]

- **H2: Be among the first to try it.**
- Text: MemoryManager is in early development. Join the waitlist and we'll reach out when there's something to try.
- Form:
  - Label (visible): Email
  - Placeholder: you@example.com
  - Button: **Join the waitlist**
  - Caption, always visible under the form: Preview only: sign-up isn't connected yet, so this form doesn't send or store anything.
- On submit: prevent the default, send nothing, store nothing (no localStorage), and show this inline in a polite live region (`aria-live="polite"`): **Sign-up isn't live yet. Nothing was sent or saved.** Never show a "you're on the list" message.
- [HTML comment for later: `<!-- TODO: connect waitlist endpoint; remove the preview caption and notice -->`]

## 9. Footer

- MemoryManager (working name) · © 2026
- Product names mentioned are trademarks of their respective owners.

---

## Visual direction

**Feel:** calm, precise and personal, like a well-kept notebook, not "AI neon". The page should feel like a tool for someone who thinks carefully. Avoid purple-to-blue gradients, glowing brains, robots, particle networks, stock photos and emoji.

**Type** (Google Fonts for the private preview. Per @pm 14:39:12, self-hosting the OFL woff2 files under site/fonts/ is **required before any public launch**):
- Headlines: **Newsreader** (serif), weight 500–600, tight leading (1.1). H1 about 56px on desktop and 36px on mobile.
- Body and UI: **Inter**, 17–18px, line-height 1.6.
- Memory-card metadata and step numbers: **JetBrains Mono**, 12–13px.

**Color** (as CSS tokens on `:root`, with a dark theme via `prefers-color-scheme`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FAF8F4 (warm paper) | #141413 | Page background |
| `--surface` | #FFFFFF | #1D1C1A | Cards, memory card |
| `--ink` | #1C1B19 | #EDEAE4 | Body and headings |
| `--muted` | #6B675F | #A39E94 | Secondary text, metadata |
| `--line` | #E6E1D8 | #2E2C29 | Hairlines and borders |
| `--accent` | #1F5E5B (deep teal) | #6FC2BA | Buttons, links, the "Used just now" strip |
| `--accent-ink` | #FFFFFF | #0E1F1E | Text on accent |

Use one accent color only. Body text must meet WCAG AA contrast in both themes.

**Layout:**
- Content max width about 1080px, with a 16px side gutter on mobile. Generous vertical rhythm: 96–120px between sections on desktop, 64px on mobile.
- Hero: copy on the left (about 55%), memory card on the right (about 45%). On narrow screens they stack, with the copy first.
- The problem and benefit cards sit 3 across on desktop and stack on mobile. Cards: `--surface` with a 1px `--line` border, 12px radius and no heavy shadows (at most `0 1px 2px` at low opacity).
- Steps: a large mono number (01, 02, 03) in `--accent` above each step title.
- Works-with chips: `--muted` text, `--line` border, pill shape, no icons.
- Waitlist: a centered band with a slightly different background (mix `--bg` with a hint of accent, or `--surface`), and the form inline on desktop, stacked on mobile.

**Memory card details:**
- Each entry has: a type label (mono, uppercase, letter-spaced, `--muted`), the statement (Inter, `--ink`), and a meta line ("from Claude · Oct 18", mono, `--muted`).
- Hairline dividers between entries.
- The bottom strip ("↳ Used just now in a new chat in Cursor") uses `--accent` text on a tinted `--accent` background at about 8% opacity.
- Optional: tilt it -1° on desktop, never on mobile. No other decoration.

**Interaction and accessibility:**
- Real `<label>` on the email field. Visible focus rings (2px `--accent` outline with offset). Semantic `h1` → `h2` → `h3` order.
- Smooth scrolling for anchors only when `prefers-reduced-motion` is not set. No other animation is needed.
- No external scripts. Fonts are the only external request.

**Done looks like:** someone who has re-explained their project to a third chatbot this week reads the H1 and the card, and thinks "yes, that". Nothing on the page makes a claim we can't back.
