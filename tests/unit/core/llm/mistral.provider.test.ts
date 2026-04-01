import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MistralProvider } from '../../../../src/core/llm/mistral.provider.js';

// Mock the Mistral SDK
vi.mock('@mistralai/mistralai', () => {
  const mockComplete = vi.fn();
  const mockStream = vi.fn();
  return {
    Mistral: vi.fn().mockImplementation(() => ({
      chat: {
        complete: mockComplete,
        stream: mockStream,
      },
    })),
    __mockComplete: mockComplete,
    __mockStream: mockStream,
  };
});

describe('MistralProvider', () => {
  let provider: MistralProvider;
  let mockComplete: ReturnType<typeof vi.fn>;
  let mockStream: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@mistralai/mistralai');
    mockComplete = (mod as any).__mockComplete;
    mockStream = (mod as any).__mockStream;

    provider = new MistralProvider({
      model: 'mistral-large-latest',
      apiKey: 'test-key',
    });
  });

  it('has correct id', () => {
    expect(provider.id).toBe('mistral');
  });

  it('chat() returns LLMResponse', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{
        message: { content: 'Bonjour!', toolCalls: undefined },
        finishReason: 'stop',
      }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Bonjour!');
    expect(response.model).toBe('mistral-large-latest');
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(5);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.finishReason).toBe('stop');
    expect(response.toolCalls).toBeUndefined();
  });

  it('chat() passes system prompt as first message', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: 'Ok' }, finishReason: 'stop' }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 20, completionTokens: 1, totalTokens: 21 },
    });

    await provider.chat(
      [{ role: 'user', content: 'test' }],
      { systemPrompt: 'You are helpful' },
    );

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'test' },
        ],
      }),
    );
  });

  it('chat() handles tool calls with object arguments', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          toolCalls: [{
            id: 'tc_1',
            function: { name: 'search', arguments: { query: 'test' } },
          }],
        },
        finishReason: 'tool_calls',
      }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
    });

    const response = await provider.chat(
      [{ role: 'user', content: 'Search for test' }],
      { tools: [{ name: 'search', description: 'Search', parameters: {} }] },
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].id).toBe('tc_1');
    expect(response.toolCalls![0].name).toBe('search');
    expect(response.toolCalls![0].arguments).toEqual({ query: 'test' });
  });

  it('chat() handles tool calls with string arguments', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          toolCalls: [{
            id: 'tc_2',
            function: { name: 'get_weather', arguments: '{"city":"Prague"}' },
          }],
        },
        finishReason: 'tool_calls',
      }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });

    const response = await provider.chat(
      [{ role: 'user', content: 'Weather in Prague' }],
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].arguments).toEqual({ city: 'Prague' });
  });

  it('chat() passes tools in OpenAI-compatible format', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' }, finishReason: 'stop' }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
    });

    await provider.chat(
      [{ role: 'user', content: 'test' }],
      {
        tools: [{
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        }],
      },
    );

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a city',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        }],
      }),
    );
  });

  it('streamChat() yields chunks', async () => {
    const events = [
      { data: { choices: [{ delta: { content: 'Hello' }, finishReason: null }] } },
      { data: { choices: [{ delta: { content: ' world' }, finishReason: null }] } },
      { data: { choices: [{ delta: { content: '' }, finishReason: 'stop' }] } },
    ];

    mockStream.mockResolvedValueOnce((async function* () {
      for (const e of events) yield e;
    })());

    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of provider.streamChat([{ role: 'user', content: 'Hi' }])) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ content: 'Hello', done: false });
    expect(chunks[1]).toEqual({ content: ' world', done: false });
    expect(chunks[2]).toEqual({ content: '', done: true });
  });

  it('getTokenCount returns reasonable estimate', () => {
    const count = provider.getTokenCount('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('throws without API key', () => {
    const origKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      expect(() => new MistralProvider({ model: 'mistral-large-latest' })).toThrow('API key');
    } finally {
      if (origKey) process.env.MISTRAL_API_KEY = origKey;
    }
  });

  it('chat() handles empty response gracefully', async () => {
    mockComplete.mockResolvedValueOnce({
      choices: [{
        message: { content: null },
        finishReason: 'stop',
      }],
      model: 'mistral-large-latest',
      usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
    });

    const response = await provider.chat([{ role: 'user', content: 'test' }]);
    expect(response.content).toBe('');
  });
});
