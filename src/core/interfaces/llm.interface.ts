export interface ILLMProvider {
  id: string;
  chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;
  streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
  getTokenCount(text: string): number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  toolCalls?: ToolCall[];
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
