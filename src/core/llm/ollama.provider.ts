import type {
  ILLMProvider,
  ChatMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamChunk,
  ToolDefinition,
  ToolCall,
} from '../interfaces/llm.interface.js';
import { createLogger } from '../utils/logger.js';
import { DBotError } from '../utils/errors.js';

const logger = createLogger('OllamaProvider');

export interface OllamaProviderConfig {
  model: string;
  baseUrl?: string;
  keepAlive?: string;
  timeout?: number;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider implements ILLMProvider {
  public readonly id = 'ollama';
  private baseUrl: string;
  private currentModel: string;
  private keepAlive: string;
  private timeout: number;

  constructor(config: OllamaProviderConfig) {
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.currentModel = config.model;
    this.keepAlive = config.keepAlive || '5m';
    this.timeout = config.timeout || 120_000;
    logger.info({ model: this.currentModel, baseUrl: this.baseUrl }, 'Ollama provider initialized');
  }

  // === ILLMProvider ===

  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.currentModel;
    const ollamaMessages = this.toOllamaMessages(messages, options?.systemPrompt);

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
      },
      keep_alive: this.keepAlive,
    };

    if (options?.tools?.length) {
      body.tools = this.toOllamaTools(options.tools);
    }

    logger.debug({ model, messageCount: messages.length }, 'Calling Ollama chat');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DBotError(
        `Ollama request failed: ${message}`,
        'LLM_ERROR',
        { model, baseUrl: this.baseUrl },
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new DBotError(
        `Ollama API error: ${response.status} ${response.statusText} — ${errorBody}`,
        'LLM_ERROR',
        { model, status: response.status },
      );
    }

    const data = (await response.json()) as OllamaChatResponse;

    return {
      content: data.message?.content ?? '',
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finishReason: data.done ? 'stop' : 'length',
      toolCalls: this.extractToolCalls(data.message),
    };
  }

  async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const model = options?.model || this.currentModel;
    const ollamaMessages = this.toOllamaMessages(messages, options?.systemPrompt);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 2048,
          },
          keep_alive: this.keepAlive,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DBotError(`Ollama stream failed: ${message}`, 'LLM_ERROR', { model });
    }

    if (!response.ok || !response.body) {
      throw new DBotError(`Ollama stream error: ${response.status}`, 'LLM_ERROR', { model });
    }

    // Ollama streams NDJSON — one JSON object per line
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            yield {
              content: chunk.message?.content ?? '',
              done: chunk.done ?? false,
            };
          } catch {
            logger.debug({ line }, 'Failed to parse NDJSON chunk');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  getTokenCount(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  // === Model management (Ollama-specific) ===

  setModel(model: string): void {
    const previous = this.currentModel;
    this.currentModel = model;
    logger.info({ model, previous }, 'Ollama model changed');
  }

  getModel(): string {
    return this.currentModel;
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: OllamaModelInfo[] };
      return data.models ?? [];
    } catch {
      return [];
    }
  }

  async getModelInfo(model: string): Promise<OllamaModelInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as OllamaModelInfo;
    } catch {
      return null;
    }
  }

  async pullModel(model: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: false }),
        signal: AbortSignal.timeout(600_000), // 10 minutes
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // === Private ===

  private toOllamaMessages(messages: ChatMessage[], systemPrompt?: string): OllamaChatMessage[] {
    const result: OllamaChatMessage[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system' && systemPrompt) continue; // Already added above
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  private toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private extractToolCalls(
    message: OllamaChatResponse['message'],
  ): ToolCall[] | undefined {
    if (!message?.tool_calls?.length) return undefined;

    return message.tool_calls.map((tc, idx) => ({
      id: `call_${idx}`,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
  }
}
