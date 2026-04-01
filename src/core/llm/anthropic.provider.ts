import Anthropic from '@anthropic-ai/sdk';
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

const logger = createLogger('AnthropicProvider');

export interface AnthropicProviderConfig {
  model: string;
  apiKey?: string;
}

export class AnthropicProvider implements ILLMProvider {
  public readonly id = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(config: AnthropicProviderConfig) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new DBotError('Anthropic API key not configured (set ANTHROPIC_API_KEY)');
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = config.model;
    logger.info({ model: this.defaultModel }, 'Anthropic provider initialized');
  }

  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    const { systemPrompt, anthropicMessages } = this.toAnthropicMessages(messages, options?.systemPrompt);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    if (options?.tools?.length) {
      params.tools = this.toAnthropicTools(options.tools);
    }

    logger.debug({ model, messageCount: messages.length }, 'Calling Anthropic chat');

    const response = await this.client.messages.create(params);

    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      }));

    return {
      content: textContent,
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason || 'end_turn',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
    const model = options?.model || this.defaultModel;
    const { systemPrompt, anthropicMessages } = this.toAnthropicMessages(messages, options?.systemPrompt);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    const stream = this.client.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { content: event.delta.text, done: false };
      }
      if (event.type === 'message_stop') {
        yield { content: '', done: true };
      }
    }
  }

  getTokenCount(text: string): number {
    // Heuristic: Anthropic tokenizer is similar to ~3.5 chars/token
    return Math.ceil(text.length / 3.5);
  }

  private toAnthropicMessages(
    messages: ChatMessage[],
    systemPromptOverride?: string,
  ): { systemPrompt: string | undefined; anthropicMessages: Anthropic.MessageParam[] } {
    let systemPrompt = systemPromptOverride;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic uses a separate system parameter
        systemPrompt = systemPrompt || msg.content;
      } else {
        anthropicMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  private toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    }));
  }
}
