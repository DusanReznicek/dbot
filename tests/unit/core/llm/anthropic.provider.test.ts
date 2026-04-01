import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../../../src/core/llm/anthropic.provider.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
        stream: vi.fn(),
      },
    })),
    __mockCreate: mockCreate,
  };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@anthropic-ai/sdk');
    mockCreate = (mod as any).__mockCreate;

    provider = new AnthropicProvider({
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
    });
  });

  it('has correct id', () => {
    expect(provider.id).toBe('anthropic');
  });

  it('chat() returns LLMResponse', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Ahoj!' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    });

    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Ahoj!');
    expect(response.model).toBe('claude-sonnet-4-20250514');
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(5);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.finishReason).toBe('end_turn');
    expect(response.toolCalls).toBeUndefined();
  });

  it('chat() separates system prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Ok' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 20, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.chat(
      [{ role: 'user', content: 'test' }],
      { systemPrompt: 'You are helpful' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'test' }],
      }),
    );
  });

  it('chat() handles tool use blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Let me search for that.' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { query: 'test' } },
      ],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 15, output_tokens: 20 },
      stop_reason: 'tool_use',
    });

    const response = await provider.chat(
      [{ role: 'user', content: 'Search for test' }],
      { tools: [{ name: 'search', description: 'Search', parameters: {} }] },
    );

    expect(response.content).toBe('Let me search for that.');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe('search');
    expect(response.toolCalls![0].arguments).toEqual({ query: 'test' });
  });

  it('chat() extracts system from ChatMessage array', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Ok' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.chat([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Be brief',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    );
  });

  it('getTokenCount returns reasonable estimate', () => {
    const count = provider.getTokenCount('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('throws without API key', () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider({ model: 'claude-sonnet-4-20250514' })).toThrow('API key');
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});
