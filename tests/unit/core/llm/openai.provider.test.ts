import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../../../src/core/llm/openai.provider.js';

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    __mockCreate: mockCreate,
  };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('openai');
    mockCreate = (mod as any).__mockCreate;

    provider = new OpenAIProvider({
      model: 'gpt-4o',
      apiKey: 'test-key',
    });
  });

  it('has correct id', () => {
    expect(provider.id).toBe('openai');
  });

  it('chat() returns LLMResponse', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: { content: 'Hello!', tool_calls: undefined },
        finish_reason: 'stop',
      }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Hello!');
    expect(response.model).toBe('gpt-4o');
    expect(response.usage.totalTokens).toBe(15);
    expect(response.finishReason).toBe('stop');
    expect(response.toolCalls).toBeUndefined();
  });

  it('chat() passes system prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Ok' }, finish_reason: 'stop' }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
    });

    await provider.chat(
      [{ role: 'user', content: 'test' }],
      { systemPrompt: 'You are helpful' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'test' },
        ]),
      }),
    );
  });

  it('chat() handles tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'tc_1',
            function: { name: 'search', arguments: '{"query":"test"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
    });

    const response = await provider.chat(
      [{ role: 'user', content: 'Search for test' }],
      { tools: [{ name: 'search', description: 'Search', parameters: {} }] },
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe('search');
    expect(response.toolCalls![0].arguments).toEqual({ query: 'test' });
  });

  it('getTokenCount returns reasonable estimate', () => {
    const count = provider.getTokenCount('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('throws without API key', () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIProvider({ model: 'gpt-4o' })).toThrow('API key');
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });
});
