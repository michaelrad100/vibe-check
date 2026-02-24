import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
app.use(express.json());
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
  return json.choices[0].message.content;
}

// ── JSON PARSER ─────────────────────────────────
function parseJSON(text) {
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  throw new Error('Could not parse JSON from Perplexity response');
}

// ── PROMPTS ─────────────────────────────────────
const PROMPTS = {

  market: (idea) => `Analyze the market for this product idea: "${idea}"

Return JSON with this exact structure (no other text):
{
  "exists": "fully_exists|mostly_exists|partially_exists|significant_gap|blue_ocean",
  "saturation_score": 1-10,
  "market_summary": "2-3 sentence market overview with specific data points",
  "competitors": [
    {"name":"","url":"","description":"","pricing":"","strengths":["",""],"weaknesses":["",""]}
  ],
  "key_differentiators_needed": ["differentiator1","differentiator2","differentiator3"]
}

Include 4-6 real competitors with actual URLs. Be specific and data-driven.`,

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

  opportunity: (idea) => `Assess the market opportunity for: "${idea}"

Return JSON with this exact structure (no other text):
{
  "opportunity_grade": "A|B|C|D|F",
  "opportunity_score": 1-10,
  "opportunity_summary": "One strong compelling sentence",
  "opportunity_type": "blue_ocean|niche_product|competitive_market|emerging_market|saturated_market",
  "trend": "rapidly_growing|growing|stable|declining|emerging",
  "market_size": "One sentence with specific market size and growth rate data",
  "target_audiences": [
    {"segment":"","size":"small|medium|large","willingness_to_pay":"low|medium|high"}
  ],
  "monetization_strategies": [
    {"model":"","description":"","revenue_potential":"Low (<$10k MRR)|Medium ($10-100k MRR)|High (>$100k MRR)"}
  ],
  "improvement_suggestions": [
    {"suggestion":"","reasoning":"","priority":"high|medium|low","effort":"low|medium|high"}
  ]
}`,

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

  sentiment: (idea, competitorNames = []) => {
    const competitorList = competitorNames.length > 0
      ? `Focus specifically on these known competitors: ${competitorNames.join(', ')}. Search for real user comments, reviews, and discussions about these specific products.`
      : `Search for real user opinions about existing apps and products that are direct competitors to the idea.`;
    return `Search Reddit (r/entrepreneur, r/startups, r/SaaS, and topic-specific subreddits), Hacker News, Product Hunt comments, and app store reviews for real user opinions about this product space: "${idea}"

${competitorList}

Find specific quotes where users discuss their experience with these competing products — what frustrates them, what they love, what they wish existed. Aim to include a variety of different competitors across your findings (ideally no single competitor mentioned more than twice).

IMPORTANT: Only include quotes that are specifically about product experiences with real competing apps, NOT generic topic discussions.

Return JSON with this exact structure (no other text):
{
  "community_insights": [
    {
      "quote": "Direct or close paraphrase of a real user comment about a specific competing product",
      "sentiment": "pain_point|loved_feature|wish",
      "theme": "Short theme label (3-5 words)",
      "source": "e.g. r/entrepreneur, Hacker News, App Store",
      "source_url": "Direct URL to the post or thread if available, otherwise null",
      "competitor_reference": "Name of the specific competitor app being discussed, or null if this is a general observation about the space"
    }
  ]
}

Include 6-9 insights spread across all three sentiment types (at least 2 pain_point, 2 loved_feature, 2 wish). Quotes must be about real competing products, not general topics.`;
  },
};

// ── SSE ENDPOINT ────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { idea, skillLevel = 'first_project' } = req.body;
  if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('status', { phase: 'market', message: 'Researching market landscape...' });
    const marketData = parseJSON(await callPerplexity(PROMPTS.market(idea)));
    send('market', marketData);
    const competitorNames = (marketData.competitors || []).map(c => c.name).filter(Boolean);

    send('status', { phase: 'technical', message: 'Analyzing technical complexity...' });
    const techData = parseJSON(await callPerplexity(PROMPTS.technical(idea)));
    send('technical', techData);

    send('status', { phase: 'opportunity', message: 'Scoring the opportunity...' });
    const oppData = parseJSON(await callPerplexity(PROMPTS.opportunity(idea)));
    send('opportunity', oppData);

    send('status', { phase: 'deployment', message: 'Finding best deployment options...' });
    const deployData = parseJSON(await callPerplexity(PROMPTS.deployment(idea)));
    send('deployment', deployData);

    send('status', { phase: 'sentiment', message: 'Scanning community discussions...' });
    const sentimentData = parseJSON(await callPerplexity(PROMPTS.sentiment(idea, competitorNames)));
    send('sentiment', sentimentData);

    // Store full result for shareable links
    const resultId = randomUUID();
    const resultPayload = {
      id: resultId,
      idea,
      skill_level: skillLevel,
      market: marketData,
      technical: techData,
      opportunity: oppData,
      deployment: deployData,
      sentiment: sentimentData,
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
      market: data.market,
      technical: data.technical,
      opportunity: data.opportunity,
      deployment: data.deployment,
      sentiment: data.sentiment,
    });
  }
  // Fallback to in-memory store
  const result = resultStore.get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found or expired' });
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vibe Check server running on port ${PORT}`));
