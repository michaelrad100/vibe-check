import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// API KEY — set via environment variable
// ─────────────────────────────────────────────
const PERPLEXITY_KEY = process.env.PERPLEXITY_KEY;
if (!PERPLEXITY_KEY) {
  console.error('❌  Missing PERPLEXITY_KEY environment variable. Add it to your .env file.');
  process.exit(1);
}

// ─────────────────────────────────────────────
// PERPLEXITY API HELPER
// ─────────────────────────────────────────────
async function callPerplexity(userMessage) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PERPLEXITY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content:
            'You are a research assistant that only responds with valid JSON. Never include markdown code fences, explanations, or any text outside the JSON object. Always return a complete, parseable JSON object.',
        },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Perplexity error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─────────────────────────────────────────────
// ROBUST JSON PARSER
// ─────────────────────────────────────────────
function parseJSON(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { _parseError: true, _raw: text };
}

// ─────────────────────────────────────────────
// REDDIT PUBLIC SEARCH
// ─────────────────────────────────────────────
async function searchReddit(query) {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=top&limit=6&t=year&type=link`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VibeCheck/1.0 (research tool; non-commercial)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data?.children || []).map((p) => ({
      title: p.data.title,
      score: p.data.score,
      subreddit: p.data.subreddit,
      url: `https://reddit.com${p.data.permalink}`,
      numComments: p.data.num_comments,
      preview: p.data.selftext?.substring(0, 250) || '',
      sentiment: p.data.upvote_ratio > 0.75 ? 'positive' : p.data.upvote_ratio > 0.5 ? 'neutral' : 'negative',
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────
const PROMPTS = {
  market: (idea) => `
Search the web thoroughly for existing products, tools, apps, websites, or services that match or compete with this idea. Look at Product Hunt, app stores, SaaS directories, and general web results.

Product Idea: "${idea}"

Return ONLY a valid JSON object with this exact structure:
{
  "exists": "fully_exists" | "mostly_exists" | "partially_exists" | "significant_gap" | "blue_ocean",
  "saturation_score": <integer 1-10, where 10 = fully saturated>,
  "competitors": [
    {
      "name": "Product Name",
      "url": "https://example.com",
      "description": "One sentence about what they do",
      "pricing": "Free / Freemium / Paid $X/mo / Enterprise",
      "founded": "Year or estimated",
      "strengths": ["strength1", "strength2"],
      "weaknesses": ["weakness1", "weakness2"]
    }
  ],
  "market_summary": "2-3 sentence summary of the competitive landscape",
  "key_differentiators_needed": ["What you would need to stand out"]
}`,

  technical: (idea, skillLevel) => `
Analyze the technical requirements for building this product. The developer's skill level is: ${skillLevel}.

Product: "${idea}"

Return ONLY a valid JSON object:
{
  "difficulty": "no_code" | "beginner" | "intermediate" | "advanced" | "expert",
  "difficulty_score": <integer 1-10>,
  "time_estimates": {
    "vibe_coder": "X-Y weeks with no-code/AI tools",
    "beginner": "X-Y months",
    "intermediate": "X-Y weeks",
    "senior_dev": "X-Y days"
  },
  "tech_stack": {
    "frontend": "Recommended frontend technology",
    "backend": "Recommended backend technology",
    "database": "Recommended database",
    "hosting": "Recommended hosting (e.g. Vercel, Railway, Fly.io)"
  },
  "required_apis": [
    { "name": "API Name", "purpose": "Why it's needed", "cost": "Free/Paid/Freemium", "url": "https://..." }
  ],
  "recommended_tools": [
    { "name": "Tool Name", "purpose": "What it helps with", "cost": "Free/Paid", "skill_level": "all" | "beginner" | "advanced" }
  ],
  "no_code_alternatives": [
    { "tool": "Bubble / Webflow / etc.", "coverage": "What percent of the idea this covers", "limitations": "What it cannot do" }
  ],
  "biggest_challenges": ["Challenge 1", "Challenge 2", "Challenge 3"],
  "technical_summary": "2-3 sentence technical overview for a ${skillLevel}"
}`,

  opportunity: (idea) => `
Evaluate the market opportunity for this product idea. Search for market size data, trends, investor activity, and revenue potential.

Product: "${idea}"

Return ONLY a valid JSON object:
{
  "opportunity_score": <integer 1-10>,
  "opportunity_grade": "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "D",
  "opportunity_type": "niche_product" | "growing_market" | "mass_market" | "enterprise_b2b" | "consumer_app" | "developer_tool" | "marketplace" | "platform",
  "market_size": "Estimated TAM with source or reasoning",
  "trend": "rapidly_growing" | "growing" | "stable" | "declining" | "emerging",
  "trend_evidence": "Brief evidence or data point supporting trend",
  "monetization_strategies": [
    {
      "model": "SaaS Subscription / One-time Purchase / Freemium / Usage-based / Marketplace / Ads",
      "description": "How this would work in practice",
      "revenue_potential": "Low (<$10k MRR) / Medium ($10-100k MRR) / High (>$100k MRR)",
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "target_audiences": [
    { "segment": "Audience description", "size": "Large / Medium / Niche", "willingness_to_pay": "High / Medium / Low" }
  ],
  "improvement_suggestions": [
    {
      "suggestion": "Specific feature, angle, or pivot to improve the idea",
      "reasoning": "Why this would increase value or reduce competition",
      "priority": "high" | "medium" | "low",
      "effort": "low" | "medium" | "high"
    }
  ],
  "opportunity_summary": "2-3 sentence executive summary of the opportunity"
}`,

  deployment: (idea) => `
Determine the optimal deployment platform(s) for this product idea. Consider user behavior, monetization, discoverability, and technical tradeoffs.

Product: "${idea}"

Return ONLY a valid JSON object:
{
  "primary_recommendation": "web_app" | "mobile_ios" | "mobile_android" | "mobile_cross_platform" | "chrome_extension" | "shopify_app" | "wordpress_plugin" | "desktop_mac" | "desktop_windows" | "desktop_cross_platform" | "api_service" | "slack_app" | "vs_code_extension" | "notion_integration",
  "confidence_score": <integer 1-10>,
  "deployment_options": [
    {
      "platform": "Platform Name",
      "recommendation_level": "highly_recommended" | "recommended" | "possible" | "not_recommended",
      "pros": ["pro1", "pro2"],
      "cons": ["con1", "con2"],
      "build_complexity": "low" | "medium" | "high",
      "monetization_potential": "low" | "medium" | "high",
      "time_to_market": "Fast (1-4 weeks) / Medium (1-3 months) / Slow (3+ months)"
    }
  ],
  "go_to_market_strategy": "2-3 sentence GTM recommendation",
  "quick_win_approach": "The single fastest path to a usable v1",
  "reasoning": "Why the primary recommendation is best for this specific product"
}`
};

// ─────────────────────────────────────────────
// MAIN ANALYSIS ENDPOINT (SSE streaming)
// ─────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { idea, skillLevel } = req.body;

  if (!idea?.trim()) return res.status(400).json({ error: 'No idea provided' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('status', { phase: 'market', message: 'Researching existing solutions across the web...' });
    const market = parseJSON(await callPerplexity(PROMPTS.market(idea)));
    send('market', market);

    send('status', { phase: 'technical', message: 'Analyzing technical requirements and stack...' });
    const technical = parseJSON(await callPerplexity(PROMPTS.technical(idea, skillLevel)));
    send('technical', technical);

    send('status', { phase: 'opportunity', message: 'Evaluating market size and opportunity...' });
    const opportunity = parseJSON(await callPerplexity(PROMPTS.opportunity(idea)));
    send('opportunity', opportunity);

    send('status', { phase: 'deployment', message: 'Identifying optimal deployment strategy...' });
    const deployment = parseJSON(await callPerplexity(PROMPTS.deployment(idea)));
    send('deployment', deployment);

    send('status', { phase: 'sentiment', message: 'Gathering public sentiment from Reddit...' });
    const competitors = market.competitors || [];
    const sentimentData = [];
    for (const competitor of competitors.slice(0, 3)) {
      const posts = await searchReddit(`${competitor.name} review alternative`);
      if (posts.length > 0) sentimentData.push({ competitor: competitor.name, posts: posts.slice(0, 3) });
    }
    const topicPosts = await searchReddit(idea.substring(0, 60));
    if (topicPosts.length > 0) sentimentData.push({ competitor: 'General Buzz', posts: topicPosts.slice(0, 3) });
    send('sentiment', { results: sentimentData });

    send('complete', { idea, skillLevel, timestamp: new Date().toISOString() });
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨  Vibe Check is live!`);
  console.log(`🚀  Open → http://localhost:${PORT}\n`);
});
