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
- **Waitlist (v2, real sign-up):** promise only what's built. A success message is allowed now, but no "check your inbox to confirm" (there's no confirmation email), no "early access guaranteed", and no dates. Errors must say plainly whether the person is on the list or not. **The real form goes live only when @pm's updated privacy policy goes live with it** (dev's gate, 15:25:25).
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

## 8. Waitlist  [id="waitlist"]  · v2, real sign-up (re @dev 15:25:25)

**Section text** (unchanged):
- **H2: Be among the first to try it.**
- Text: MemoryManager is in early development. Join the waitlist and we'll reach out when there's something to try.

**Form:**
- Label (visible): Email
- Placeholder: you@example.com
- Button: **Join the waitlist**
- **Privacy line**, always visible under the form, replacing the "Preview only" caption:
  We'll only email you when MemoryManager is ready to try, and we keep nothing but your email and sign-up date. To remove yours, write to {contact email}. [Privacy policy](/privacy.html)
  [Merges @pm's consent line (15:29:25) with what's stored and how to remove it. Retention ("until invited or {12 months}") stays in the policy, not under the field, while it's provisional.]
  [{contact email} is still open with the user via @pm. Show it as a visible placeholder until then, same as the legal pages.]
- Delete the old preview notice text and the TODO comment.

**States** (with JS). Messages go in the polite live region under the form. Errors are also tied to the field with `aria-describedby`, plus `aria-invalid="true"` while they show.

| State | What the person sees |
|---|---|
| Sending | The button reads **Joining…** and is disabled; `aria-busy="true"` on the form |
| Success, including duplicates (the server answers the same either way, on purpose) | The form is replaced by: **You're on the list.** We'll write to *{the email they typed}* when there's something to try. *Showing the address back lets people catch a typo. It's only shown in their own browser.* Then a small text button: **Use a different email** (brings the empty form back) |
| Empty field | Enter your email address to join. |
| Invalid email (checked in the browser or by the server) | That doesn't look like an email address. Check it and try again. |
| Rate-limited (429) | Too many tries from your connection. Wait a few minutes, then try again. |
| Server error or no network (5xx, timeout, offline) | Something went wrong, so you're **not** on the list yet. Please try again in a moment. |

Rules: keep what they typed after any error. Move focus to the field on an error, and to the success message on success. Never show success unless the server said so.

**Without JS:** the form POSTs to `/api/waitlist` with the email in the **body only**, never in a URL (devops 15:28:21 a). The server answers with a 303 redirect to a static page. **No email or token goes in the redirect URL.** The pages use the 404.html style, with `noindex`, root-absolute URLs, the same footer, and a "Back to MemoryManager" button:
- `/joined.html`: title "You're on the list · MemoryManager". H1 **You're on the list.** Text: We'll write to you when there's something to try. Then the same privacy line as above.
- `/join-error.html`: title "Sign-up didn't work · MemoryManager". H1 **That didn't work.** Text: You're not on the list yet. Check your email address and try again. Button: **Back to the sign-up form** → `/#waitlist`. (Rate limits and server errors land here too. One page keeps it simple; it doesn't need the detail the JS states have.)

**Honeypot field:** hide it visually and from assistive tech (`aria-hidden="true"`, `tabindex="-1"`, `autocomplete="off"`), with the label "Leave this field empty". If it's filled, the server responds as a normal success and stores nothing.

## 9. Footer

- MemoryManager (working name) · © 2026
- Product names mentioned are trademarks of their respective owners.

## 10. Social share tags and card  [approved by @pm 14:59:11]

Put these in `<head>` after the meta description. URLs are absolute and target the user's domain (devops 14:59:31). They resolve once DNS and HTTPS are live; until then link previews just show nothing. Meta tags don't make visitors' browsers send any requests, so "zero external requests" still holds.

```html
<link rel="canonical" href="https://memorymanager.getkapi.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MemoryManager">
<meta property="og:title" content="MemoryManager: one memory for every AI you use">
<meta property="og:description" content="Your context is scattered across ChatGPT, Claude, Gemini and more. MemoryManager keeps one memory you own, so every AI tool starts with your context.">
<meta property="og:url" content="https://memorymanager.getkapi.com/">
<meta property="og:image" content="https://memorymanager.getkapi.com/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="An example MemoryManager memory card: three memories saved from ChatGPT, Claude and Gemini, used in a new chat in Cursor.">
<meta name="twitter:card" content="summary_large_image">
```

- **Card image:** `docs/ux/landing/og-card.png` (1200×630, light theme, made by ux). Copy it to `site/og-card.png`. Source: `og-card.html` in the same folder; re-render it with headless Chrome at a 1200×630 window if the copy changes.
- **Card content:** the wordmark, the H1, the subline "Every chat starts with your context, not from zero.", and the memory card **with its EXAMPLE pill** (@pm's condition). No logos and no numbers. Tool names are plain text, as on the page.

## 11. Favicon

Inline SVG, so no request and no extra file. Add it to `<head>` on both `index.html` and `404.html`:

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231F5E5B'/%3E%3Ctext x='32' y='45' font-family='Georgia,serif' font-size='38' font-weight='700' text-anchor='middle' fill='%23FAF8F4'%3EM%3C/text%3E%3C/svg%3E">
```

A teal rounded square with a paper-colored serif "M", matching `--accent` and `--bg`. It's the same in both themes, since the square has its own background.

## 12. 404 page  [`site/404.html`]

- `<title>`: Page not found · MemoryManager
- Add `<meta name="robots" content="noindex">`.
- Header: the wordmark only, linking to `/`. No nav and no waitlist button.
- **H1: This page doesn't exist.**
- Text: The link may be old or mistyped.
- Button: **Back to MemoryManager** → `/`
- Footer: same as the main page.
- Look: the same tokens, fonts and dark mode as `index.html`. Copy the `:root` blocks, and center the content vertically in the viewport.
- **Builder note:** this page is served at any missing path (e.g. `/a/b/c`), so every URL in it must be **root-absolute**: `/fonts/fonts.css`, `/`. Relative `fonts/fonts.css` would break on nested paths.
- **@devops:** in nginx, `error_page 404 /404.html;` with `location = /404.html { internal; }`. The status must stay 404, not 200.

## 13. Legal pages and footer links  [re @pm 15:10:06; content owned by @pm in docs/pm/legal/]

### Footer (index.html, 404.html, privacy.html, terms.html)

Add the links to the first footer line. Don't create a new block:

```
MemoryManager (working name) · © 2026 · Privacy · Terms
Product names mentioned are trademarks of their respective owners.
```

- Links: `/privacy.html` and `/terms.html` (root-absolute). Color `--muted`, **always underlined**, so they aren't marked by color alone. `--ink` on hover.
- On its own page, the link gets `aria-current="page"` and no underline.
- On mobile it wraps naturally. Keep the separators on the same line as the link that follows them.

### Privacy and Terms pages

A plain, readable document, styled like the 404 page, with no cards and no decoration.

- **Header:** the wordmark linking to `/`, and on the right a quiet text link "← Back to MemoryManager". No nav and no waitlist button.
- **Column:** one centered reading column, `max-width: 68ch` (about 680px), with the 16px side gutter on mobile.
- **Title block:**
  - H1 in Newsreader, about 44px on desktop and 34px on mobile, e.g. **Privacy policy** / **Terms of use**.
  - A meta line under it in mono `--muted`: `Last updated {date}`.
  - **While it's a draft**, a note box under the meta line with an `--accent-tint` background, 8px radius and `--ink` text: **Draft:** this page hasn't been reviewed by a lawyer yet and isn't final. Remove it when @pm says the text is final.
- **Body:** Inter, 17px, line-height 1.7, `--ink`. Paragraph spacing 1em.
  - H2 in Newsreader, 26px, 56px above and 12px below. H3 in Inter, 600, 18px.
  - Lists use normal bullets and 0.4em between items. Links are `--accent` and underlined.
- **Placeholders** like `{operator legal name}`: keep them visible, styled as `<mark>` with an `--accent-tint` background and mono font, so nobody can miss an unfilled one. QA can grep for `{` before publishing.
- No table of contents (the pages are short). No cookie banner, because there are no cookies, and a banner would suggest otherwise.
- `<title>`: Privacy policy · MemoryManager / Terms of use · MemoryManager. Same favicon links, tokens, fonts and dark mode as index.html.

### Favicon files (fixes @qa's 15:12:23 nit)

Some clients ignore data-URI icons (Google Search, older Safari, iOS home screen). The real files are made from the §11 SVG and live in `docs/ux/landing/`:

- `favicon.ico` (48×48) → copy to `site/favicon.ico`. Browsers request it automatically, so no tag is needed.
- `apple-touch-icon.png` (180×180, full-bleed square because iOS rounds the corners) → copy to `site/apple-touch-icon.png` and add `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` to every page.
- Keep the inline SVG icon from §11 as well. Modern browsers prefer it.

## 14. First waitlist email  [requirement for when an email sender exists; @pm 15:39:10]

There's no confirmation email (no double opt-in in v1), so anyone could sign up someone else's address. The first email we ever send to the list must open with:

> If you didn't sign up for the MemoryManager waitlist, ignore this email and we'll delete your address. [Remove me]

- **Remove me** is one click with no login, and it deletes the address (pm's policy: every email includes a way to leave).
- Then the actual news. Same voice as the page: plain, no hype, and no numbers we can't back.
- ux drafts the full email when a sender is chosen.

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
