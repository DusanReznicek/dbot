import { Mistral } from '@mistralai/mistralai';
import type {
  ILLMProvider,
  ChatMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamChunk,
  ToolDefinition,
} from '../interfaces/llm.interface.js';
import { createLogger } from '../utils/logger.js';
import { DBotError } from '../utils/errors.js';

const logger = createLogger('MistralProvider');

export interface MistralProviderConfig {
  model: string;
  apiKey?: string;
}

export class MistralProvider implements ILLMProvider {
  public readonly id = 'mistral';
  private client: Mistral;
  private defaultModel: string;

  constructor(config: MistralProviderConfig) {
    const apiKey = config.apiKey || process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new DBotError('Mistral API key not configured (set MISTRAL_API_KEY)');
    }
    this.client = new Mistral({ apiKey });
    this.defaultModel = config.model;
    logger.info({ model: this.defaultModel }, 'Mistral provider initialized');
  }

  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    const mistralMessages = this.toMistralMessages(messages, options?.systemPrompt);

    const params: Record<string, unknown> = {
      model,
      messages: mistralMessages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    };

    if (options?.tools?.length) {
      params.tools = this.toMistralTools(options.tools);
    }

    logger.debug({ model, messageCount: messages.length }, 'Calling Mistral chat');

    const response = await this.client.chat.complete(params as any);
    const choice = (response as any).choices?.[0];

    if (!choice) {
      return {
        content: '',
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      };
    }

    const toolCalls = choice.message?.toolCalls?.map((tc: any, idx: number) => {
      const args = tc.function?.arguments;
      return {
        id: tc.id || `call_${idx}`,
        name: tc.function?.name || '',
        arguments: typeof args === 'string' ? JSON.parse(args) : (args || {}),
      };
    });

    const usage = (response as any).usage;

    return {
      content: choice.message?.content || '',
      model: (response as any).model || model,
      usage: {
        promptTokens: usage?.promptTokens ?? usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
        totalTokens: usage?.totalTokens ?? usage?.total_tokens ?? 0,
      },
      finishReason: choice.finishReason || choice.finish_reason || 'stop',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    };
  }

  async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const model = options?.model || this.defaultModel;
    const mistralMessages = this.toMistralMessages(messages, options?.systemPrompt);

    const stream = await this.client.chat.stream({
      model,
      messages: mistralMessages as any,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    for await (const event of stream) {
      const data = (event as any).data;
      const delta = data?.choices?.[0]?.delta?.content || '';
      const finishReason = data?.choices?.[0]?.finishReason ?? data?.choices?.[0]?.finish_reason;
      yield { content: delta, done: finishReason != null };
    }
  }

  getTokenCount(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private toMistralMessages(
    messages: ChatMessage[],
    systemPrompt?: string,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  private toMistralTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
