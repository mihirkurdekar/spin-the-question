# Spin the Question — Product Spec (v1, production-ready)
> A solo-phone first date game. One phone, passed back and forth, AI-generated questions.

> This file is the authoritative spec for v1. The original v0 spec is in
> `~/Downloads/spin-the-question-spec.md` for reference — the v0 changes from
> this spec are listed in [§ Changelog](#changelog-v0--v1).

---

## Overview

A lightweight mobile-first web app deployed on AWS Lambda. No accounts, no installs — players open a URL, enter two names, and start playing. The app calls the Google Gemini API (free tier) to generate fresh, contextually appropriate questions based on category, how far into the game the players are, and the players' "keep it light" preference.

---

## Architecture

```
Browser (mobile-first HTML/CSS/JS, PWA-installable)
        │  HMAC-signed requests only
        ▼
AWS Lambda (Node.js 22.x)
  ├── GET   /         → serves index.html (embeds session token)
  ├── POST  /question → validates token → calls Gemini → returns {question, tip}
  ├── POST  /vibe     → validates token → calls Gemini → returns {vibe}
  └── Lambda Function URL (HTTPS)
        │
        ▼
Google Gemini API (gemini-2.5-flash, responseMimeType: application/json)
```

### Infrastructure
- **Runtime:** Node.js 22.x on AWS Lambda, 256MB memory, 10s timeout
- **Trigger:** Lambda Function URL (HTTPS, no API Gateway required)
- **Environment variables** stored in Lambda:
  - `GEMINI_API_KEY` — from Google AI Studio (free, no card)
  - `HMAC_SECRET` — random 32-byte hex string for request signing
- **Bundle:** Single zip — `index.js`, `question.js`, `rateLimit.js`, `fallbacks.js`, `wildcards.js`, `public/`
- **No database** — all game state lives in the browser (sessionStorage)
- **PWA** — `manifest.json` + `sw.js` for home-screen install and offline shell

---

## Security: API Protection

The `/question` and `/vibe` endpoints must only be callable from the app itself, not from curl, Postman, or any third party.

### Approach: HMAC Request Signing + Origin + Rate Limit

**How it works:**
1. When the browser loads `index.html`, Lambda embeds a **session token** (HMAC-signed timestamp) directly into the HTML at render time
2. Every `/question` and `/vibe` request must include this token in the `X-Session-Token` header
3. Lambda validates the token server-side before calling Gemini
4. Tokens expire after **2 hours** (enough for a date, not reusable)

**Token generation (server, at page load):**
```js
const crypto = require('crypto');
const timestamp = Date.now();
const token = crypto
  .createHmac('sha256', process.env.HMAC_SECRET)
  .update(`${timestamp}`)
  .digest('hex');
const sessionToken = `${timestamp}.${token}`;
// Embed in index.html as: window.__SESSION = "...";
```

**Token validation (server, on every /question and /vibe call):**
```js
function validateToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Both halves must be non-empty; sig must be 64 hex chars (sha256)
  if (!/^\d+$/.test(ts) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const age = Date.now() - parseInt(ts, 10);
  if (age > 2 * 60 * 60 * 1000 || age < 0) return false; // expired or clock-skew
  const expected = crypto
    .createHmac('sha256', process.env.HMAC_SECRET)
    .update(ts)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> ⚠️ `crypto.timingSafeEqual` throws if the buffers differ in length. The v0 spec omitted the length check, so any malformed token (no `.`, non-hex chars, etc.) would crash the handler. The validator above regex-checks both halves first and returns `false` for anything malformed.

**Additional hardening:**
- `Origin` header check — reject requests not from the Lambda Function URL's own domain
- Rate limiting per IP — max 30 requests/minute using an in-memory counter (resets on Lambda cold start, sufficient for abuse prevention)
- Request body size limit — reject payloads over 1KB
- All errors return generic `403 Forbidden` (no hints about why), except rate limit (429) and oversized body (413)

### Threat model — what's actually protected

| Layer | Stops | Doesn't stop |
|---|---|---|
| HMAC session token | Cross-session token reuse from a stolen log; basic `curl` callers who don't load `index.html` first | An attacker who loads `index.html` once and reuses the embedded token for the next 2h from any IP, including via a script |
| Origin check | Most non-browser HTTP clients (browsers send `Origin`; `curl` doesn't always) | A client that sets `Origin` to match the Function URL, or omits it entirely (browsers also omit Origin on same-origin GETs) |
| Per-IP rate limit (in-memory) | Accidental spam and light scripted abuse | Bulk distributed abuse (different IPs); state is wiped on every cold start |

**Bottom line:** the three layers raise the cost of casual abuse but do not constitute a hard wall. For v1 this is acceptable (Gemini free tier caps the damage, and the target user is two people on a date, not an attacker farm). If abuse becomes a real problem, the recommended next step is **putting Cloudflare in front of the Lambda Function URL** — Cloudflare's edge rate limiting and bot detection sit *before* the token check, which is where they belong. A server-side session store (DynamoDB or ElastiCache) tied to the token's timestamp would close the "load index.html once" gap but is out of scope for v1.

---

## Screens & Flow

### 1. Home screen
- App name: **Spin the Question**
- Tagline: *"A game for two people getting to know each other"*
- Two name inputs: "Your name" and "Their name" (blank → defaults to "You" / "Them")
- **Keep it light** checkbox, checked by default
- A single **Let's play →** button
- No login, no email, no tracking

### 2. Spin screen
- Shows whose turn it is: **"[Name]'s spin"** (truncated to 12 chars)
- A visually satisfying spin wheel with 6 category segments
- Large **Spin** button
- Wheel animates with ease-out curve, ~3s spin, lands on a category
- After landing → transitions to Question screen
- In the background after landing, prefetch the next predicted-category question (see [§ Prefetch behaviour](#prefetch-behaviour))

### 3. Question screen
- Category badge (coloured, matches wheel segment)
- AI-generated question (fetched from `/question` endpoint, served from prefetch cache when available)
- A small conversation tip beneath the question (also AI-generated)
- Loading state while AI generates (spinner + "Getting your question...")
- Two buttons:
  - **Done talking** — moves to Handoff screen, increments `noSkipStreak`
  - **Skip** — uses a veto token, moves to Handoff screen (no new question), resets `noSkipStreak`
- Veto tokens displayed: 2 per player, shown as dots (filled = used)

### 4. Handoff screen
- Full-screen interstitial
- Text: **"Pass to [next player's name] 👋"**
- Blurred/covered so next question isn't visible yet
- Single **Ready →** button to proceed to next Spin screen

### 5. End screen
- Triggered after 20 questions answered (or a manual "End game" button in the ≡ menu)
- Shows:
  - Total questions answered
  - Top 3 categories (small bar visualisation)
  - Skips used by each player
  - A generated "vibe summary" (one `POST /vibe` call: *"Based on your game, you two seem like..."*)
- **Share** button — uses `navigator.share()` if available, else copies a text summary to clipboard
- **Play again** button (resets everything, keeps names and `keepItLight`)

### 6. `≡` menu
- Top-right of every screen **except handoff**
- Opens a small bottom sheet with:
  - **End game** → jumps to end screen
  - **How to play** → one-paragraph explainer modal

---

## Categories (Wheel Segments)

| Segment | Colour | Vibe |
|---|---|---|
| 🌶️ Spicy | Coral `#D85A30` | Mild controversy, opinions |
| 🌊 Deep End | Blue `#185FA5` | Values, fears, philosophy |
| 🤣 Chaos | Amber `#BA7517` | Hypotheticals, would-you-rathers |
| 📖 Story Time | Green `#3B6D11` | Real memories, real moments |
| 🔮 Future | Purple `#534AB7` | Dreams, goals, dealbreakers |
| ⚡ Fast Fire | Pink `#993556` | Quick-fire, no elaborating allowed |
| 🃏 Your call (wildcard) | White `#E0E0E0` | Spinner asks the other person anything they want (no AI) |

### Progressive depth weighting
Early game favours Chaos and Fast Fire; late game favours Deep End and Future. The weighted random runs at the moment of spin, not visible to players.

| Phase | q/total | Chaos | Fast Fire | Spicy | Story Time | Future | Deep End |
|---|---|---|---|---|---|---|---|
| Opening | 1–5 | 1.5 | 1.5 | 1.0 | 1.0 | 0.5 | 0.5 |
| Middle | 6–14 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Closing | 15–20 | 0.5 | 0.5 | 1.0 | 1.0 | 1.5 | 1.5 |

Weights are relative within each phase. Implementation: `pickWeighted(category, questionNumber, totalQuestions) → category`.

### Wildcard mechanic
- `noSkipStreak` counter increments on **Done talking**, resets to 0 on **Skip**.
- When `noSkipStreak` reaches 5, after the next successful question is answered, show a 2s banner: **"Wildcard unlocked 🃏"**.
- For the **next** spin only, the wheel has 7 segments: the 6 normal ones at weight 5/30 each, plus **"Your call"** at weight 1/30.
- The wildcard question is generated **client-side** from `wildcards.js` (20 hand-written prompts in `public/wildcards.js`) — no Gemini call.
- After the wildcard spin, weights revert to the normal 6-segment layout. `noSkipStreak` resets to 0 (the streak is consumed).

---

## API Endpoints

### `POST /question`

**Request headers**
```
Content-Type: application/json
X-Session-Token: {timestamp}.{hmac_signature}
Origin: https://{your-lambda-url}.lambda-url.{region}.on.aws
```

**Request body**
```json
{
  "category": "Deep End",
  "questionNumber": 7,
  "totalQuestions": 20,
  "playerNames": ["Priya", "Arjun"],
  "keepItLight": true
}
```

**Gemini prompt**
```
You are generating questions for a first-date conversation game called "Spin the Question".
The two players are {playerNames[0]} and {playerNames[1]}.
This is question {questionNumber} of {totalQuestions} — calibrate depth accordingly (earlier = lighter, later = deeper).
Category: {category}
{[keepItLight clause when keepItLight is true]}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "question": "the question text (max 20 words, direct, no fluff)",
  "tip": "a one-line conversation nudge for after they answer (max 12 words)"
}

Category guidance:
- Spicy: mild controversy, hot takes, opinions — fun but not offensive
- Deep End: values, fears, what matters to them — thoughtful not heavy
- Chaos: weird hypotheticals, absurd would-you-rathers — keep it playful
- Story Time: prompt a real specific memory — "tell me about a time when..."
- Future: dreams, goals, dealbreakers — skip the LinkedIn version
- Fast Fire: rapid-fire format, multiple quick items, 30 seconds to answer
```

**Keep-it-light clause** (appended to the prompt when `keepItLight: true`):
> Avoid questions about past relationships, family conflict, mental health, finances, or anything that could read as a personal attack. Keep it playful.

**Gemini API call**
```js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',  // force JSON; no fence-stripping in 99% of cases
    maxOutputTokens: 200,                  // cap cost; question+tip is <120 words
    temperature: 0.9,                      // variety, not determinism
  },
});
const result = await model.generateContent(prompt);
const text = result.response.text();
```

**Robust JSON parsing** — wrapped in a single `try/catch`:
1. `JSON.parse(text)` directly.
2. On failure, strip leading/trailing whitespace and ```json``` fences, retry `JSON.parse`.
3. On second failure → use `fallbacks.get(category)`.

This is wrapped in `try/catch` and the entire Gemini call is in a `try/catch` so any error (timeout, 429, network) returns a fallback rather than 500ing the user.

**Response body**
```json
{ "question": "...", "tip": "..." }
```

**Error handling**
- Token invalid / expired → `403 Forbidden` (no detail)
- Rate limit hit → `429 Too Many Requests`
- Origin mismatch → `403 Forbidden` (no detail)
- Body over 1KB → `413 Payload Too Large`
- Gemini API fails (any reason) → return hardcoded fallback for the category
- Fallback questions: 3 per category in `fallbacks.js`
- **Never show a blank question screen**

---

### `POST /vibe`

Called once at the end screen to generate the "vibe summary." Same protections as `/question` (token, Origin, rate limit, body cap, robust parsing).

**Request body**
```json
{
  "answeredCount": 18,
  "categoryCounts": { "Spicy": 5, "Deep End": 6, "Chaos": 4, "Future": 3 },
  "skips": { "Priya": 1, "Arjun": 1 },
  "playerNames": ["Priya", "Arjun"]
}
```

**Gemini prompt**
```
You are writing a one-sentence "vibe summary" for two people who just played a first-date
conversation game. The players are {playerNames[0]} and {playerNames[1]}. They answered
{answeredCount} questions. Their top categories were {topCategories}.

Respond with ONLY a valid JSON object, no markdown, no explanation:
{ "vibe": "You two seem like the kind of people who would..." }

Max 30 words. Warm, specific, a little playful. Avoid clichés.
```

**Response body**
```json
{ "vibe": "You two seem like the kind of people who'd road-trip on a Tuesday." }
```

**Fallback** (when Gemini fails): deterministic template:
> `"{name1} & {name2} answered {N} questions — {topCategory} lovers with a soft spot for {secondCategory}."`

---

## Prefetch behaviour

- After `POST /question` returns successfully, the client fires a background `POST /question` for `questionNumber: N+1` with the *next-predicted* category (computed client-side using the same weighted random the wheel will use).
- Result is cached in `state.prefetch["<category>:<number>"]` (sessionStorage).
- The next time the player spins and lands on a category, the client checks `state.prefetch` first. **Hit** → display immediately (no spinner). **Miss** → show the spinner and fall back to a live call.
- Prefetch is best-guess; the cache is keyed per category, so even if the wheel lands on a different segment, the cached question for *that* segment is still in `state.prefetch` and will hit next time.
- Cap: at most 3 prefetched questions in sessionStorage (oldest is evicted on overflow). SessionStorage itself caps at ~5MB so this is not a real limit, but pruning keeps the object small.

---

## Logging Contract

Every request emits **one** structured JSON line via `console.log(JSON.stringify(...))` so CloudWatch logs are queryable.

**Page load (`GET /*`):**
```json
{ "type": "page_load", "requestId": "...", "ts": 1718000000000, "ip": "1.2.3.4", "ua": "Mozilla/...", "referer": "" }
```

**Question call (`POST /question`):**
```json
{
  "type": "question",
  "requestId": "...",
  "ts": 1718000000000,
  "ip": "1.2.3.4",
  "category": "Deep End",
  "questionNumber": 7,
  "latencyMs": 1820,
  "geminiMs": 1340,
  "cacheHit": false,
  "outcome": "ok"        // or "fallback" | "rate_limited" | "invalid_token" | "forbidden" | "error"
}
```

**Vibe call (`POST /vibe`):**
```json
{
  "type": "vibe",
  "requestId": "...",
  "ts": 1718000000000,
  "ip": "1.2.3.4",
  "latencyMs": 2100,
  "outcome": "ok" | "fallback" | "error"
}
```

**Error/403 responses** still log a line — the only thing omitted from the log is the response body, since bodies are intentionally generic.

---

## Cold-Start UX

A first request after deploy triggers a 2-3s Lambda cold start. The home screen should not sit silently during this:

- On `DOMContentLoaded`, fire a `GET /?warmup=1` (cheap, returns the same HTML as a normal load).
- If the warmup takes >1s, show a small pill above the **Let's play →** button: *"Warming up…"*
- Pill clears as soon as the warmup resolves (success or failure).
- The warmup is best-effort: if it 403s or times out, the button still works — the user's *next* click just absorbs the cold start.

---

## Content Security Policy

`index.html` includes a CSP meta tag in `<head>`:

```
default-src 'self';
font-src 'self' https://fonts.gstatic.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data:;
connect-src 'self';
```

`'unsafe-inline'` for styles is required because the spec uses inline `style="..."` for canvas sizing. We accept this in v1; the alternative is moving all inline styles to a separate CSS file (a worthwhile v1.1 cleanup).

---

## CORS

Browsers send an `OPTIONS` preflight before any cross-origin `POST`. Lambda Function URL returns 403 on `OPTIONS` by default, which would break the app. The handler must:

- Respond to `OPTIONS /*` with status `204` and these headers:
  - `Access-Control-Allow-Origin: <self-origin>` (the Function URL's own origin, *not* `*`)
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, X-Session-Token`
  - `Access-Control-Max-Age: 86400` (cache the preflight for 24h)
- Echo `Access-Control-Allow-Origin` on **every other response** *only if* the request's `Origin` header matches the Function URL origin. Otherwise omit the header entirely.
- Set `Vary: Origin` on every response so any future CDN doesn't cache the wrong value.
- Never use `Access-Control-Allow-Origin: *` — credentials are not in play here, but the habit matters, and it would weaken the Origin check.

---

## Lambda Handler Structure

```
project/
├── index.js           # Lambda handler — routing, token, CORS, OPTIONS, logging
├── question.js        # Gemini API call + robust JSON parser + /vibe logic
├── rateLimit.js       # In-memory per-IP rate limiter
├── fallbacks.js       # Hardcoded fallback questions per category
├── wildcards.js       # 20 client-side wildcard prompts (no Gemini)
├── public/
│   ├── index.html     # Entire frontend (single file, vanilla JS)
│   ├── manifest.json  # PWA manifest
│   ├── sw.js          # Service worker
│   ├── wildcards.js   # Client-side wildcard prompts (served as /wildcards.js)
│   ├── icon-192.png
│   └── icon-512.png
└── package.json       # Only dependency: @google/generative-ai
```

### `index.js` routing logic
```
OPTIONS /*      → return 204 with CORS headers for self-origin only
GET   /*        → inject session token into index.html, serve it
POST  /question → validate token → validate origin → check rate limit → call question.js
POST  /vibe     → validate token → validate origin → check rate limit → call question.vibeSummary(...)
```

Static assets under `public/` (manifest, sw, icons, wildcards.js) are served by `GET /*` via path lookup.

---

## Frontend Details

### Tech
- Vanilla HTML/CSS/JS — no framework, no build step
- Single `index.html` file served from Lambda
- All game state in `sessionStorage` (cleared when tab closes)
- Session token stored in `sessionStorage` (injected at page load, sent with every request)

### State shape (sessionStorage)
```json
{
  "players": ["Priya", "Arjun"],
  "currentPlayerIndex": 0,
  "questionNumber": 1,
  "vetoTokens": { "Priya": 2, "Arjun": 2 },
  "skips": { "Priya": 0, "Arjun": 0 },
  "categoryCounts": {},
  "answeredCount": 0,
  "noSkipStreak": 0,
  "keepItLight": true,
  "prefetch": { "Spicy:2": { "question": "...", "tip": "..." } },
  "sessionToken": "{timestamp}.{hmac}"
}
```

### Names
- If either name is blank on home, default to `"You"` and `"Them"`.
- Truncate to 12 characters for the wheel / handoff display; keep the full name in state for the end screen and vibe summary.

### PWA install
- `public/manifest.json` declares name `Spin the Question`, short_name `Spin`, theme_color `#0F0F0F`, background_color `#0F0F0F`, display `standalone`, two icons (192/512), `start_url: "/"`.
- `public/sw.js` precaches `/`, `/manifest.json`, the two icons, and the Google Fonts CSS. **Cache-first** for those. **Network-first** for `POST /question` and `POST /vibe`. Offline fallback returns a minimal HTML "no connection, but your cached questions still work" page; cached questions in the prefetch map continue to display even with no network.
- `beforeinstallprompt` is captured silently.
- iOS users install via Safari's share sheet → "Add to Home Screen."
- Android gets the browser's native prompt after ~2 sessions; no in-app install button in v1.

### Design direction
- Mobile-first, portrait orientation
- Dark background (`#0F0F0F`) with category colour as accent
- Display font: `DM Serif Display` (Google Fonts) — warm, editorial
- Body font: `DM Sans` — clean, readable at small sizes
- Wheel: `<canvas>` element, drawn with vanilla Canvas API
- Spin animation: `requestAnimationFrame` ease-out, ~3 seconds
- Category landing: screen accent colour shifts to match the landed segment
- No gradients, no shadows — flat and intentional
- Transition between screens: simple fade (150ms opacity)

### Accessibility
- Minimum tap target: 44px
- Colour contrast AA compliant on all text
- `prefers-reduced-motion` respected (instant transitions if set)
- The wheel `<canvas>` is `role="img" aria-live="polite" aria-label="Spin the question wheel"`. The **Spin** button is the actual focusable control; on click, an `aria-live="assertive"` region announces the landed category (e.g. "Deep End. Question incoming.") before the question loads.

---

## Deployment Steps (for Claude Code to generate a `deploy.sh`)

1. `npm ci --omit=dev` in project root
2. `zip -r function.zip index.js question.js rateLimit.js fallbacks.js wildcards.js public/ node_modules/`
3. Create Lambda function (Node.js 20.x, 256MB, 10s timeout) — or update code on existing function
4. Set env vars: `GEMINI_API_KEY`, `HMAC_SECRET` (generate with `openssl rand -hex 32`)
5. Enable Lambda Function URL (auth: NONE, CORS: restrict to own domain)
6. Upload zip
7. Output the Function URL

---

## Cost Estimate

| Component | Cost |
|---|---|
| Lambda (1,000 games/month, ~26 calls/game: 1 load + 20 questions + 5 prefetches + 1 vibe) | $0.00 (AWS free tier) |
| Gemini 2.5 Flash (free tier: 1,500 req/day) | $0.00 |
| At scale beyond free tier (~$0.0004 per game) | ~$0.40 per 1,000 games |

> ⚠️ Important: Keep your AI Studio project billing-disabled. Enabling billing on the same Google Cloud project removes the free tier entirely — use a separate project for production vs. testing.

---

## Out of Scope (v1)

- User accounts or saved history
- Multiplayer over network (same phone only)
- Custom question packs / unlockables
- Sound effects
- Analytics
- In-app PWA install button

---

## Changelog (v0 → v1)

This list is the diff from the original spec at `~/Downloads/spin-the-question-spec.md` to this file. Code in the project implements v1.

**Security**
- Fixed `validateToken`: regex-validates both halves and length-checks buffers before `timingSafeEqual`. v0 crashed on malformed tokens.
- Added an explicit threat model table — the v0 "What this prevents" list implied the layers were stronger than they are.

**Routing**
- Added `OPTIONS /*` → 204 with CORS headers (v0 had no CORS handling at all, which would have broken the app in browsers).
- Added `POST /vibe` endpoint for the end-screen summary (new feature promoted from a "generated vibe summary" hand-wave).
- Added `Vary: Origin` and a never-wildcard CORS policy.

**Gemini**
- Added `generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 200, temperature: 0.9 }`.
- Added a two-pass robust JSON parser (strip fences and retry; fall back on second failure).
- Wrapped the entire Gemini call in `try/catch` so any error returns a fallback (v0 said this in prose but the spec didn't show the try/catch).

**Frontend**
- Moved PWA from "Additional Suggestions" to core (manifest, service worker, icons).
- Added state fields: `noSkipStreak`, `keepItLight`, `prefetch`.
- Added name default behaviour (blank → "You" / "Them") and 12-char display truncation.
- Added the `≡` menu with "End game" and "How to play."
- Added the progressive-depth weighting table (was a suggestion, now spec'd).
- Specified the wildcard mechanic precisely: 5-streak trigger, one-shot 7th segment, client-side prompt list, weight reset.
- Specified the prefetch behaviour: post-question background call, per-category cache, miss fallback.
- Added the keep-it-light clause text and toggle default.
- Added ARIA for the wheel (canvas + live region).
- Added cold-start warmup pill on the home screen.
- Added CSP meta tag.

**Backend**
- Added structured logging contract (one line per request, JSON).
- Added 1KB body cap as a hard reject (413), not just a "limit."

**Other**
- Moved "Question caching" suggestion from "pre-generate 5 at start" to "prefetch next, on-demand" (user decision).
- Added `wildcards.js` to the project structure.
