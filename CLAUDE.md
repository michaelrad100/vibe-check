# Vibe Check — Claude Code Guide

## What This Project Is

Vibe Check is an AI-powered product idea validator. Users enter a startup or product idea and receive a comprehensive market analysis in under 60 seconds, streamed live to the page. The output covers: opportunity grade, market landscape, competitors, target audience, community sentiment, strategic differentiation, technical complexity, deployment options, and a ready-to-use Claude Code prompt.

Live on Railway. The working directory for all active development is:
`/Users/michaelradparvar/Documents/claude/code/vibe-check/`

---

## File Structure

```
vibe-check/
├── public/
│   └── index.html        # Entire frontend — landing + results in one SPA
├── server.js             # Express backend, Perplexity + Exa API calls, SSE streaming
├── package.json          # Node/Express, ES modules ("type": "module")
├── drafts/               # Scratch files, ignored by git
├── .env                  # API keys (never commit this)
├── .gitignore
└── CLAUDE.md             # This file
```

---

## Tech Stack

- **Runtime:** Node.js 18+ with ES modules (`import`/`export`, no `require`)
- **Backend:** Express 4
- **AI:** Perplexity API (`sonar-pro` model) — 6 sequential API calls per analysis
- **Search enrichment:** Exa API — neural/semantic pre-search for Reddit, Twitter/X, app stores, review sites; results fed into Perplexity sentiment prompt
- **Streaming:** Server-Sent Events (SSE) via `/api/analyze` POST endpoint
- **Frontend:** Vanilla JS, no framework, no build step
- **Fonts:** Oswald (display/headers) + Inter (body) via Google Fonts
- **Hosting:** Railway (watches `main` branch, auto-deploys on push)
- **Result sharing:** Supabase for persistent storage, with in-memory `Map` fallback

---

## How the App Works

### Single-Page Architecture
One `index.html` with two sections:
- `#landing` — centered form, shown by default
- `#results` — full dashboard, hidden until analysis starts

JS toggles between them. No routing library.

### Analysis Flow (server.js)
On POST `/api/analyze`, the server runs these steps and streams each result as an SSE event:

1. `market` → competitors (with app store ratings), saturation score, market summary, differentiators needed
2. `technical` → difficulty, time estimates, tech stack, required APIs
3. `opportunity` → letter grade (A–F), grade_explanation (3-5 sentences on WHY), trend, target audiences, monetization, improvement suggestions, market_size_current/projected
4. `deployment` → platform recommendation, deployment options
5. Exa pre-search → parallel neural searches across Reddit, Twitter/X, app stores, G2/Trustpilot, per-competitor queries
6. `sentiment` → community insights (pain points, loved features, wish list) — synthesized from Exa results
7. `complete` → UUID for shareable link

Between steps, the server emits `status` events with granular progress messages (13 total).

### Frontend Rendering (index.html)
Each SSE event triggers a `render*` function:
- `renderScore(opp)` — merged overview card: grade ring (center), grade explanation (left), market size visual + saturation meter (right)
- `renderMarket(d)` — populates saturation meter and differentiator tags within the score card
- `renderCompetitors(d)` — grid of competitor tiles with linked names and app store ratings
- `renderAudience(opp)` — target segments + monetization strategies
- `renderStrategy(opp)` — numbered How to Win items
- `renderBuild(d)` — time estimate, tech stack badges, required APIs
- `renderDeploy(d)` — deployment options with recommendation pills
- `renderSentiment(d)` — 3-column community pulse (pain / love / wish)
- `renderPrompt(idea, opp, tech, deploy)` — assembled Claude Code prompt (triggered when opp + tech + deploy all received)

### Loading UX
- Server sends 13 granular `status` events during analysis (e.g. "Scanning competitor landscape...", "Found 6 competitors — analyzing saturation...")
- Client-side micro-progress: fake +0.5% every 1.5s with rotating filler messages to prevent the progress bar from appearing stuck
- Progress bar is a 3px cyan bar at the bottom of the status bar
- Score card gets `.loaded` class (cyan border) only on the `complete` event, not mid-analysis

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
- **No red anywhere in the UI.** Red has been replaced with yellow throughout (weakness tags, low grades, not-recommended pills)
- **No emojis** — use minimal SVG line art for icons (e.g. shuffle icon, share link icon)
- **Maximum signal, minimum noise** — every UI element should earn its place. Remove redundancy (e.g. don't show both a numeric score AND a letter grade)
- **Section cards highlight with cyan border on hover** (`rgba(0,229,255,0.4)` border-color on `:hover`), not always-on
- **Copy confirmations** say just "Copied" (not "Prompt Copied" or "Link Copied")
- **No citation numbers** like [1] or [2] in any displayed text — strip them with `.replace(/\[\d+\]/g, '')`

### Typography
- **Display:** Oswald — used for grades, section numbers, competitor names, big stats
- **Body:** Inter — everything else
- **Base font size:** 15px, line-height 1.6

### Layout
- 12-column CSS grid for the dashboard
- Sidebar: collapses to 48px (shows "VC" monogram in cyan), expands to 200px on hover
- On mobile: sidebar hidden, hamburger toggle shows it as overlay
- Sticky results header with idea title + inline share link icon (faint cyan, brightens on hover)

---

## Sidebar Nav Order
1. Overview (visual scorecard: grade + 4 stat tiles)
2. Competitors
3. Community
4. How to Win
5. Launch Intel
6. Build + Ship
7. Build Your Prompt

---

## Key UI Components

### Grade Ring
- CSS `conic-gradient(from 0deg, ...)` — starts at 12 o'clock, fills clockwise
- Uses `--ring-pct` custom property for dynamic fill percentage
- Grade-to-percentage mapping: A+=100, A=95, A-=90, B+=85, B=78, etc.

### Market Size Visual
- Two-bar mini chart showing current → projected market size
- Structured data: `market_size_current: { value, year }` and `market_size_projected: { value, year }`
- Compact, no axes — just two labeled bars side by side

### Sample Ideas
- 100 unique ideas in a shuffled array (Fisher-Yates shuffle)
- No-repeat cycling — user never sees the same idea twice until all 100 are exhausted
- Shuffle icon (SVG line art) at bottom-right of textarea

### Share Link
- Chain-link SVG icon appears inline right after the title text (not as a separate element)
- Faint cyan default (`rgba(0, 229, 255, 0.35)`), brightens to full cyan on hover
- "Link copied" toast appears below the icon (not above, to avoid covering the title)
- Share button is hidden during analysis, shown on `complete` event

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
- If no changes ship for multiple days, the next push gets the next version number (e.g. v1.9 → v1.10)
- **Always update release notes on every push** — bump the version badge and add/update the changelog entry in `index.html`
- The version badge and changelog popover in `index.html` must always stay in sync with CLAUDE.md
- Current version: **v1.11** (Mar 21, 2026)

---

## Data Quality Rules

### Competitor Matching
- Competitors must match the actual **use case AND target audience**, not just keywords
- Prompt includes explicit examples of what NOT to include (e.g. don't return Stripe for a consumer subscription tracker)
- App store ratings (`app_store_rating`) are requested and displayed when available

### Community Pulse (Sentiment)
- Exa pre-searches 5-7 parallel queries: App Store/Play Store, Reddit, Twitter/X, G2/Trustpilot, per-competitor
- HONESTY RULES in prompt: accurate source labeling, no fabricated quotes
- COMPETITOR DIVERSITY: insights must cover multiple competitors, not just the market leader
- INSIGHT QUALITY: quotes must be specific and actionable, not generic
- SOURCE DIVERSITY: minimum 6 different sources, max 2 insights per source
- Post-processing filter removes quotes under 30 characters
- Never pull from competitor blogs (marketing content, not real sentiment)

### Grade Explanation
- `grade_explanation` field: 3-5 sentences explaining WHY the idea received its grade
- Must be specific: name key challenges, concrete opportunities, competitive dynamics
- Should synthesize findings — not repeat generic market descriptions
- Replaces the old one-sentence `opportunity_summary`

---

## Known Tech Debt / Future Roadmap
- **Public feed** — `/feed` page showing recent analyses (Supabase is ready for this)
- **User auth** — login so users can save/revisit their analyses
- **Pay-per-report** — Stripe integration for monetization
- **Skill level selector** — currently hardcoded to `done_a_few` in the frontend `analyze()` call; the server supports `first_project | done_a_few | build_regularly`
