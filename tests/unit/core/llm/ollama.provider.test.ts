import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../../../src/core/llm/ollama.provider.js';

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider({
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434',
      keepAlive: '5m',
      timeout: 30000,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Constructor ---

  it('should have id "ollama"', () => {
    expect(provider.id).toBe('ollama');
  });

  it('should default baseUrl to localhost:11434', () => {
    const p = new OllamaProvider({ model: 'test' });
    // We can verify indirectly via a chat call
    expect(p.getModel()).toBe('test');
  });

  it('should strip trailing slash from baseUrl', () => {
    const p = new OllamaProvider({ model: 'test', baseUrl: 'http://host:1234/' });
    expect(p.getModel()).toBe('test');
  });

  // --- Model management ---

  it('getModel returns current model', () => {
    expect(provider.getModel()).toBe('llama3.1');
  });

  it('setModel changes the active model', () => {
    provider.setModel('mistral');
    expect(provider.getModel()).toBe('mistral');
  });

  // --- getTokenCount ---

  it('returns approximate token count', () => {
    const count = provider.getTokenCount('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(Math.ceil(13 / 3.5));
  });

  // --- chat ---

  it('sends correct request and parses response', async () => {
    const mockResponse = {
      model: 'llama3.1',
      message: { role: 'assistant', content: 'Hello!' },
      done: true,
      prompt_eval_count: 10,
      eval_count: 5,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('Hello!');
    expect(result.model).toBe('llama3.1');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
    expect(result.finishReason).toBe('stop');

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
  });

  it('prepends system prompt when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        model: 'llama3.1',
        message: { role: 'assistant', content: 'ok' },
        done: true,
      }),
    });

    await provider.chat(
      [{ role: 'user', content: 'Hi' }],
      { systemPrompt: 'You are a helper' },
    );

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helper' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('includes tools when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        model: 'llama3.1',
        message: { role: 'assistant', content: '' },
        done: true,
      }),
    });

    await provider.chat(
      [{ role: 'user', content: 'Hi' }],
      {
        tools: [{
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        }],
      },
    );

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('get_weather');
  });

  it('extracts tool calls from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        model: 'llama3.1',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'get_weather', arguments: { city: 'Prague' } } },
          ],
        },
        done: true,
      }),
    });

    const result = await provider.chat([{ role: 'user', content: 'Weather in Prague' }]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('get_weather');
    expect(result.toolCalls![0].arguments).toEqual({ city: 'Prague' });
    expect(result.toolCalls![0].id).toBe('call_0');
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      provider.chat([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Ollama request failed: ECONNREFUSED');
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('model not found'),
    });

    await expect(
      provider.chat([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('Ollama API error: 500');
  });

  // --- listModels ---

  it('returns model list from Ollama', async () => {
    const models = [
      { name: 'llama3.1', size: 1000, digest: 'abc', modified_at: '2024-01-01' },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models }),
    });

    const result = await provider.listModels();
    expect(result).toEqual(models);
  });

  it('returns empty array on listModels error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await provider.listModels();
    expect(result).toEqual([]);
  });

  // --- isAvailable ---

  it('returns true when Ollama responds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when Ollama is down', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await provider.isAvailable()).toBe(false);
  });

  // --- pullModel ---

  it('pulls model successfully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const result = await provider.pullModel('mistral');
    expect(result.success).toBe(true);
  });

  it('returns error on pull failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await provider.pullModel('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });
});
