# Vibe Check — Claude Code Guide

## What This Project Is

Vibe Check is an AI-powered product idea validator. Users enter a startup or product idea and receive a comprehensive market analysis in under 60 seconds, streamed live to the page. The output covers: opportunity grade (A+ through F), bottom line verdict, market landscape, competitors (established + early-stage), target audience, community sentiment, strategic differentiation, technical complexity, deployment options, and a ready-to-use Claude Code prompt.

Live on Railway at vibecheck.michaelrad.me. The working directory for all active development is:
`/Users/michaelradparvar/Documents/claude/code/vibe-check/`

---

## File Structure

```
vibe-check/
├── public/
│   ├── index.html        # Entire frontend — landing + results in one SPA
│   ├── feed.html         # Public feed page showing recent analyses
│   ├── og-image.png      # Static OG image for homepage sharing (Oswald Bold VC on dark)
│   └── favicon.svg       # VC monogram favicon (cyan on dark)
├── server.js             # Express backend, Perplexity + Exa API calls, SSE streaming
├── package.json          # Node/Express, ES modules ("type": "module")
├── drafts/               # Scratch files, ignored by git
├── .env                  # API keys (never commit this)
├── .gitignore
└── CLAUDE.md             # This file
```

---

## Tools & Services

- **Perplexity API** (`sonar-pro` model) — AI market analysis, 6-7 calls per analysis
- **Exa API** — neural/semantic search for community data enrichment (Reddit, app stores, GitHub, Product Hunt, social media, review sites)
- **Supabase** — persistent result storage (PostgreSQL)
- **Railway** — hosting, auto-deploys from `main` branch
- **Google Fonts** — Oswald + Inter
- **V0 by Vercel** — initial design inspiration/prototyping
- **Node.js / Express** — backend runtime
- **Server-Sent Events (SSE)** — real-time streaming

---

## Tech Stack

- **Runtime:** Node.js 18+ with ES modules (`import`/`export`, no `require`)
- **Backend:** Express 4
- **AI:** Perplexity API (`sonar-pro` model) — 6-7 API calls per analysis, parallelized in 3 batches
- **Search enrichment:** Exa API — neural/semantic pre-search for Reddit, social media, app stores, review sites, GitHub, Product Hunt; results fed into Perplexity sentiment + early-stage prompts
- **Streaming:** Server-Sent Events (SSE) via `/api/analyze` POST endpoint
- **Frontend:** Vanilla JS, no framework, no build step
- **Fonts:** Oswald (display/headers) + Inter (body) via Google Fonts
- **Hosting:** Railway (watches `main` branch, auto-deploys on push)
- **Result sharing:** Supabase for persistent storage, with in-memory `Map` fallback

---

## How the App Works

### Single-Page Architecture
One `index.html` with two sections:
- `#landing` — centered form with auto-growing textarea, "Analyze Before You Build." headline, "Vibe Check" brand centered above
- `#results` — full dashboard, hidden until analysis starts

JS toggles between them. No routing library. Clicking the VC logo from results pre-fills the textarea with the full idea text for easy iteration.

### Analysis Flow (server.js)
On POST `/api/analyze`, the server runs 3 parallel batches and streams each result as an SSE event. Parallelization cuts analysis time by ~50-60%:

**Batch 1 (parallel):**
1. `market` → competitors (with app store ratings), saturation score, market summary, differentiators, market_concentration, top_player
2. `technical` → difficulty, time estimates, tech stack, required APIs
3. `opportunity` → letter grade (A+ through F), grade_explanation, bottom_line, recommended_play, trend, target audiences, monetization, improvement suggestions, market_size_current/projected, short_title (3-5 word summary)
4. `deployment` → platform recommendation, deployment options (optional — prompt renders without it)

**Batch 2 (sequential, depends on Batch 1):**
5. Exa pre-search → parallel neural searches across Reddit, twitter.com/x.com, threads.net, bsky.app, Hacker News, app stores, G2/Trustpilot, GitHub, Product Hunt, per-competitor queries

**Batch 3 (parallel, depends on Batch 2):**
6. `early_stage` (conditional) → early-stage/open-source competitors from GitHub + Product Hunt (only if Exa found results)
7. `sentiment` → community insights (pain points, loved features, wish list) — synthesized from Exa results
8. `launch_intel` → launch strategy recommendations

**Final:**
9. `complete` → UUID for shareable link

Between steps, the server emits `status` events with granular progress messages. The progress bar only moves forward — never drops back on out-of-order parallel events.

### Frontend Rendering (index.html)
Each SSE event triggers a `render*` function:
- `renderScore(opp)` — visual scorecard: grade ring (animated from 0), grade context label, verdict text, bottom line, 4 stat tiles with animated visuals
- `renderMarket(d)` — populates saturation meter (animated) and competition donut (animated) within the score card, plus differentiator tags
- `renderCompetitors(d)` — grid of competitor tiles with linked names and app store ratings
- `renderEarlyStage(d)` — subsection inside competitors for GitHub/Product Hunt projects
- `renderAudience(opp)` — full-width 2-column layout: segments left, monetization right
- `renderStrategy(opp)` — numbered How to Win items (single column on mobile)
- `renderBuild(d)` — time estimate, tech stack badges, required APIs
- `renderDeploy(d)` — deployment options with recommendation pills
- `renderSentiment(d)` — 3-column community pulse (pain / love / wish)
- `renderLaunchIntel(d)` — launch strategy cards
- `renderPrompt(idea, opp, tech, deploy)` — assembled Claude Code prompt (renders when opp + tech are available; deploy is optional)

### Title & Sharing
- Perplexity returns a `short_title` field (3-5 word summary) with the opportunity response
- Results header shows short title by default; click to expand full idea text + copy permalink; click or scroll to collapse
- Browser tab updates to "Vibe Check — [Short Title]"
- Dynamic OG meta tags for shared links: title shows "Vibe Check for [Short Title]", description shows bottom_line
- OG image endpoint (`/api/og/:id`) generates an SVG with the grade ring
- Static `og-image.png` used for homepage sharing

### Loading UX
- Server sends granular `status` events during analysis
- Client-side micro-progress: fake +0.5% every 1.5s between real server events
- Progress bar is a 3px cyan bar at the bottom of the status bar
- Progress bar only moves forward — never drops back on out-of-order parallel events
- All overview visuals animate from zero: grade ring sweeps, bars grow, numbers count up, dots fill in sequentially

---

## Design System

### Colors
```css
--accent-cyan:     #00e5ff   /* Primary accent — CTAs, active states, highlights, ALL UI elements */
--accent-cyan-dim: rgba(0,229,255,0.12)
--bg-deep:         #050505   /* Page background */
--bg-surface:      #0f0f11   /* Sidebar */
--bg-card:         #141416   /* Cards */
--green:           #5eead4   /* Good/positive — soft teal (semantic only) */
--yellow:          #c4b5a0   /* Caution/medium — warm sand (semantic only) */
--text-main:       #e0e0e0
--text-muted:      #888888
--border:          #262626
```

### Design Principles
- **Cyan-dominant UI** — grades, stats, deploy pills, highlights, progress bars, and interactive elements all use cyan. Green/teal and yellow/sand are ONLY for semantic meaning (good/caution indicators)
- **No red anywhere in the UI.** Red has been replaced with yellow throughout
- **No emojis** — use minimal SVG line art for icons (e.g. shuffle icon, share link icon)
- **Maximum signal, minimum noise** — every UI element should earn its place. Remove redundancy
- **Section cards highlight with cyan border on hover**, not always-on
- **Copy confirmations** say just "Copied" (not "Prompt Copied" or "Link Copied")
- **No citation numbers** like [1] or [2] in any displayed text — strip them with `.replace(/\[\d+\]/g, '')`
- **Animations** — all overview visuals animate from zero on load (ease-out cubic). Feels alive, not static.
- **Empty state handling** — clicking "Start Analysis" with empty textarea shows a gentle semi-transparent modal toast centered inside the textarea with a small × close button, then a bouncing arrow pointing at the shuffle button. The modal should feel light and non-intrusive (not a browser alert).
- **Themed scrollbars** — cyan thumb on transparent/dark track, matching the changelog popover style. Used on textarea, changelog, and anywhere content scrolls.
- **High-design aesthetic** — approach every layout decision as a designer would. No unnecessary blank space, no cramped elements. Everything should feel intentional and polished.

### Typography
- **Display:** Oswald — used for grades, section numbers, competitor names, big stats
- **Body:** Inter — everything else
- **Base font size:** 15px, line-height 1.6

### Layout
- 12-column CSS grid for the dashboard
- Sidebar: collapses to 48px (shows "VC" monogram in cyan), expands to 200px on hover
- On mobile: horizontal scrollable nav bar, sticky at top. VC stays fixed (never scrolls off), nav items scroll independently. Full labels always visible, never truncated.
- Sticky results header with expandable title (short title by default, click to expand full idea + copy permalink, click/scroll to collapse)
- Share link icon as flex sibling of title, always visible

---

## Sidebar Nav Order (matches page section order)
1. Overview (visual scorecard: grade + bottom line + 4 stat tiles)
2. Competitors (established + early-stage subsection)
3. Community
4. How to Win
5. Build + Ship
6. Launch Intel
7. Build Your Prompt

---

## Key UI Components

### Visual Scorecard (Overview)
Top row: grade ring (left) + verdict text + differentiator tags (right)
Below verdict: "Bottom Line" section with 2-3 sentence direct verdict + recommended play
Bottom row: 4 stat tiles in a grid:
- **Market Size** — horizontal bars (current vs projected), dollar values count up from $0
- **Saturation** — horizontal meter bar + number counting from 0
- **Competition** — donut arc showing top player market share, percentage counts up
- **Build Time** — time estimate + difficulty dots that fill in sequentially
Click any tile to expand ALL tile insights at once (full text, no height clamp). Click again to collapse all.

### Grade Ring
- CSS `conic-gradient(from 0deg, ...)` — starts at 12 o'clock, fills clockwise
- Animates from 0 to target using `animateCSSVar()` with ease-out cubic
- Grade-to-percentage mapping: A+=100, A=95, A-=90, B+=85, B=78, etc.
- Grades support +/- (A+ through F), each with a distinct two-word label displayed below the ring

### Grade Labels
Each grade shows a unique context label (no letter prefix, no redundancy with the ring):
- A+: Exceptional opportunity | A: Strong opportunity | A-: Promising opportunity
- B+: Good potential | B: Solid potential | B-: Moderate potential
- C+: Worth exploring | C: Challenging market | C-: Uphill battle
- D+: Tough odds | D: Weak opportunity | D-: Poor outlook | F: Not recommended

### Title + Share Link
- Shows short title (3-5 words from Perplexity) by default
- Click to expand full idea text AND copy permalink (title flashes cyan + "Link copied" toast)
- Click again or scroll to collapse back to short title
- Share icon is a flex sibling (not inside title div) so it's always visible regardless of truncation

### Sample Ideas
- 100 unique ideas in a shuffled array (Fisher-Yates shuffle)
- No-repeat cycling — user never sees the same idea twice until all 100 are exhausted
- Shuffle icon (SVG line art) at bottom-right of textarea

### Textarea
- Auto-grows from 120px to 300px max as user types
- After 300px, scrolls with themed cyan scrollbar
- Placeholder: "Describe your idea here — the more detail, the better."
- Empty submission shows gentle modal toast, then bouncing arrow at shuffle button

### Landing Page
- "Vibe Check" brand centered above headline
- "Analyze Before You Build." headline
- No outer form box, lighter textarea
- Live counter below CTA button: "X ideas analyzed" with animated spin-up from 0
- Counter sits in a footer row alongside "Browse recent ideas →" link
- Both are subtle (low opacity, small font) — social proof without being loud

### Early-Stage Competitors
- Subsection inside Competitive Landscape (not a separate nav section)
- Appears only if GitHub/Product Hunt results were found by Exa
- Shows project name (linked), source badge (GitHub/PH), description, relevance, status (active/stale/new)

---

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `PERPLEXITY_KEY` | Yes | Perplexity API key (`pplx-...`) |
| `EXA_API_KEY` | No | Exa API key (enables richer community data) |
| `SUPABASE_URL` | No | Supabase project URL (enables persistent result storage) |
| `SUPABASE_SECRET_KEY` | No | Supabase service role key |
| `PORT` | No | Defaults to 3000 |

Set API keys in Railway dashboard under service → Variables. **Important:** After adding/changing env vars in Railway, you must redeploy (Railway doesn't pick up env var changes until restart).

---

## Local Dev
```bash
cd /Users/michaelradparvar/Documents/claude/code/vibe-check
npm install
npm run dev          # node --watch server.js
# Open http://localhost:3000
```

---

## Git & Deploy Workflow
- Work directly on `main`
- Production branch: `main` (Railway watches this)
- To deploy: `git push origin main`
- Railway auto-deploys within ~60–90 seconds of a push to `main`

### Version Convention
- **One version number per day maximum** — never create a new version on the same calendar day
- All changes pushed on the same calendar day are collapsed into a single version/changelog entry
- If no changes ship for multiple days, the next push gets the next version number (e.g. v1.12 → v1.13)
- **Always update release notes on every push** — bump the version badge and add/update the changelog entry in `index.html`
- The version badge and changelog popover in `index.html` must always stay in sync with CLAUDE.md
- Current version: **v1.14** (Mar 31, 2026)

---

## Data Quality Rules

### Competitor Matching
- Competitors must match the actual **use case AND target audience**, not just keywords
- Prompt includes explicit examples of what NOT to include
- App store ratings (`app_store_rating`) are requested and displayed when available
- For journaling/mental health/self-improvement ideas, prompt specifically checks Reflection, Day One, Journey, Stoic, Rosebud
- Prompt emphasizes searching iOS App Store and Google Play directly (many competitors are mobile-first)
- Market prompt instructs to search across G2, Capterra, AlternativeTo, Crunchbase, GitHub, Chrome Web Store, Google Play Store, Stackshare, App Store editorial lists

### Community Pulse (Sentiment)
- Exa pre-searches 9+ parallel queries: App Store/Play Store, Reddit, twitter.com/x.com/threads.net/bsky.app/Hacker News, G2/Trustpilot, GitHub, Product Hunt, per-competitor
- Exa `category: 'tweet'` is broken (returns 0 results) — replaced with `includeDomains` targeting social sites directly
- HONESTY RULES in prompt: accurate source labeling, no fabricated quotes
- COMPETITOR DIVERSITY: insights must cover multiple competitors, not just the market leader
- INSIGHT QUALITY: quotes must be specific and actionable, not generic
- SOURCE DIVERSITY: minimum 6 different sources, max 2 insights per source
- Post-processing filter removes quotes under 30 characters

### Grade Explanation
- `grade_explanation` field: 1-2 concise sentences explaining WHY the idea received its grade
- Must synthesize the single most important insight — key opportunity or challenge
- Always refers to subject as "idea" or "product", never "feature"

### Bottom Line
- `bottom_line` field: 2-3 sentences — the honest verdict. Proceed, pivot, or pass, and why.
- `recommended_play` field: one sentence connecting best audience with best monetization model
- Both are direct, specific, and reference concrete data from the analysis

---

## Error Handling
- SSE event errors are logged to console (`console.error`) instead of silently swallowed
- Each render call in the `opportunity` case is wrapped in individual try/catch so one failure doesn't block others
- `renderPrompt` renders as soon as idea + opp + tech are available (deployment is optional with fallback)
- `_tryRenderPrompt()` is called again on the `complete` event as a safety net
- `resetSkeletons()` resets `prompt-text` innerHTML (not `prompt-block`) to preserve the `<pre>` element
- Clipboard API has `execCommand('copy')` fallback for browsers that block `navigator.clipboard`
- Early-stage competitor step is conditional — only runs if Exa found GitHub/PH results (no wasted API call)

---

## API Endpoints
| Endpoint | Method | Description |
|---|---|---|
| `/api/analyze` | POST | Main analysis — streams SSE events |
| `/api/result/:id` | GET | Fetch a shared result by UUID |
| `/api/og/:id` | GET | Dynamic OG image (SVG with grade ring) for shared links |
| `/api/count` | GET | Total number of analyses (for landing page counter) |
| `/api/results` | GET | Paginated feed of recent analyses (NSFW filtered, deduplicated) |

---

## Known Tech Debt / Future Roadmap
- **Community Pulse toggle** — toggle between "By Sentiment" (current 3-column) and "By Competitor" (insights grouped per competitor)
- **User auth** — login so users can save/revisit their analyses
- **Follow-up questions** — ask clarifying questions about specific competitors or sections
