import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentRouter } from '../../../src/master-agent/intent-router.js';
import { AgentRegistry } from '../../../src/core/registry/agent.registry.js';
import type { ISubAgent } from '../../../src/core/interfaces/agent.interface.js';
import type { ILLMProvider, LLMResponse } from '../../../src/core/interfaces/llm.interface.js';
import type { AgentMessage, AgentResponse } from '../../../src/core/interfaces/message.interface.js';

function createMockAgent(id: string, capabilities: string[]): ISubAgent {
  return {
    id,
    name: `Test ${id}`,
    description: `Test agent ${id}`,
    capabilities,
    requiredSkills: [],
    initialize: async () => {},
    handleMessage: async (_msg: AgentMessage): Promise<AgentResponse> => ({
      id: 'resp',
      timestamp: Date.now(),
      agentId: id,
      conversationId: 'conv',
      text: 'ok',
    }),
    shutdown: async () => {},
    getHealthStatus: () => ({ healthy: true, uptime: 0 }),
  };
}

function createMockLLMProvider(response: Partial<LLMResponse> = {}): ILLMProvider {
  return {
    id: 'mock-llm',
    chat: vi.fn().mockResolvedValue({
      content: '{"agentId": null, "action": "", "confidence": 0}',
      model: 'mock',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      ...response,
    }),
    streamChat: vi.fn(),
    getTokenCount: (text: string) => Math.ceil(text.length / 3.5),
  };
}

describe('IntentRouter', () => {
  let registry: AgentRegistry;
  let router: IntentRouter;

  beforeEach(() => {
    registry = new AgentRegistry();
    router = new IntentRouter(registry);
  });

  // ---- Hardcoded routing (fallback) ----

  it('routes Obsidian keyword to obsidian-agent (hardcoded)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write', 'obsidian.search']),
    );

    const result = await router.route('Přidej poznámku do Obsidianu');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.write');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('routes "vault" keyword (hardcoded)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write']),
    );

    const result = await router.route('Show me my vault');
    expect(result.agentId).toBe('obsidian-agent');
  });

  it('routes search intent (hardcoded)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write', 'obsidian.search']),
    );

    const result = await router.route('Najdi poznámku o meetingu');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.search');
  });

  it('returns null for unknown intent (hardcoded)', async () => {
    const result = await router.route('Jaké je počasí?');
    expect(result.agentId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns null when keyword matches but no agent registered', async () => {
    const result = await router.route('Přidej poznámku do Obsidianu');
    expect(result.agentId).toBeNull();
  });

  it('defaults to first capability when no action keyword matches', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write']),
    );

    const result = await router.route('Obsidian something random');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.read');
  });

  // ---- LLM-based routing ----

  it('uses LLM provider when set and returns high-confidence result', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write']),
    );

    const llm = createMockLLMProvider({
      content: '{"agentId": "obsidian-agent", "action": "obsidian.write", "confidence": 0.95}',
    });
    router.setLLMProvider(llm);

    const result = await router.route('Vytvoř poznámku');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.write');
    expect(result.confidence).toBe(0.95);
    expect(llm.chat).toHaveBeenCalled();
  });

  it('falls back to hardcoded when LLM confidence is low', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write']),
    );

    const llm = createMockLLMProvider({
      content: '{"agentId": "obsidian-agent", "action": "obsidian.read", "confidence": 0.3}',
    });
    router.setLLMProvider(llm);

    const result = await router.route('Přidej do vault');
    // Should use hardcoded because LLM confidence < 0.5
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.confidence).toBe(0.7); // hardcoded confidence
  });

  it('falls back to hardcoded when LLM throws', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read']),
    );

    const llm = createMockLLMProvider();
    (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));
    router.setLLMProvider(llm);

    const result = await router.route('Ukaž obsidian poznámky');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.confidence).toBe(0.7); // hardcoded fallback
  });

  it('falls back when LLM returns invalid JSON', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read']),
    );

    const llm = createMockLLMProvider({
      content: 'I think you should use the obsidian agent',
    });
    router.setLLMProvider(llm);

    const result = await router.route('Přečti vault');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.confidence).toBe(0.7); // hardcoded fallback
  });

  it('rejects LLM result with unknown agentId', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read']),
    );

    const llm = createMockLLMProvider({
      content: '{"agentId": "nonexistent-agent", "action": "foo", "confidence": 0.9}',
    });
    router.setLLMProvider(llm);

    const result = await router.route('Some query with obsidian');
    // LLM returned unknown agent → falls back to hardcoded
    expect(result.agentId).toBe('obsidian-agent');
  });

  // ---- Task / Daily routing (hardcoded) ----

  it('routes "Přidej úkol" to obsidian.task (hardcoded)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', [
        'obsidian.read', 'obsidian.write', 'obsidian.search',
        'obsidian.task', 'obsidian.daily',
      ]),
    );

    const result = await router.route('Přidej úkol: koupit mléko v Obsidianu');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.task');
  });

  it('routes "Denní poznámka" to obsidian.daily (hardcoded)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', [
        'obsidian.read', 'obsidian.write', 'obsidian.search',
        'obsidian.task', 'obsidian.daily',
      ]),
    );

    const result = await router.route('Denní poznámka: meeting s týmem v Obsidianu');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.daily');
  });

  it('routes "Vytvoř poznámku" to obsidian.write (not task)', async () => {
    registry.register(
      createMockAgent('obsidian-agent', [
        'obsidian.read', 'obsidian.write', 'obsidian.search',
        'obsidian.task', 'obsidian.daily',
      ]),
    );

    const result = await router.route('Vytvoř poznámku Tasks v Obsidianu');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.action).toBe('obsidian.write');
  });

  it('handles LLM response with code fences', async () => {
    registry.register(
      createMockAgent('obsidian-agent', ['obsidian.read', 'obsidian.write']),
    );

    const llm = createMockLLMProvider({
      content: '```json\n{"agentId": "obsidian-agent", "action": "obsidian.write", "confidence": 0.9}\n```',
    });
    router.setLLMProvider(llm);

    const result = await router.route('Create a note');
    expect(result.agentId).toBe('obsidian-agent');
    expect(result.confidence).toBe(0.9);
  });
});
