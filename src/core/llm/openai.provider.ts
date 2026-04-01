import OpenAI from 'openai';
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

const logger = createLogger('OpenAIProvider');

export interface OpenAIProviderConfig {
  model: string;
  apiKey?: string;
}

export class OpenAIProvider implements ILLMProvider {
  public readonly id = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: OpenAIProviderConfig) {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new DBotError('OpenAI API key not configured (set OPENAI_API_KEY)');
    }
    this.client = new OpenAI({ apiKey });
    this.defaultModel = config.model;
    logger.info({ model: this.defaultModel }, 'OpenAI provider initialized');
  }

  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    const openaiMessages = this.toOpenAIMessages(messages, options?.systemPrompt);

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: openaiMessages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    };

    if (options?.tools?.length) {
      params.tools = this.toOpenAITools(options.tools);
    }

    logger.debug({ model, messageCount: messages.length }, 'Calling OpenAI chat');

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content || '',
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: choice.finish_reason || 'stop',
      toolCalls,
    };
  }

  async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const model = options?.model || this.defaultModel;
    const openaiMessages = this.toOpenAIMessages(messages, options?.systemPrompt);

    const stream = await this.client.chat.completions.create({
      model,
      messages: openaiMessages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      const done = chunk.choices[0]?.finish_reason !== null;
      yield { content: delta, done };
    }
  }

  getTokenCount(text: string): number {
    // Heuristic: ~4 chars per token for English, ~2-3 for Czech
    return Math.ceil(text.length / 3.5);
  }

  private toOpenAIMessages(
    messages: ChatMessage[],
    systemPrompt?: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  private toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
