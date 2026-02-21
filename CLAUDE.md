# Vibe Check — Claude Code Guide

## What This Project Is

Vibe Check is an AI-powered product idea validator. Users enter a startup or product idea and receive a comprehensive market analysis in under 60 seconds, streamed live to the page. The output covers: opportunity score, market landscape, competitors, target audience, technical complexity, deployment options, community sentiment, strategic differentiation, and a ready-to-use Claude Code prompt.

Live on Railway. The working directory for all active development is:
`/Users/michaelradparvar/Downloads/vibe-check/.claude/worktrees/sweet-gould/`

---

## File Structure

```
vibe-check/
├── public/
│   └── index.html        # Entire frontend — landing + results in one SPA
├── server.js             # Express backend, Perplexity API calls, SSE streaming
├── package.json          # Node/Express, ES modules ("type": "module")
├── .env                  # PERPLEXITY_KEY (never commit this)
└── CLAUDE.md             # This file
```

---

## Tech Stack

- **Runtime:** Node.js 18+ with ES modules (`import`/`export`, no `require`)
- **Backend:** Express 4
- **AI:** Perplexity API (`sonar-pro` model) — 5 sequential API calls per analysis
- **Streaming:** Server-Sent Events (SSE) via `/api/analyze` POST endpoint
- **Frontend:** Vanilla JS, no framework, no build step
- **Fonts:** Oswald (display/headers) + Inter (body) via Google Fonts
- **Hosting:** Railway (watches `main` branch, auto-deploys on push)
- **Result sharing:** In-memory `Map` store with UUID keys — results lost on server restart (known tech debt)

---

## How the App Works

### Single-Page Architecture
One `index.html` with two sections:
- `#landing` — centered form, shown by default
- `#results` — full dashboard, hidden until analysis starts

JS toggles between them. No routing library.

### Analysis Flow (server.js)
On POST `/api/analyze`, the server makes 5 sequential Perplexity calls and streams each result as an SSE event:

1. `market` → competitors, saturation score, market summary, differentiators needed
2. `technical` → difficulty, time estimates, tech stack, required APIs
3. `opportunity` → grade (A–F), score, trend, target audiences, monetization, improvement suggestions
4. `deployment` → platform recommendation, deployment options
5. `sentiment` → community insights (pain points, loved features, wish list) — uses competitor names from step 1 for targeted search
6. `complete` → UUID for shareable link

### Frontend Rendering (index.html)
Each SSE event triggers a `render*` function:
- `renderMarket(d)` — vertical saturation meter + market summary
- `renderCompetitors(d)` — grid of competitor tiles with linked names
- `renderScore(opp)` — grade ring, opportunity type, stats
- `renderAudience(opp)` — target segments + monetization strategies
- `renderBuild(d)` — time estimate, tech stack badges, required APIs
- `renderDeploy(d)` — deployment options with recommendation pills
- `renderSentiment(d)` — 3-column community pulse (pain / love / wish)
- `renderStrategy(opp)` — numbered How to Win items
- `renderPrompt(idea, opp, tech, deploy)` — assembled Claude Code prompt (triggered when opp + tech + deploy all received)

---

## Design System

### Colors
```css
--accent-cyan:     #00e5ff   /* Primary accent — CTAs, active states, highlights */
--accent-cyan-dim: rgba(0,229,255,0.12)
--bg-deep:         #050505   /* Page background */
--bg-surface:      #0f0f11   /* Sidebar */
--bg-card:         #141416   /* Cards */
--green:           #34d399   /* Good/positive */
--yellow:          #fbbf24   /* Caution/medium */
--text-main:       #e0e0e0
--text-muted:      #888888
--border:          #262626
```

**No red anywhere in the UI.** Red has been replaced with yellow throughout (weakness tags, low grades, not-recommended pills).

### Typography
- **Display:** Oswald — used for grades, section numbers, competitor names, big stats
- **Body:** Inter — everything else
- **Base font size:** 15px, line-height 1.6

### Layout
- 12-column CSS grid for the dashboard
- Sidebar: collapses to 48px (shows "VC" monogram in cyan), expands to 200px on hover
- On mobile: sidebar hidden, hamburger toggle shows it as overlay

---

## Sidebar Nav Order
1. Overview
2. Market Signal
3. Competitors
4. Community
5. How to Win
6. Build + Ship
7. Build Your Prompt

---

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `PERPLEXITY_KEY` | Yes | Perplexity API key (`pplx-...`) |
| `PORT` | No | Defaults to 3000 |

Set `PERPLEXITY_KEY` in Railway dashboard under service → Variables.

---

## Local Dev
```bash
cd /Users/michaelradparvar/Downloads/vibe-check/.claude/worktrees/sweet-gould
npm install
npm run dev          # node --watch server.js
# Open http://localhost:3000
```

---

## Git & Deploy Workflow
- Active branch: `claude/sweet-gould` (worktree)
- Production branch: `main` (Railway watches this)
- To deploy: merge `claude/sweet-gould` → `main` → `git push origin main`
- Railway auto-deploys within ~60–90 seconds of a push to `main`

### Version Convention
- One changelog entry per day maximum
- Same-day changes are collapsed into a single version entry
- Current version: **v1.6**

---

## Known Tech Debt / Future Roadmap
- **In-memory result store** — results lost on server restart. Replace with a real DB (Postgres/SQLite) before adding a public feed
- **Public feed** — `/feed` page showing recent analyses (needs DB first)
- **User auth** — login so users can save/revisit their analyses
- **Pay-per-report** — Stripe integration for monetization
- **Skill level selector** — currently hardcoded to `done_a_few` in the frontend `analyze()` call; the server supports `first_project | done_a_few | build_regularly`
