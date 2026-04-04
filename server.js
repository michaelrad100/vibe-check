import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import Exa from 'exa-js';
import { isNSFW, normalizeIdea, parseJSON, NSFW_BLOCKLIST } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
app.use(express.json());
// Serve index.html with dynamic OG tags for shared results
app.get('/', async (req, res, next) => {
  const resultId = req.query.r;
  if (!resultId) return next(); // No result ID — serve static
  try {
    let opp = null;
    if (supabase) {
      const { data } = await supabase.from('results').select('opportunity,idea').eq('id', resultId).single();
      if (data) opp = { ...data.opportunity, idea: data.idea };
    } else {
      const r = resultStore.get(resultId);
      if (r) opp = { ...r.opportunity, idea: r.idea };
    }
    const shortTitle = opp?.short_title || 'Vibe Check Result';
    const grade = opp?.opportunity_grade || '';
    const ogTitle = `${shortTitle} - Business Analysis by Vibe Check`;
    const desc = (opp?.bottom_line || opp?.grade_explanation || 'AI-powered product idea validation').replace(/"/g, '&quot;');
    const ogImage = `${req.protocol}://${req.get('host')}/api/og/${resultId}`;
    let html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');
    // Replace existing static OG/twitter tags with dynamic ones
    html = html.replace(/<meta property="og:title"[^>]*>/g, `<meta property="og:title" content="${ogTitle}">`);
    html = html.replace(/<meta property="og:description"[^>]*>/g, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta property="og:image"[^>]*>/g, `<meta property="og:image" content="${ogImage}">`);
    html = html.replace(/<meta name="twitter:card"[^>]*>/g, '<meta name="twitter:card" content="summary_large_image">');
    html = html.replace(/<meta name="twitter:title"[^>]*>/g, `<meta name="twitter:title" content="${ogTitle}">`);
    html = html.replace(/<meta name="twitter:description"[^>]*>/g, `<meta name="twitter:description" content="${desc}">`);
    // Add twitter:image (not in base HTML)
    html = html.replace('</head>', `<meta name="twitter:image" content="${ogImage}">\n</head>`);
    // Update page title too
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${ogTitle}</title>`);
    return res.send(html);
  } catch (e) {
    return next(); // On error, serve static
  }
});
app.use(express.static(join(__dirname, 'public')));

// ── SUPABASE ─────────────────────────────────────
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : null;
if (supabase) {
  console.log('Supabase connected — results will persist across restarts');
} else {
  console.warn('Supabase not configured — falling back to in-memory store');
}

// In-memory fallback store (used if Supabase is not configured)
const resultStore = new Map();

const PERPLEXITY_KEY = process.env.PERPLEXITY_KEY;
if (!PERPLEXITY_KEY) { console.error('PERPLEXITY_KEY env var is missing'); process.exit(1); }

// ── EXA (optional — enriches community sentiment) ───
const exa = process.env.EXA_API_KEY ? new Exa(process.env.EXA_API_KEY) : null;
if (exa) {
  console.log('Exa connected — community sentiment will use enriched search');
} else {
  console.log('Exa not configured — community sentiment will use Perplexity only');
}

async function exaSearch(idea, competitorNames = []) {
  if (!exa) { console.log('[Exa] Skipped — no API key configured'); return null; }
  console.log(`[Exa] Starting search for: "${idea.slice(0, 60)}..." with ${competitorNames.length} competitors`);
  try {
    const topCompetitors = competitorNames.slice(0, 4);
    const competitorStr = topCompetitors.join(' OR ') || idea;

    // Build diverse queries — spread across competitors and source types
    const queries = [
      // App Store / Play Store — highest priority, dedicated query
      { query: `${competitorStr} review`, category: null, includeDomains: ['apps.apple.com', 'play.google.com'] },
      // Reddit — complaints and reviews across competitors
      { query: `${competitorStr} complaints frustrations problems`, category: 'reddit' },
      { query: `${idea} recommendations alternatives`, category: 'reddit' },
      // Social — Twitter/X, Threads, Bluesky, forums
      { query: `${competitorStr} review experience opinion`, category: null, includeDomains: ['twitter.com', 'x.com', 'threads.net', 'bsky.app', 'news.ycombinator.com'] },
      // General web — G2, Trustpilot, blog reviews
      { query: `${competitorStr} G2 review OR Trustpilot review OR Capterra review`, category: null },
      // GitHub — open source projects and early-stage competitors
      { query: `${idea}`, category: null, includeDomains: ['github.com'] },
      // Product Hunt — recent launches
      { query: `${idea}`, category: null, includeDomains: ['producthunt.com'] },
    ];

    // Add per-competitor queries if we have multiple (ensures diversity)
    if (topCompetitors.length >= 2) {
      // Query the 2nd and 3rd competitors specifically so results aren't dominated by #1
      for (const comp of topCompetitors.slice(1, 3)) {
        queries.push({ query: `"${comp}" review pros cons user feedback`, category: null });
      }
    }

    const results = await Promise.all(queries.map(async (q, i) => {
      try {
        const opts = {
          numResults: 3,
          type: 'auto',
          highlights: { maxCharacters: 3000 },
        };
        if (q.category) opts.category = q.category;
        if (q.includeDomains) opts.includeDomains = q.includeDomains;
        const r = await exa.searchAndContents(q.query, opts);
        const count = (r.results || []).length;
        console.log(`[Exa] Query ${i+1}/${queries.length}: ${count} results — ${q.category || 'web'}${q.includeDomains ? ' (' + q.includeDomains.join(',') + ')' : ''} — "${q.query.slice(0, 60)}"`);
        return (r.results || []).map(item => ({
          title: item.title,
          url: item.url,
          snippet: (item.highlights || []).join(' ').slice(0, 500) || '',
          source: item.url,
        }));
      } catch (err) {
        console.error(`[Exa] Query ${i+1} FAILED (${q.category || 'web'}): ${err.message}`);
        return [];
      }
    }));

    const flat = results.flat();
    console.log(`[Exa] Found ${flat.length} results across ${queries.length} queries`);
    return flat;
  } catch (err) {
    console.error('[Exa] Search failed:', err.message);
    return null;
  }
}

// ── PERPLEXITY CALL ─────────────────────────────
async function callPerplexity(userMessage) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PERPLEXITY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: 'You are a research analyst. Always respond with valid JSON only. No markdown, no explanations, no code fences — just the raw JSON object.',
        },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Perplexity API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  return { content: json.choices[0].message.content, citations: json.citations || [] };
}

// ── PROMPTS ─────────────────────────────────────
const PROMPTS = {

  market: (idea, mode = 'market') => mode === 'personal'
    ? `Analyze what tools, apps, or services already exist for someone who wants to build "${idea}" for their own personal use.

Return JSON with this exact structure (no other text):
{
  "exists": "fully_exists|mostly_exists|partially_exists|significant_gap|blue_ocean",
  "saturation_score": 1-10,
  "market_summary": "2-3 sentences on how well existing tools cover this personal need. Be direct about the gaps.",
  "competitors": [
    {"name":"","url":"","description":"","pricing":"","strengths":["",""],"weaknesses":["",""],"app_store_rating":null}
  ],
  "key_differentiators_needed": ["gap1","gap2","gap3"],
  "market_concentration": "monopoly|top_heavy|moderate|fragmented",
  "top_player": { "name": "CompanyName", "share": 45 }
}

app_store_rating = the competitor's rating on the App Store or Play Store (e.g. 4.7) if it has a mobile app, otherwise null. Only include real ratings you can verify — do not guess.
saturation_score = coverage score: 10 means existing tools fully cover this need (little reason to build your own); 1 means nothing good exists (strong reason to build).
key_differentiators_needed = specific things missing from existing alternatives that would justify building your own.
market_concentration: monopoly = one player owns 60%+; top_heavy = top 3 own 70%+; moderate = competitive with some leaders; fragmented = no clear winner.
top_player: the single largest competitor and their estimated market share percentage. Use your best estimate based on available data.
Search across G2, Capterra, AlternativeTo, Crunchbase, GitHub, Chrome Web Store, Google Play Store, Stackshare, App Store editorial lists, and Google Search results to find alternatives. Include 3-6 real alternatives with actual URLs. Be specific about their limitations.
IMPORTANT: Search the iOS App Store and Google Play Store directly — many strong alternatives are mobile-first apps that won't appear on G2 or Capterra. For ideas involving journaling, mental health, personal tracking, or self-improvement, make sure to check apps like Reflection, Day One, Journey, Stoic, Rosebud, and similar.

CRITICAL — Competitor relevance rules:
- Every competitor MUST solve the same core problem for the same type of user. Match on use case and target audience, not just shared keywords.
- If the idea is consumer-facing, do NOT include enterprise/B2B platforms (and vice versa).
- If the idea targets individual users, do NOT include tools designed for businesses, developers, or teams — unless those tools also have a clear consumer offering.
- A billing platform is NOT a competitor to a personal finance app just because both involve "subscriptions." Think about what the user would actually download or sign up for as an alternative.
- When in doubt, ask: "Would the person who described this idea realistically consider this product as an alternative?" If no, exclude it.`
    : `Analyze the market for this product idea: "${idea}"

Return JSON with this exact structure (no other text):
{
  "exists": "fully_exists|mostly_exists|partially_exists|significant_gap|blue_ocean",
  "saturation_score": 1-10,
  "market_summary": "2-3 sentence market overview with specific data points",
  "competitors": [
    {"name":"","url":"","description":"","pricing":"","strengths":["",""],"weaknesses":["",""],"app_store_rating":null}
  ],
  "key_differentiators_needed": ["differentiator1","differentiator2","differentiator3"],
  "market_concentration": "monopoly|top_heavy|moderate|fragmented",
  "top_player": { "name": "CompanyName", "share": 45 }
}

app_store_rating = the competitor's rating on the App Store or Play Store (e.g. 4.7) if it has a mobile app, otherwise null. Only include real ratings you can verify — do not guess.
market_concentration: monopoly = one player owns 60%+; top_heavy = top 3 own 70%+; moderate = competitive with some leaders; fragmented = no clear winner.
top_player: the single largest competitor and their estimated market share percentage. Use your best estimate based on available data.
Search across G2, Capterra, AlternativeTo, Crunchbase, GitHub, Chrome Web Store, Google Play Store, Stackshare, App Store editorial lists, and Google Search results to find competitors. Include 4-6 real competitors with actual URLs. Be specific and data-driven.
IMPORTANT: Search the iOS App Store and Google Play Store directly — many strong competitors are mobile-first apps that won't appear on G2 or Capterra. For ideas involving journaling, mental health, personal tracking, or self-improvement, make sure to check apps like Reflection, Day One, Journey, Stoic, Rosebud, and similar.

CRITICAL — Competitor relevance rules:
- Every competitor MUST solve the same core problem for the same type of user. Match on use case and target audience, not just shared keywords.
- If the idea is consumer-facing, do NOT include enterprise/B2B platforms (and vice versa).
- If the idea targets individual users, do NOT include tools designed for businesses, developers, or teams — unless those tools also have a clear consumer offering.
- A billing platform is NOT a competitor to a personal finance app just because both involve "subscriptions." Think about what the user would actually download or sign up for as an alternative.
- When in doubt, ask: "Would someone building this product realistically lose customers to this competitor?" If no, exclude it.`,

  technical: (idea) => `Analyze the technical complexity of building: "${idea}"

Return JSON with this exact structure (no other text):
{
  "difficulty": "no_code|beginner|intermediate|advanced|expert",
  "difficulty_score": 1-10,
  "technical_summary": "2-3 sentence objective overview of the technical challenges and what building this actually involves",
  "time_estimates": {
    "first_project": "X weeks/months using AI coding tools like Cursor or Replit",
    "done_a_few": "X weeks/months with some prior project experience",
    "build_regularly": "X weeks for someone who ships regularly"
  },
  "tech_stack": {"frontend":"","backend":"","database":"","hosting":""},
  "required_apis": [{"name":"","url":"","cost":""}]
}`,

  opportunity: (idea, mode = 'market') => mode === 'personal'
    ? `Help someone decide: should they build "${idea}" for personal use, or just use an existing tool?

Return JSON with this exact structure (no other text):
{
  "opportunity_grade": "A+|A|A-|B+|B|B-|C+|C|C-|D+|D|D-|F",
  "opportunity_score": 1-10,
  "opportunity_summary": "One direct verdict sentence — should they build it or use what already exists?",
  "opportunity_type": "blue_ocean|niche_product|competitive_market|emerging_market|saturated_market",
  "trend": "rapidly_growing|growing|stable|declining|emerging",
  "market_size": "One sentence: how widespread is this personal need?",
  "target_audiences": [
    {"segment":"","size":"small|medium|large","willingness_to_pay":"low|medium|high"}
  ],
  "monetization_strategies": [],
  "improvement_suggestions": [
    {"suggestion":"","reasoning":"","priority":"high|medium|low","effort":"low|medium|high"}
  ]
}

opportunity_grade: A = existing tools have critical gaps (build it); B = good reasons to build; C = borderline; D = existing tools mostly work; F = existing tools cover this well (just use them).
opportunity_score = gap score: how big is the gap between what exists and this specific need (10 = huge gap, 1 = fully covered).
improvement_suggestions = specific reasons building your own is better than using alternatives. Each one is a concrete gap in existing tools.
monetization_strategies MUST be an empty array [].`
    : `Assess the market opportunity for: "${idea}"

Return JSON with this exact structure (no other text):
{
  "short_title": "3-5 word summary of the idea (e.g. 'Parking Spot Marketplace', 'AI Voice Journal', 'Neighborhood Tool Library')",
  "opportunity_grade": "A+|A|A-|B+|B|B-|C+|C|C-|D+|D|D-|F",
  "opportunity_score": 1-10,
  "grade_explanation": "1-2 sentences explaining WHY this idea received this grade",
  "opportunity_type": "blue_ocean|niche_product|competitive_market|emerging_market|saturated_market",
  "trend": "rapidly_growing|growing|stable|declining|emerging",
  "market_size": "One sentence with specific market size and growth rate data",
  "market_size_current": { "value": "$X.XB", "year": 2026 },
  "market_size_projected": { "value": "$X.XB", "year": 2033 },
  "target_audiences": [
    {"segment":"","size":"small|medium|large","willingness_to_pay":"low|medium|high"}
  ],
  "monetization_strategies": [
    {"model":"","description":"","revenue_potential":"Low (<$10k MRR)|Medium ($10-100k MRR)|High (>$100k MRR)"}
  ],
  "improvement_suggestions": [
    {"suggestion":"","reasoning":"","priority":"high|medium|low","effort":"low|medium|high"}
  ],
  "bottom_line": "2-3 sentences: the honest verdict. What should this person do? Be direct — tell them whether to proceed, pivot, or pass, and why. Reference the most important factor.",
  "recommended_play": "One sentence: the single best move — which audience to target first with which monetization model."
}

short_title: A catchy 3-5 word title summarizing the core idea. Think product name or category — not the full description. Examples: "Parking Spot Marketplace", "AI Voice Journal", "Neighborhood Tool Library", "Gamified Finance App".
grade_explanation: 1-2 concise sentences explaining WHY this idea received this grade. Synthesize the single most important insight — the key opportunity or challenge that defines the verdict. Always refer to the subject as an "idea" or "product", never as a "feature".
market_size_current: the current market size as a short value string (e.g. "$1.55B") and year. Use real data.
market_size_projected: the projected future market size and target year. Use real data.
bottom_line: Be direct and specific. Don't hedge. Tell them what to actually do based on the analysis. Reference specific competitors, audience segments, or monetization models. This is the "so what?" of the entire report.
recommended_play: Connect the best target_audience with the best monetization_strategy into one actionable sentence. E.g. "Target X audience with Y model to reach Z."
Do NOT include citation numbers like [1] or [2] in any text fields.`,

  deployment: (idea) => `Recommend deployment platforms for: "${idea}"

Return JSON with this exact structure (no other text):
{
  "primary_recommendation": "web_app|mobile_ios|mobile_android|mobile_cross_platform|chrome_extension|shopify_app|desktop_cross_platform|api_service",
  "quick_win_approach": "One sentence on fastest path to first users",
  "reasoning": "Why this platform wins for this idea",
  "deployment_options": [
    {"platform":"","recommendation_level":"highly_recommended|recommended|possible|not_recommended","time_to_market":"","reasoning":""}
  ]
}`,

  sentiment: (idea, competitorNames = [], mode = 'market', exaContext = null) => {
    const toolList = competitorNames.length > 0
      ? competitorNames.join(', ')
      : 'existing tools in this space';

    const exaBlock = exaContext && exaContext.length > 0
      ? `\n\nHere are real user discussions and reviews found across the web that you should use as source material. Extract genuine user quotes, pain points, loved features, and wishes from these:\n\n${exaContext.map((r, i) => `[${i+1}] ${r.title || 'Untitled'}\nURL: ${r.url}\n${r.snippet}\n`).join('\n')}\n\nUse the above sources as PRIMARY material. Supplement with your own web search to fill any gaps and ensure diversity.`
      : '';

    if (mode === 'personal') {
      return `Search Twitter/X, Threads, Bluesky, Reddit (r/entrepreneur, r/startups, r/SaaS, and topic-specific subreddits), Hacker News, Product Hunt comments, App Store reviews, Play Store reviews, G2 reviews, Capterra reviews, Stack Overflow, Discord servers, Slack communities, YouTube comments, Indie Hackers, Quora, subreddit wikis, GitHub Issues on competing projects, Trustpilot, LinkedIn posts, and Google Trends for real user feedback about: ${toolList} — existing alternatives to "${idea}".${exaBlock}

Focus on what frustrates people about these tools: missing features, limitations, things that are broken or clunky. Also capture what they love and what they wish existed. This helps someone decide if building their own version is worth the effort.

IMPORTANT RULES:
- Only include quotes that are specifically about product experiences with real tools, NOT generic topic discussions.
- Pull from diverse sources — don't rely on just one or two platforms. Each insight should ideally come from a DIFFERENT source.
- NEVER cite blog posts or marketing content from the competitors themselves.
- No single source should appear more than twice across all insights.

HONESTY RULES — CRITICAL:
- NEVER fabricate quotes. If you cannot find a real quote, do not invent one.
- NEVER attribute a quote to "YouTube comments" if it came from a video transcript or description — label it "YouTube transcript" or "YouTube video".
- NEVER attribute a quote to a source you did not actually retrieve it from. If the URL is a blog post, say "blog review", not "App Store review".
- If a source_url is provided, it MUST actually contain or closely paraphrase the quote. Do not link to unrelated pages.
- It is better to return fewer high-quality, real quotes than to pad the list with fabricated ones.

COMPETITOR DIVERSITY — CRITICAL:
- Spread quotes across MULTIPLE different competitors. Do NOT let one competitor dominate.
- No single competitor should appear more than 3 times across all insights.
- If there are 4+ competitors, aim to reference at least 3 different ones.

INSIGHT QUALITY — CRITICAL:
- Every quote must be SPECIFIC and ACTIONABLE — it must explain WHY, not just state a feeling.
- REJECT vague quotes like "it's great", "I love it", "not a fan", "highly recommend". These say nothing useful.
- Good example: "The export feature only supports CSV — I need Excel with formatting preserved for my team's reports"
- Bad example: "The export feature could be better"
- Each quote must reference a specific feature, workflow, limitation, or use case.

Return JSON with this exact structure (no other text):
{
  "community_insights": [
    {
      "quote": "Direct or close paraphrase of a real user comment about a specific existing tool",
      "sentiment": "pain_point|loved_feature|wish",
      "theme": "Short theme label (3-5 words)",
      "source": "e.g. r/personalfinance, App Store review, G2 review, Twitter/X, Trustpilot",
      "source_url": "Direct URL to the actual post, review, or thread — or null if unavailable",
      "competitor_reference": "Name of the specific tool being discussed"
    }
  ]
}

Include up to 15 insights: 5 pain_point, 5 loved_feature, 5 wish. If you cannot find 5 for a category, include as many as you can find (minimum 2 per category). Quotes must be about real tools, not general topics.

SOURCE DIVERSITY RULES:
- Aim for at least 5 different source types across the insights.
- No single source type (e.g. "YouTube") should appear more than 3 times.
- Prioritize: (1) App Store / Play Store reviews, (2) Reddit threads, (3) Twitter/X posts, (4) G2 / Capterra / Trustpilot reviews, (5) Product Hunt comments, (6) Hacker News, (7) YouTube comments (real comments only, not transcripts), (8) Indie Hackers / Quora / forums, (9) GitHub Issues.
- If you cannot find real quotes from a source, skip it — do NOT fabricate.`;
    }

    const competitorList = competitorNames.length > 0
      ? `Focus specifically on these known competitors: ${toolList}. Search for real user comments, reviews, and discussions about these specific products.`
      : `Search for real user opinions about existing apps and products that are direct competitors to the idea.`;

    return `Search Twitter/X, Threads, Bluesky, Reddit (r/entrepreneur, r/startups, r/SaaS, and topic-specific subreddits), Hacker News, Product Hunt comments, App Store reviews, Play Store reviews, G2 reviews, Capterra reviews, Stack Overflow, Discord servers, Slack communities, YouTube comments, Indie Hackers, Quora, subreddit wikis, GitHub Issues on competing projects, Trustpilot, LinkedIn posts, and Google Trends for real user opinions about this product space: "${idea}"${exaBlock}

${competitorList}

Find specific quotes where users discuss their experience with these competing products — what frustrates them, what they love, what they wish existed.

IMPORTANT RULES:
- Only include quotes that are specifically about product experiences with real competing apps, NOT generic topic discussions.
- Pull from diverse sources — don't rely on just one or two platforms. Each insight should ideally come from a DIFFERENT source.
- NEVER cite blog posts or marketing content from the competitors themselves.
- No single source should appear more than twice across all insights.

HONESTY RULES — CRITICAL:
- NEVER fabricate quotes. If you cannot find a real quote, do not invent one.
- NEVER attribute a quote to "YouTube comments" if it came from a video transcript or description — label it "YouTube transcript" or "YouTube video".
- NEVER attribute a quote to a source you did not actually retrieve it from. If the URL is a blog post, say "blog review", not "App Store review".
- If a source_url is provided, it MUST actually contain or closely paraphrase the quote. Do not link to unrelated pages.
- It is better to return fewer high-quality, real quotes than to pad the list with fabricated ones.

COMPETITOR DIVERSITY — CRITICAL:
- Spread quotes across MULTIPLE different competitors. Do NOT let one competitor dominate.
- No single competitor should appear more than 3 times across all insights.
- If there are 4+ competitors, aim to reference at least 3 different ones.

INSIGHT QUALITY — CRITICAL:
- Every quote must be SPECIFIC and ACTIONABLE — it must explain WHY, not just state a feeling.
- REJECT vague quotes like "it's great", "I love it", "not a fan", "highly recommend". These say nothing useful.
- Good example: "The export feature only supports CSV — I need Excel with formatting preserved for my team's reports"
- Bad example: "The export feature could be better"
- Each quote must reference a specific feature, workflow, limitation, or use case.

Return JSON with this exact structure (no other text):
{
  "community_insights": [
    {
      "quote": "Direct or close paraphrase of a real user comment about a specific competing product",
      "sentiment": "pain_point|loved_feature|wish",
      "theme": "Short theme label (3-5 words)",
      "source": "e.g. r/personalfinance, App Store review, G2 review, Twitter/X, Trustpilot",
      "source_url": "Direct URL to the actual post, review, or thread — or null if unavailable",
      "competitor_reference": "Name of the specific competitor being discussed"
    }
  ]
}

Include up to 15 insights: 5 pain_point, 5 loved_feature, 5 wish. If you cannot find 5 for a category, include as many as you can find (minimum 2 per category). Quotes must be about real competing products, not general topics.

SOURCE DIVERSITY RULES:
- Aim for at least 5 different source types across the insights.
- No single source type (e.g. "YouTube") should appear more than 3 times.
- Prioritize: (1) App Store / Play Store reviews, (2) Reddit threads, (3) Twitter/X posts, (4) G2 / Capterra / Trustpilot reviews, (5) Product Hunt comments, (6) Hacker News, (7) YouTube comments (real comments only, not transcripts), (8) Indie Hackers / Quora / forums, (9) GitHub Issues.
- If you cannot find real quotes from a source, skip it — do NOT fabricate.`;
  },

  launchIntel: (idea, mode = 'market') => mode === 'personal'
    ? `Someone wants to build "${idea}" for personal use. Answer three questions to help them decide if it's worth starting.

Return JSON with this exact structure (no other text):
{
  "first_users": [
    {"channel": "specific name", "type": "subreddit|discord|slack|newsletter|forum|platform", "url": "https://...", "why": "one sentence — why people here would want to see/use this"}
  ],
  "fatal_flaw": "One to two sentences — the most likely reason they abandon this project before it's useful to them.",
  "mvp_features": [
    {"feature": "Feature name", "description": "What it does and why it's needed for personal use", "priority": "must_have|nice_to_have"}
  ]
}

first_users: 4-6 communities where people discuss this problem or build similar personal projects. These are people who'd want to hear about their build.
fatal_flaw: Think about: underestimating complexity, losing motivation mid-build, an existing free tool they haven't found, or a fundamental issue with the core assumption.
mvp_features: Absolute minimum 3-4 features to make this useful for personal use. must_have first.`
    : `You're helping a developer decide whether "${idea}" is worth building. Answer three critical questions honestly.

Return JSON with this exact structure (no other text):
{
  "first_users": [
    {"channel": "specific name", "type": "subreddit|discord|slack|newsletter|forum|platform", "url": "https://...", "why": "one sentence on why this audience fits"}
  ],
  "fatal_flaw": "One to two sentences — the most likely specific reason this fails. Name the actual risk, not generic advice.",
  "mvp_features": [
    {"feature": "Feature name", "description": "What it does and why it belongs in the MVP", "priority": "must_have|nice_to_have"}
  ]
}

first_users: 4-6 specific named communities where target users actively hang out. Real subreddit names, Discord server names, newsletters — not vague categories. Include URLs where possible.
fatal_flaw: Be direct. Consider: wrong pricing model, a free/open-source alternative nobody mentions, cold start problem, regulatory risk, a key assumption that's probably wrong. One specific thing, not a list.
mvp_features: Exactly 3-5 features that define the minimum viable product. must_have items first. Everything else is scope creep.`,

  earlyStage: (idea, exaContext) => `Given this product idea: "${idea}"

Here are GitHub repos, Product Hunt launches, and other early-stage projects found that may be related:

${exaContext}

Identify up to 4 early-stage projects, open-source repos, or recent indie launches that are genuinely attempting to solve the same or a very similar problem. These should be lesser-known — NOT established companies already on G2/Capterra.

Return JSON with this exact structure (no other text):
{
  "early_stage_competitors": [
    {
      "name": "Project Name",
      "url": "https://...",
      "source": "github|producthunt|indie_hackers|other",
      "description": "One sentence — what it does",
      "stars": null,
      "status": "active|stale|new",
      "relevance": "One sentence — why this matters to someone building this idea"
    }
  ]
}

RULES:
- Only include projects genuinely solving the same problem for the same audience.
- Skip libraries, SDKs, frameworks, or tangentially related developer tools.
- Skip established companies — this is specifically for early-stage, indie, or open-source projects.
- "stars" = GitHub stars if available, otherwise null.
- "status": active = committed within last 3 months; stale = no updates in 6+ months; new = launched recently.
- If fewer than 2 genuinely relevant projects exist, return an empty array rather than padding with irrelevant ones.
- Do NOT include citation numbers like [1] or [2] in any text.`,
};

// ── SSE ENDPOINT ────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { idea, skillLevel = 'first_project', mode = 'market' } = req.body;
  if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // ── BATCH 1: Four independent API calls in parallel ──────────
    send('status', { phase: 'market', message: 'Scanning competitors, tech stack, opportunity, and deployment...' });

    const [marketData, techData, oppData, deployData] = await Promise.all([
      callPerplexity(PROMPTS.market(idea, mode)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        const names = (d.competitors || []).map(c => c.name).filter(Boolean);
        send('status', { phase: 'market_done', message: `Found ${names.length} competitors — analyzing saturation...` });
        send('market', d);
        return d;
      }),
      callPerplexity(PROMPTS.technical(idea)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        send('status', { phase: 'technical_done', message: 'Tech stack and build complexity assessed...' });
        send('technical', d);
        return d;
      }),
      callPerplexity(PROMPTS.opportunity(idea, mode)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        send('status', { phase: 'opportunity_done', message: 'Opportunity scored — identifying audiences...' });
        send('opportunity', d);
        return d;
      }),
      callPerplexity(PROMPTS.deployment(idea)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        send('status', { phase: 'deployment_done', message: 'Deployment platforms ranked...' });
        send('deployment', d);
        return d;
      }).catch(e => {
        console.error('Deployment API error:', e.message);
        const fallback = { primary_recommendation: 'web_app', deployment_options: [], _citations: [] };
        send('deployment', fallback);
        return fallback;
      }),
    ]);

    const competitorNames = (marketData.competitors || []).map(c => c.name).filter(Boolean);

    // ── BATCH 2: Exa pre-search (needs competitor names from batch 1) ──
    send('status', { phase: 'sentiment_exa', message: 'Searching Reddit, app stores, GitHub, and Product Hunt...' });
    const exaResults = await exaSearch(idea, competitorNames);
    send('status', { phase: 'sentiment', message: 'Reading real user reviews and forum discussions...' });

    // ── BATCH 3: Three API calls in parallel (need Exa results) ──
    const ghPHResults = (exaResults || []).filter(r =>
      r.url && (r.url.includes('github.com') || r.url.includes('producthunt.com'))
    );

    const [sentimentData, earlyStageData, launchData] = await Promise.all([
      callPerplexity(PROMPTS.sentiment(idea, competitorNames, mode, exaResults)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        // Quality filter: remove vague/short community insights
        if (d.community_insights && Array.isArray(d.community_insights)) {
          d.community_insights = d.community_insights.filter(insight => {
            const quote = (insight.quote || '').trim();
            return quote.length >= 30;
          });
        }
        send('status', { phase: 'sentiment_done', message: 'Community insights extracted...' });
        send('sentiment', d);
        return d;
      }),
      (ghPHResults.length > 0
        ? callPerplexity(PROMPTS.earlyStage(idea, ghPHResults.map((r, i) => `[${i+1}] ${r.title || 'Untitled'}\nURL: ${r.url}\n${r.snippet}\n`).join('\n'))).then(r => {
            const d = parseJSON(r.content);
            d._citations = r.citations;
            if (d.early_stage_competitors?.length > 0) send('early_stage', d);
            return d;
          }).catch(e => { console.error('Early-stage API error:', e.message); return { early_stage_competitors: [], _citations: [] }; })
        : Promise.resolve({ early_stage_competitors: [], _citations: [] })
      ),
      callPerplexity(PROMPTS.launchIntel(idea, mode)).then(r => {
        const d = parseJSON(r.content);
        d._citations = r.citations;
        send('status', { phase: 'launch_done', message: 'Launch strategy ready...' });
        send('launch_intel', d);
        return d;
      }),
    ]);

    // Store full result for shareable links
    const resultId = randomUUID();
    const resultPayload = {
      id: resultId,
      idea,
      skill_level: skillLevel,
      mode,
      market: marketData,
      technical: techData,
      opportunity: oppData,
      deployment: deployData,
      sentiment: sentimentData,
      early_stage: earlyStageData,
      launch_intel: launchData,
    };

    if (supabase) {
      const { error } = await supabase.from('results').insert(resultPayload);
      if (error) console.error('Supabase insert error:', error.message);
    } else {
      resultStore.set(resultId, { ...resultPayload, createdAt: new Date().toISOString() });
    }

    send('complete', { resultId });
  } catch (err) {
    console.error('Analysis error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── SHARED RESULT ENDPOINT ──────────────────────
app.get('/api/result/:id', async (req, res) => {
  if (supabase) {
    const { data, error } = await supabase
      .from('results')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Result not found or expired' });
    // Normalise field names to match what the frontend expects
    return res.json({
      idea: data.idea,
      skillLevel: data.skill_level,
      mode: data.mode || 'market',
      market: data.market,
      technical: data.technical,
      opportunity: data.opportunity,
      deployment: data.deployment,
      sentiment: data.sentiment,
      early_stage: data.early_stage,
      launch_intel: data.launch_intel,
    });
  }
  // Fallback to in-memory store
  const result = resultStore.get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found or expired' });
  res.json(result);
});

// ── COUNT ENDPOINT ───────────────────────────────
app.get('/api/count', async (req, res) => {
  if (supabase) {
    const { count, error } = await supabase
      .from('results')
      .select('*', { count: 'exact', head: true });
    if (error) return res.json({ count: resultStore.size });
    return res.json({ count });
  }
  res.json({ count: resultStore.size });
});

// ── OG IMAGE ENDPOINT ──────────────────────────
app.get('/api/og/:id', async (req, res) => {
  let data;
  if (supabase) {
    const { data: d } = await supabase.from('results').select('opportunity').eq('id', req.params.id).single();
    data = d;
  } else {
    const r = resultStore.get(req.params.id);
    if (r) data = { opportunity: r.opportunity };
  }
  const grade = data?.opportunity?.opportunity_grade || '?';
  const title = data?.opportunity?.short_title || 'Vibe Check';
  const gradeLabels = {'A+':'Exceptional opportunity','A':'Strong opportunity','A-':'Promising opportunity','B+':'Good potential','B':'Solid potential','B-':'Moderate potential','C+':'Worth exploring','C':'Challenging market','C-':'Uphill battle','D+':'Tough odds','D':'Weak opportunity','D-':'Poor outlook','F':'Not recommended'};
  const label = gradeLabels[grade] || '';

  // Generate SVG OG image
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#050505"/>
    <rect x="0" y="0" width="1200" height="4" fill="#00e5ff"/>
    <text x="80" y="80" font-family="sans-serif" font-size="20" font-weight="700" fill="#00e5ff" letter-spacing="3">VIBE CHECK</text>
    <circle cx="600" cy="280" r="120" fill="none" stroke="#00e5ff" stroke-width="6" opacity="0.3"/>
    <circle cx="600" cy="280" r="120" fill="none" stroke="#00e5ff" stroke-width="6" stroke-dasharray="754" stroke-dashoffset="${754 - (754 * ({'A+':100,'A':95,'A-':90,'B+':85,'B':78,'B-':72,'C+':65,'C':58,'C-':52,'D+':45,'D':38,'D-':32,'F':15}[grade]||50)/100)}" transform="rotate(-90 600 280)"/>
    <text x="600" y="300" font-family="sans-serif" font-size="80" font-weight="700" fill="#e0e0e0" text-anchor="middle">${grade}</text>
    <text x="600" y="440" font-family="sans-serif" font-size="18" font-weight="600" fill="#00e5ff" text-anchor="middle" text-transform="uppercase" letter-spacing="2">${label.toUpperCase()}</text>
    <text x="600" y="520" font-family="sans-serif" font-size="36" font-weight="700" fill="#e0e0e0" text-anchor="middle">${title}</text>
    <text x="600" y="580" font-family="sans-serif" font-size="14" fill="#888888" text-anchor="middle">vibecheck.michaelrad.me</text>
  </svg>`;

  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// ── FEED ENDPOINT ────────────────────────────────
app.get('/api/results', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    let items = [];

    if (supabase) {
      // Fetch more than needed to account for NSFW filtering and dedup
      const { data, error } = await supabase
        .from('results')
        .select('id, idea, opportunity, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      items = data || [];
    } else {
      // In-memory fallback
      items = [...resultStore.values()]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(r => ({ id: r.id, idea: r.idea, opportunity: r.opportunity, created_at: r.createdAt }));
    }

    // Filter NSFW
    items = items.filter(r => r.idea && !isNSFW(r.idea));

    // Deduplicate — keep most recent per unique idea
    const seen = new Map();
    items = items.filter(r => {
      const key = normalizeIdea(r.idea);
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });

    // Paginate
    const page = items.slice(offset, offset + limit);

    // Return lightweight cards
    res.json({
      results: page.map(r => ({
        id: r.id,
        idea: r.idea,
        grade: r.opportunity?.opportunity_grade || '?',
        type: r.opportunity?.opportunity_type || '',
        explanation: (r.opportunity?.grade_explanation || r.opportunity?.opportunity_summary || '').replace(/\[\d+\]/g, ''),
        created_at: r.created_at,
      })),
      total: items.length,
      hasMore: offset + limit < items.length,
    });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

// ── SERVE FEED PAGE ──────────────────────────────
app.get('/feed', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'feed.html'));
});

const PORT = process.env.PORT || 3000;

export { app, callPerplexity, resultStore };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  app.listen(PORT, () => console.log(`Vibe Check server running on port ${PORT}`));
}
