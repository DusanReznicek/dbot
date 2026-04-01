import { Bot } from 'grammy';
import type { TelegramChannelConfig } from '../../core/config/config.schema.js';
import type { AgentResponse, UserMessage } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';
import { ChannelType, type ChannelStatus, type IChannel, type MessageHandler } from '../channel.interface.js';
import { normalizeMessage } from './message-normalizer.js';
import { sendFormattedResponse, type FormatterOptions } from './response-formatter.js';

const logger = createLogger('TelegramChannel');

/**
 * Simple token-bucket rate limiter per chat ID.
 */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private maxTokens: number;
  private refillRate: number; // tokens per minute

  constructor(maxTokens = 10, refillRate = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  allow(chatId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(chatId);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(chatId, bucket);
    }

    // Refill tokens
    const elapsed = (now - bucket.lastRefill) / 60000; // minutes
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }
}

export class TelegramChannel implements IChannel {
  public readonly id = 'telegram';
  public readonly name = 'Telegram';
  public readonly type = ChannelType.TELEGRAM;

  private config: TelegramChannelConfig;
  private bot: Bot | null = null;
  private messageHandler: MessageHandler | null = null;
  private rateLimiter: RateLimiter;
  private allowedChatIds: Set<number>;
  private connected = false;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimitPerChat, config.rateLimitPerChat);
    this.allowedChatIds = new Set(config.allowedChatIds);
  }

  async initialize(): Promise<void> {
    const token = this.config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) {
      throw new Error('Telegram bot token is required — set botToken in config or TELEGRAM_BOT_TOKEN env var');
    }

    this.bot = new Bot(token);

    // Handle incoming messages
    this.bot.on('message', async (ctx) => {
      try {
        await this.processIncomingMessage(ctx.message);
      } catch (err) {
        logger.error({ err, messageId: ctx.message.message_id }, 'Error processing Telegram message');
      }
    });

    // Error boundary
    this.bot.catch((err) => {
      logger.error({ err: err.error }, 'grammY bot error');
    });

    logger.info('Telegram channel initialized');
  }

  async start(): Promise<void> {
    if (!this.bot) throw new Error('Telegram channel not initialized');

    // Start long polling (fire-and-forget — bot.start() blocks until stopped)
    this.bot.start({
      onStart: () => {
        this.connected = true;
        logger.info('Telegram bot started (long polling)');
      },
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.connected = false;
      logger.info('Telegram channel stopped');
    }
  }

  getStatus(): ChannelStatus {
    return {
      connected: this.connected,
      authenticated: this.connected,
      metadata: {
        allowedChatIds: Array.from(this.allowedChatIds),
      },
    };
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private async processIncomingMessage(msg: any): Promise<void> {
    if (!this.bot) return;

    const result = await normalizeMessage(msg, this.id, this.bot.api);
    if (!result) return;

    const { message, rawChatId } = result;

    // Allowlist check
    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(rawChatId)) {
      logger.debug({ chatId: rawChatId }, 'Message from non-allowed chat — ignoring');
      return;
    }

    // Group check (negative chat IDs = groups/supergroups)
    if (!this.config.allowGroups && rawChatId < 0) {
      logger.debug({ chatId: rawChatId }, 'Group message ignored (allowGroups=false)');
      return;
    }

    // Rate limiting
    if (!this.rateLimiter.allow(String(rawChatId))) {
      logger.warn({ chatId: rawChatId }, 'Rate limit exceeded — ignoring message');
      return;
    }

    if (!this.messageHandler) {
      logger.warn('No message handler configured — dropping message');
      return;
    }

    // Process and respond
    const response = await this.messageHandler(message, this.id);
    await this.sendResponse(rawChatId, response);
  }

  private async sendResponse(chatId: number, response: AgentResponse): Promise<void> {
    if (!this.bot) {
      logger.error('Cannot send response — bot not initialized');
      return;
    }

    const options: FormatterOptions = {
      maxMessageLength: this.config.maxMessageLength,
      typingIndicator: this.config.typingIndicator,
    };

    await sendFormattedResponse(this.bot.api, chatId, response, options);
  }
}
