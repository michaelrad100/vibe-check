import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app, resultStore } from '../server.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePerplexityResponse(content) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
      citations: [],
    }),
  };
}

const MOCK_MARKET = {
  exists: 'mostly_exists',
  saturation_score: 7,
  market_summary: 'Competitive space.',
  competitors: [{ name: 'Notion', url: 'https://notion.so', description: 'Notes', pricing: 'free', strengths: [], weaknesses: [], app_store_rating: null }],
  key_differentiators_needed: ['real-time collaboration'],
  market_concentration: 'top_heavy',
  top_player: { name: 'Notion', share: 45 },
};

const MOCK_TECHNICAL = {
  difficulty: 'intermediate',
  difficulty_score: 6,
  technical_summary: 'Moderate build.',
  time_estimates: { first_project: '3 months', done_a_few: '6 weeks', build_regularly: '2 weeks' },
  tech_stack: { frontend: 'React', backend: 'Node', database: 'Postgres', hosting: 'Railway' },
  required_apis: [],
};

const MOCK_OPPORTUNITY = {
  short_title: 'AI Note Taker',
  opportunity_grade: 'B',
  opportunity_score: 7,
  grade_explanation: 'Strong demand with manageable competition.',
  opportunity_type: 'competitive_market',
  trend: 'growing',
  market_size: '$5B market growing 20% YoY.',
  market_size_current: { value: '$5B', year: 2026 },
  market_size_projected: { value: '$12B', year: 2033 },
  target_audiences: [{ segment: 'Students', size: 'large', willingness_to_pay: 'medium' }],
  monetization_strategies: [{ model: 'Subscription', description: 'Monthly plan', revenue_potential: 'Medium ($10-100k MRR)' }],
  improvement_suggestions: [],
  bottom_line: 'Proceed with a niche focus. Beat Notion on simplicity.',
  recommended_play: 'Target students with a freemium model.',
};

const MOCK_DEPLOYMENT = {
  primary_recommendation: 'web_app',
  quick_win_approach: 'Ship a web MVP first.',
  reasoning: 'Broadest reach.',
  deployment_options: [],
};

const MOCK_SENTIMENT = {
  community_insights: [
    {
      quote: 'Notion is too slow on mobile for quick note capture.',
      sentiment: 'pain_point',
      theme: 'Mobile performance',
      source: 'Reddit',
      source_url: null,
      competitor_reference: 'Notion',
    },
  ],
};

const MOCK_EARLY_STAGE = { early_stage_competitors: [] };
const MOCK_LAUNCH = { launch_channels: [], launch_tactics: [] };

// ─── POST /api/analyze — input validation ─────────────────────────────────────

describe('POST /api/analyze — input validation', () => {
  it('returns 400 when idea is missing', async () => {
    const res = await request(app).post('/api/analyze').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea is required/i);
  });

  it('returns 400 when idea is an empty string', async () => {
    const res = await request(app).post('/api/analyze').send({ idea: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea is required/i);
  });

  it('returns 400 when idea is only whitespace', async () => {
    const res = await request(app).post('/api/analyze').send({ idea: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea is required/i);
  });
});

// ─── POST /api/analyze — SSE streaming ────────────────────────────────────────

describe('POST /api/analyze — SSE streaming', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Each callPerplexity call returns one of our mock payloads in order:
    // market, technical, opportunity, deployment, sentiment, launch
    fetch
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_MARKET))
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_TECHNICAL))
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_OPPORTUNITY))
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_DEPLOYMENT))
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_SENTIMENT))
      .mockResolvedValueOnce(makePerplexityResponse(MOCK_LAUNCH));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resultStore.clear();
  });

  it('returns 200 with text/event-stream content-type', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ idea: 'An AI-powered note taking app' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('streams a market event with competitor data', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ idea: 'An AI-powered note taking app' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    const events = parseSSE(res.body);
    const marketEvent = events.find(e => e.event === 'market');
    expect(marketEvent).toBeDefined();
    expect(marketEvent.data.competitors[0].name).toBe('Notion');
  });

  it('streams an opportunity event with a grade', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ idea: 'An AI-powered note taking app' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    const events = parseSSE(res.body);
    const oppEvent = events.find(e => e.event === 'opportunity');
    expect(oppEvent).toBeDefined();
    expect(oppEvent.data.opportunity_grade).toBe('B');
    expect(oppEvent.data.short_title).toBe('AI Note Taker');
  });

  it('emits a complete event with a resultId UUID', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ idea: 'An AI-powered note taking app' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    const events = parseSSE(res.body);
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent.data.resultId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('stores the result in the in-memory store after completion', async () => {
    await request(app)
      .post('/api/analyze')
      .send({ idea: 'An AI-powered note taking app' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(resultStore.size).toBe(1);
    const [stored] = [...resultStore.values()];
    expect(stored.idea).toBe('An AI-powered note taking app');
  });
});

// ─── GET /api/result/:id ──────────────────────────────────────────────────────

describe('GET /api/result/:id', () => {
  afterEach(() => {
    resultStore.clear();
  });

  it('returns 404 for an unknown result id', async () => {
    const res = await request(app).get('/api/result/non-existent-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns the stored result by id', async () => {
    const id = 'test-uuid-1234';
    resultStore.set(id, {
      id,
      idea: 'A task management app',
      skill_level: 'first_project',
      mode: 'market',
      market: MOCK_MARKET,
      technical: MOCK_TECHNICAL,
      opportunity: MOCK_OPPORTUNITY,
      deployment: MOCK_DEPLOYMENT,
      sentiment: MOCK_SENTIMENT,
      early_stage: MOCK_EARLY_STAGE,
      launch_intel: MOCK_LAUNCH,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/result/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.idea).toBe('A task management app');
    expect(res.body.market.competitors[0].name).toBe('Notion');
  });
});

// ─── GET /api/count ───────────────────────────────────────────────────────────

describe('GET /api/count', () => {
  afterEach(() => {
    resultStore.clear();
  });

  it('returns 0 when the store is empty', async () => {
    const res = await request(app).get('/api/count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('returns the correct count after results are added', async () => {
    resultStore.set('id-1', { id: 'id-1', idea: 'Idea 1', opportunity: {} });
    resultStore.set('id-2', { id: 'id-2', idea: 'Idea 2', opportunity: {} });

    const res = await request(app).get('/api/count');
    expect(res.body.count).toBe(2);
  });
});

// ─── GET /api/results ─────────────────────────────────────────────────────────

describe('GET /api/results', () => {
  afterEach(() => {
    resultStore.clear();
  });

  it('returns an empty results array when the store is empty', async () => {
    const res = await request(app).get('/api/results');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns stored results with id, idea, grade, type, explanation fields', async () => {
    resultStore.set('id-1', {
      id: 'id-1',
      idea: 'A parking spot marketplace',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/results');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    const item = res.body.results[0];
    expect(item.id).toBe('id-1');
    expect(item.idea).toBe('A parking spot marketplace');
    expect(item.grade).toBe('B');
    expect(item.type).toBe('competitive_market');
    expect(item.explanation).toBeTruthy();
  });

  it('filters out NSFW ideas', async () => {
    resultStore.set('clean-id', {
      id: 'clean-id',
      idea: 'A recipe discovery app',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });
    resultStore.set('nsfw-id', {
      id: 'nsfw-id',
      idea: 'A porn streaming platform',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/results');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe('clean-id');
  });

  it('deduplicates results with the same normalized idea', async () => {
    const ts1 = new Date(Date.now() - 2000).toISOString();
    const ts2 = new Date(Date.now() - 1000).toISOString();
    resultStore.set('old-id', {
      id: 'old-id',
      idea: 'AI Recipe App',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: ts1,
    });
    resultStore.set('new-id', {
      id: 'new-id',
      idea: 'ai recipe app',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: ts2,
    });

    const res = await request(app).get('/api/results');
    expect(res.body.results).toHaveLength(1);
  });

  it('respects the limit query parameter', async () => {
    for (let i = 1; i <= 5; i++) {
      resultStore.set(`id-${i}`, {
        id: `id-${i}`,
        idea: `Unique idea number ${i}`,
        opportunity: MOCK_OPPORTUNITY,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    const res = await request(app).get('/api/results?limit=3');
    expect(res.body.results).toHaveLength(3);
    expect(res.body.hasMore).toBe(true);
  });

  it('respects the offset query parameter for pagination', async () => {
    for (let i = 1; i <= 4; i++) {
      resultStore.set(`id-${i}`, {
        id: `id-${i}`,
        idea: `Unique idea number ${i}`,
        opportunity: MOCK_OPPORTUNITY,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    const res = await request(app).get('/api/results?limit=2&offset=2');
    expect(res.body.results).toHaveLength(2);
    expect(res.body.hasMore).toBe(false);
  });

  it('caps limit at 50', async () => {
    for (let i = 1; i <= 5; i++) {
      resultStore.set(`id-${i}`, {
        id: `id-${i}`,
        idea: `Unique idea number ${i}`,
        opportunity: MOCK_OPPORTUNITY,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    const res = await request(app).get('/api/results?limit=1000');
    // limit is capped at 50, so all 5 come back
    expect(res.body.results).toHaveLength(5);
  });

  it('strips citation numbers from explanation text', async () => {
    resultStore.set('cite-id', {
      id: 'cite-id',
      idea: 'A citation-heavy idea',
      opportunity: {
        ...MOCK_OPPORTUNITY,
        grade_explanation: 'Strong demand [1] with growing market [2].',
      },
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/results');
    const item = res.body.results[0];
    expect(item.explanation).not.toMatch(/\[\d+\]/);
    expect(item.explanation).toBe('Strong demand  with growing market .');
  });
});

// ─── GET /api/og/:id ──────────────────────────────────────────────────────────

describe('GET /api/og/:id', () => {
  afterEach(() => {
    resultStore.clear();
  });

  it('returns an SVG image with content-type image/svg+xml', async () => {
    resultStore.set('og-id', {
      id: 'og-id',
      idea: 'Test idea',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/og/og-id').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(res.body.toString()).toContain('<svg');
  });

  it('includes the grade letter in the SVG', async () => {
    resultStore.set('og-id', {
      id: 'og-id',
      idea: 'Test idea',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/og/og-id').buffer(true);
    expect(res.body.toString()).toContain('>B<');
  });

  it('includes the short title in the SVG', async () => {
    resultStore.set('og-id', {
      id: 'og-id',
      idea: 'Test idea',
      opportunity: MOCK_OPPORTUNITY,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/og/og-id').buffer(true);
    expect(res.body.toString()).toContain('AI Note Taker');
  });

  it('returns SVG with fallback grade ? for unknown result id', async () => {
    const res = await request(app).get('/api/og/does-not-exist').buffer(true);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('>?<');
  });
});

// ─── Utility: SSE parser ──────────────────────────────────────────────────────

function parseSSE(rawText) {
  const events = [];
  const blocks = rawText.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) data = line.slice(6).trim();
    }
    if (data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }
  return events;
}
