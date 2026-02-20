import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

// In-memory result store for shareable links (survives for the server's lifetime)
const resultStore = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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

  technical: (idea, skillLevel) => `Analyze the technical complexity of building: "${idea}"
The developer's skill level is: ${skillLevel}

Return JSON with this exact structure (no other text):
{
  "difficulty": "no_code|beginner|intermediate|advanced|expert",
  "difficulty_score": 1-10,
  "technical_summary": "2-3 sentence overview tailored to a ${skillLevel} developer",
  "time_estimates": {
    "vibe_coder": "X weeks/months",
    "beginner": "X weeks/months",
    "intermediate": "X weeks/months",
    "senior_dev": "X weeks"
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

  sentiment: (idea) => `Search forums like Reddit (r/entrepreneur, r/startups, product-specific subreddits), Hacker News, Product Hunt comments, and app store reviews for real user opinions about existing products similar to: "${idea}"

Find authentic quotes or close paraphrases of what real people say. Focus on:
1. Pain points — what frustrates users about current solutions
2. Loved features — what users genuinely praise about existing products
3. Wish list — features people are asking for that don't exist yet

Return JSON with this exact structure (no other text):
{
  "community_insights": [
    {
      "quote": "Direct or close paraphrase of real user comment",
      "sentiment": "pain_point|loved_feature|wish",
      "theme": "Short theme (3-5 words)",
      "source": "e.g. r/entrepreneur, Hacker News, Product Hunt"
    }
  ]
}

Include 6-9 diverse insights spread across all three sentiment types. Make quotes feel specific and authentic.`,
};

// ── SSE ENDPOINT ────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { idea, skillLevel = 'beginner' } = req.body;
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

    send('status', { phase: 'technical', message: 'Analyzing technical complexity...' });
    const techData = parseJSON(await callPerplexity(PROMPTS.technical(idea, skillLevel)));
    send('technical', techData);

    send('status', { phase: 'opportunity', message: 'Scoring the opportunity...' });
    const oppData = parseJSON(await callPerplexity(PROMPTS.opportunity(idea)));
    send('opportunity', oppData);

    send('status', { phase: 'deployment', message: 'Finding best deployment options...' });
    const deployData = parseJSON(await callPerplexity(PROMPTS.deployment(idea)));
    send('deployment', deployData);

    send('status', { phase: 'sentiment', message: 'Scanning community discussions...' });
    const sentimentData = parseJSON(await callPerplexity(PROMPTS.sentiment(idea)));
    send('sentiment', sentimentData);

    // Store full result for shareable links
    const resultId = randomUUID();
    resultStore.set(resultId, {
      idea, skillLevel,
      market: marketData,
      technical: techData,
      opportunity: oppData,
      deployment: deployData,
      sentiment: sentimentData,
      createdAt: new Date().toISOString(),
    });

    send('complete', { resultId });
  } catch (err) {
    console.error('Analysis error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── SHARED RESULT ENDPOINT ──────────────────────
app.get('/api/result/:id', (req, res) => {
  const result = resultStore.get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found or expired' });
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vibe Check server running on port ${PORT}`));
