import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callPerplexity } from '../server.js';

// Helper to build a minimal successful Perplexity API response
function mockOkResponse(content, citations = []) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      citations,
    }),
  };
}

function mockErrorResponse(status, body) {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

describe('callPerplexity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns content and citations on success', async () => {
    fetch.mockResolvedValue(mockOkResponse('{"grade":"A"}', ['https://example.com']));

    const result = await callPerplexity('analyze this idea');

    expect(result.content).toBe('{"grade":"A"}');
    expect(result.citations).toEqual(['https://example.com']);
  });

  it('returns an empty citations array when the API omits citations', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"x":1}' } }] }),
    });

    const result = await callPerplexity('test');
    expect(result.citations).toEqual([]);
  });

  it('calls the Perplexity endpoint with the correct URL', async () => {
    fetch.mockResolvedValue(mockOkResponse('{}'));

    await callPerplexity('my idea');

    const [url] = fetch.mock.calls[0];
    expect(url).toBe('https://api.perplexity.ai/chat/completions');
  });

  it('sends the sonar-pro model in the request body', async () => {
    fetch.mockResolvedValue(mockOkResponse('{}'));

    await callPerplexity('my idea');

    const [, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('sonar-pro');
  });

  it('includes the Authorization header with the API key', async () => {
    fetch.mockResolvedValue(mockOkResponse('{}'));

    await callPerplexity('my idea');

    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer test-perplexity-key');
  });

  it('passes the user message as the last message in the array', async () => {
    fetch.mockResolvedValue(mockOkResponse('{}'));

    await callPerplexity('specific user message');

    const [, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    const lastMsg = body.messages[body.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('specific user message');
  });

  it('throws on a 401 Unauthorized response', async () => {
    fetch.mockResolvedValue(mockErrorResponse(401, 'Unauthorized'));

    await expect(callPerplexity('test')).rejects.toThrow('Perplexity API error 401');
  });

  it('throws on a 429 rate-limit response', async () => {
    fetch.mockResolvedValue(mockErrorResponse(429, 'Rate limit exceeded'));

    await expect(callPerplexity('test')).rejects.toThrow('Perplexity API error 429');
  });

  it('throws on a 500 server error response', async () => {
    fetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

    await expect(callPerplexity('test')).rejects.toThrow('Perplexity API error 500');
  });

  it('propagates network-level errors (e.g. DNS failure)', async () => {
    fetch.mockRejectedValue(new Error('fetch failed'));

    await expect(callPerplexity('test')).rejects.toThrow('fetch failed');
  });
});
