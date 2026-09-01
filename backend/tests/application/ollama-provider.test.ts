/**
 * Tests for OllamaProvider — the local, key-less AI provider.
 *
 * What matters here:
 *  - it is OFF unless OLLAMA_MODEL is explicitly set (no silent localhost
 *    probing on servers / CI / tests without Ollama);
 *  - it talks to Ollama's real /api/chat contract (stream:false, messages,
 *    options.num_predict) and reads message.content back;
 *  - a down/unreachable Ollama surfaces as a thrown provider error, so the
 *    AIOrchestrator falls back like it does for any other provider;
 *  - detectAvailableProviders() prefers it over the paid providers, and
 *    reports it in `configured` when on, `blocked` when off.
 */

import { OllamaProvider, detectAvailableProviders } from '../../src/application/ai-providers';

const ENV_KEYS = ['OLLAMA_MODEL', 'OLLAMA_HOST', 'OLLAMA_MODEL_REASONING', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

describe('OllamaProvider', () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: jest.Mock;

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  describe('isConfigured — opt-in only', () => {
    it('is false when OLLAMA_MODEL is not set', () => {
      expect(new OllamaProvider().isConfigured).toBe(false);
    });

    it('is true once OLLAMA_MODEL is set', () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      expect(new OllamaProvider().isConfigured).toBe(true);
    });
  });

  describe('selectModel', () => {
    it('uses OLLAMA_MODEL for every tier by default', () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      const p = new OllamaProvider();
      expect(p.selectModel('fast')).toBe('llama3.2');
      expect(p.selectModel('balanced')).toBe('llama3.2');
      expect(p.selectModel('reasoning')).toBe('llama3.2');
    });

    it('uses OLLAMA_MODEL_REASONING for the reasoning tier only, when set', () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      process.env['OLLAMA_MODEL_REASONING'] = 'llama3.1:70b';
      const p = new OllamaProvider();
      expect(p.selectModel('fast')).toBe('llama3.2');
      expect(p.selectModel('reasoning')).toBe('llama3.1:70b');
    });
  });

  describe('complete', () => {
    it('throws NOT_EXECUTABLE when OLLAMA_MODEL is absent', async () => {
      await expect(new OllamaProvider().complete({ prompt: 'hi', model: 'llama3.2' }))
        .rejects.toThrow(/NOT_EXECUTABLE/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts Ollama\'s /api/chat contract and parses message.content', async () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { role: 'assistant', content: 'bonjour' },
          prompt_eval_count: 11,
          eval_count: 4,
        }),
      });

      const res = await new OllamaProvider().complete({
        prompt: 'dis bonjour',
        model: 'llama3.2',
        systemPrompt: 'tu es concis',
        temperature: 0.1,
        maxTokens: 64,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:11434/api/chat');
      const body = JSON.parse((init as { body: string }).body);
      expect(body.model).toBe('llama3.2');
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: 'system', content: 'tu es concis' },
        { role: 'user', content: 'dis bonjour' },
      ]);
      expect(body.options.temperature).toBe(0.1);
      expect(body.options.num_predict).toBe(64);

      expect(res.content).toBe('bonjour');
      expect(res.providerName).toBe('ollama');
      expect(res.tokensUsed).toBe(15);
    });

    it('honours OLLAMA_HOST', async () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      process.env['OLLAMA_HOST'] = 'http://192.168.1.50:11434/';
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'x' } }) });
      await new OllamaProvider().complete({ prompt: 'p', model: 'llama3.2' });
      expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.50:11434/api/chat');
    });

    it('a network failure becomes a thrown provider error (orchestrator can fall back)', async () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(new OllamaProvider().complete({ prompt: 'p', model: 'llama3.2' }))
        .rejects.toThrow(/cannot reach Ollama/);
    });

    it('a non-2xx response throws with the status', async () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'model not found' });
      await expect(new OllamaProvider().complete({ prompt: 'p', model: 'nope' }))
        .rejects.toThrow(/HTTP 404/);
    });
  });

  describe('detectAvailableProviders — Ollama is preferred and reported', () => {
    it('is blocked (named) when OLLAMA_MODEL is not set', () => {
      const d = detectAvailableProviders();
      expect(d.configured).not.toContain('ollama');
      expect(d.blocked.some((b) => b.startsWith('ollama'))).toBe(true);
    });

    it('when set, it is first in priority and marked real', () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      const d = detectAvailableProviders();
      expect(d.status).toBe('real');
      expect(d.configured).toContain('ollama');
      expect(d.providers[0]?.name).toBe('ollama');
    });

    it('ranks ahead of a configured paid provider', () => {
      process.env['OLLAMA_MODEL'] = 'llama3.2';
      process.env['ANTHROPIC_API_KEY'] = 'sk-test';
      const d = detectAvailableProviders();
      expect(d.providers.map((p) => p.name)).toEqual(['ollama', 'anthropic']);
    });
  });
});
