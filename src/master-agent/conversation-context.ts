import type { UserMessage, AgentResponse } from '../core/interfaces/message.interface.js';
import type { ChatMessage } from '../core/interfaces/llm.interface.js';

export interface ConversationEntry {
  userMessage: UserMessage;
  agentResponse: AgentResponse;
  timestamp: number;
}

export interface ConversationState {
  conversationId: string;
  activeAgentId: string | null;
  entries: ConversationEntry[];
  createdAt: number;
  lastActivityAt: number;
}

const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_TOKENS = 8000; // conservative default for context window

export class ConversationContext {
  private conversations = new Map<string, ConversationState>();
  private maxEntries: number;
  private ttl: number;
  private maxContextTokens: number;

  constructor(
    maxEntries: number = DEFAULT_MAX_ENTRIES,
    ttl: number = DEFAULT_TTL,
    maxContextTokens: number = DEFAULT_MAX_TOKENS,
  ) {
    this.maxEntries = maxEntries;
    this.ttl = ttl;
    this.maxContextTokens = maxContextTokens;
  }

  getOrCreate(conversationId: string): ConversationState {
    let state = this.conversations.get(conversationId);
    if (!state) {
      state = {
        conversationId,
        activeAgentId: null,
        entries: [],
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.conversations.set(conversationId, state);
    }
    return state;
  }

  addEntry(conversationId: string, userMessage: UserMessage, agentResponse: AgentResponse): void {
    const state = this.getOrCreate(conversationId);
    state.entries.push({
      userMessage,
      agentResponse,
      timestamp: Date.now(),
    });
    state.lastActivityAt = Date.now();

    // Trim rolling window
    if (state.entries.length > this.maxEntries) {
      state.entries = state.entries.slice(-this.maxEntries);
    }
  }

  setActiveAgent(conversationId: string, agentId: string | null): void {
    const state = this.getOrCreate(conversationId);
    state.activeAgentId = agentId;
  }

  getActiveAgent(conversationId: string): string | null {
    return this.conversations.get(conversationId)?.activeAgentId ?? null;
  }

  getHistory(conversationId: string): ConversationEntry[] {
    return this.conversations.get(conversationId)?.entries ?? [];
  }

  /**
   * Converts conversation history to LLM ChatMessage array,
   * trimming older entries to fit within the token budget.
   */
  toChatMessages(conversationId: string, tokenCounter?: (text: string) => number): ChatMessage[] {
    const entries = this.getHistory(conversationId);
    if (entries.length === 0) return [];

    const counter = tokenCounter || defaultTokenCounter;
    const messages: ChatMessage[] = [];
    let totalTokens = 0;

    // Build from newest to oldest, then reverse
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const userMsg: ChatMessage = { role: 'user', content: entry.userMessage.content };
      const asstMsg: ChatMessage = { role: 'assistant', content: entry.agentResponse.text };

      const pairTokens = counter(userMsg.content) + counter(asstMsg.content);

      if (totalTokens + pairTokens > this.maxContextTokens) {
        break; // Stop — adding more would exceed budget
      }

      messages.unshift(asstMsg);
      messages.unshift(userMsg);
      totalTokens += pairTokens;
    }

    return messages;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, state] of this.conversations) {
      if (now - state.lastActivityAt > this.ttl) {
        this.conversations.delete(id);
      }
    }
  }
}

function defaultTokenCounter(text: string): number {
  return Math.ceil(text.length / 3.5);
}
