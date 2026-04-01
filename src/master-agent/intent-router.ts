import type { AgentRegistry } from '../core/registry/agent.registry.js';
import type { ILLMProvider } from '../core/interfaces/llm.interface.js';
import { createLogger } from '../core/utils/logger.js';
import { resolveTemplate } from './prompt-template.js';

const logger = createLogger('IntentRouter');

export interface RouteResult {
  agentId: string | null;
  action: string;
  confidence: number;
}

// Keyword → capability mapping for hardcoded fallback routing
const KEYWORD_MAP: Array<{ keywords: string[]; capability: string }> = [
  {
    keywords: ['obsidian', 'poznámk', 'note', 'vault', 'markdown', 'md'],
    capability: 'obsidian',
  },
];

export class IntentRouter {
  private llmProvider: ILLMProvider | null = null;
  private metaPrompt: string | undefined;

  constructor(private agentRegistry: AgentRegistry) {}

  setMetaPrompt(prompt: string | undefined): void {
    this.metaPrompt = prompt;
    if (prompt) {
      logger.info({ length: prompt.length }, 'Meta prompt set on intent router');
    }
  }

  setLLMProvider(provider: ILLMProvider): void {
    this.llmProvider = provider;
    logger.info({ providerId: provider.id }, 'LLM provider set for intent routing');
  }

  async route(text: string): Promise<RouteResult> {
    // Try LLM-based routing first
    if (this.llmProvider) {
      try {
        const result = await this.routeWithLLM(text);
        if (result.agentId && result.confidence >= 0.5) {
          return result;
        }
        logger.debug({ text: text.slice(0, 80), confidence: result.confidence }, 'LLM routing low confidence — falling back to hardcoded');
      } catch (err) {
        logger.warn({ err }, 'LLM routing failed — falling back to hardcoded');
      }
    }

    // Fallback: hardcoded keyword matching
    return this.routeHardcoded(text);
  }

  private async routeWithLLM(text: string): Promise<RouteResult> {
    const agents = this.agentRegistry.getAll();
    if (agents.length === 0) {
      return { agentId: null, action: '', confidence: 0 };
    }

    const agentDescriptions = agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
    }));

    const routingPrompt = `You are an intent classifier for a personal AI assistant.
Given a user message, determine which agent should handle it.

Available agents:
${JSON.stringify(agentDescriptions, null, 2)}

Respond ONLY with a JSON object (no markdown, no code fences):
{"agentId": "agent-id-or-null", "action": "capability.action", "confidence": 0.0-1.0}

Rules:
- agentId must match an available agent's id, or null if no agent fits
- action must be one of the agent's capabilities
- confidence is your certainty (0.0 = no match, 1.0 = perfect match)
- If the message is a greeting or general chat, return agentId: null
- "obsidian.task" = adding a task/todo item (e.g. "Přidej úkol", "Add task")
- "obsidian.daily" = writing to today's daily note / logging (e.g. "Zapiš", "Daily note")
- "obsidian.write" = creating a completely new standalone note
- "obsidian.edit" = editing an existing note`;

    // Prepend meta prompt if configured
    let systemPrompt: string;
    if (this.metaPrompt) {
      const resolvedMeta = resolveTemplate(this.metaPrompt, {
        agents: agentDescriptions,
        date: new Date().toISOString().split('T')[0],
      });
      systemPrompt = `${resolvedMeta}\n\n${routingPrompt}`;
    } else {
      systemPrompt = routingPrompt;
    }

    const response = await this.llmProvider!.chat(
      [{ role: 'user', content: text }],
      {
        systemPrompt,
        temperature: 0,
        maxTokens: 150,
      },
    );

    try {
      // Strip potential markdown code fences
      const cleaned = response.content.replace(/```json?\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { agentId: string | null; action: string; confidence: number };

      // Validate the agentId exists
      if (parsed.agentId && !this.agentRegistry.has(parsed.agentId)) {
        logger.debug({ parsed }, 'LLM returned unknown agentId');
        return { agentId: null, action: '', confidence: 0 };
      }

      logger.debug(
        { agentId: parsed.agentId, action: parsed.action, confidence: parsed.confidence, text: text.slice(0, 80) },
        'Intent routed (LLM)',
      );

      return {
        agentId: parsed.agentId,
        action: parsed.action || '',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
      };
    } catch (err) {
      logger.warn({ err, raw: response.content.slice(0, 200) }, 'Failed to parse LLM routing response');
      return { agentId: null, action: '', confidence: 0 };
    }
  }

  private routeHardcoded(text: string): RouteResult {
    const normalizedText = text.toLowerCase();

    for (const entry of KEYWORD_MAP) {
      const matched = entry.keywords.some((kw) => normalizedText.includes(kw));
      if (matched) {
        const agent = this.findAgentForCapabilityPrefix(entry.capability);
        if (agent) {
          const action = this.inferAction(normalizedText, agent.capabilities);
          logger.debug(
            { agentId: agent.id, action, text: text.slice(0, 80) },
            'Intent routed (hardcoded)',
          );
          return { agentId: agent.id, action, confidence: 0.7 };
        }
      }
    }

    logger.debug({ text: text.slice(0, 80) }, 'No matching agent found');
    return { agentId: null, action: '', confidence: 0 };
  }

  private findAgentForCapabilityPrefix(prefix: string): { id: string; capabilities: string[] } | undefined {
    const agents = this.agentRegistry.getAll();
    for (const agent of agents) {
      if (agent.capabilities.some((cap) => cap.startsWith(prefix))) {
        return { id: agent.id, capabilities: agent.capabilities };
      }
    }
    return undefined;
  }

  private inferAction(text: string, capabilities: string[]): string {
    const actionKeywords: Record<string, string[]> = {
      daily: ['denní poznámk', 'denni poznamk', 'daily note', 'daily:'],
      task: ['úkol', 'ukol', 'task:', 'todo:'],
      write: ['vytvoř', 'přidej', 'zapiš', 'create', 'add', 'write'],
      read: ['přečti', 'ukaž', 'zobraz', 'read', 'show', 'display'],
      search: ['najdi', 'hledej', 'vyhledej', 'find', 'search'],
      list: ['seznam', 'vypiš', 'list'],
      sync: ['synchronizuj', 'sync', 'synchro'],
      edit: ['uprav', 'změň', 'edit', 'update', 'modify'],
    };

    for (const [action, keywords] of Object.entries(actionKeywords)) {
      if (keywords.some((kw) => text.includes(kw))) {
        const cap = capabilities.find((c) => c.endsWith(`.${action}`));
        if (cap) return cap;
      }
    }

    return capabilities[0] || '';
  }
}
