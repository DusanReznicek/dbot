import type { WhatsAppChannelConfig } from '../../core/config/config.schema.js';
import type { AgentResponse, UserMessage } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';
import { ChannelType, type ChannelStatus, type IChannel, type MessageHandler } from '../channel.interface.js';
import { BaileysConnectionManager } from './baileys-connection.js';
import { normalizeMessage } from './message-normalizer.js';
import { sendFormattedResponse, type FormatterOptions } from './response-formatter.js';

const logger = createLogger('WhatsAppChannel');

/**
 * Simple token-bucket rate limiter per JID.
 */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private maxTokens = 10;
  private refillRate = 10; // tokens per minute

  allow(jid: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(jid);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(jid, bucket);
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

export class WhatsAppChannel implements IChannel {
  public readonly id = 'whatsapp';
  public readonly name = 'WhatsApp';
  public readonly type = ChannelType.WHATSAPP;

  private config: WhatsAppChannelConfig;
  private connection: BaileysConnectionManager;
  private messageHandler: MessageHandler | null = null;
  private rateLimiter = new RateLimiter();
  private allowedContacts: Set<string>;
  private authenticated = false;

  constructor(config: WhatsAppChannelConfig) {
    this.config = config;
    this.connection = new BaileysConnectionManager(config);
    this.allowedContacts = new Set(config.allowedContacts);
  }

  async initialize(): Promise<void> {
    // Listen for connection events
    this.connection.on('connected', () => {
      this.authenticated = true;
      logger.info('WhatsApp authenticated');
    });

    this.connection.on('disconnected', (reason) => {
      this.authenticated = false;
      logger.warn({ reason }, 'WhatsApp disconnected');
    });

    this.connection.on('qr', (qr) => {
      logger.info({ qrLength: qr.length }, 'QR code available — scan with your phone');
    });

    // Handle incoming messages
    this.connection.on('message', async (upsert) => {
      if (upsert.type !== 'notify') return;

      for (const waMessage of upsert.messages) {
        // Skip own messages (unless allowSelf)
        if (waMessage.key.fromMe && !this.config.allowSelf) continue;

        try {
          await this.processIncomingMessage(waMessage);
        } catch (err) {
          logger.error({ err, messageId: waMessage.key.id }, 'Error processing message');
        }
      }
    });

    logger.info('WhatsApp channel initialized');
  }

  async start(): Promise<void> {
    await this.connection.connect();
    logger.info('WhatsApp channel started');
  }

  async stop(): Promise<void> {
    await this.connection.disconnect();
    logger.info('WhatsApp channel stopped');
  }

  getStatus(): ChannelStatus {
    return {
      connected: this.connection.isConnected(),
      authenticated: this.authenticated,
      metadata: {
        allowedContacts: Array.from(this.allowedContacts),
      },
    };
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private async processIncomingMessage(waMessage: any): Promise<void> {
    const result = await normalizeMessage(waMessage, this.id);
    if (!result) return;

    const { message, rawJid } = result;

    // Allowlist check
    if (this.allowedContacts.size > 0 && !this.isAllowed(rawJid)) {
      logger.debug({ jid: rawJid }, 'Message from non-allowed contact — ignoring');
      return;
    }

    // Rate limiting
    if (!this.rateLimiter.allow(rawJid)) {
      logger.warn({ jid: rawJid }, 'Rate limit exceeded — ignoring message');
      return;
    }

    if (!this.messageHandler) {
      logger.warn('No message handler configured — dropping message');
      return;
    }

    // Process and respond
    const response = await this.messageHandler(message, this.id);
    await this.sendResponse(rawJid, response, message);
  }

  private isAllowed(jid: string): boolean {
    // Check exact JID match
    if (this.allowedContacts.has(jid)) return true;

    // Check phone number prefix (without @s.whatsapp.net)
    const phoneNumber = jid.split('@')[0];
    for (const contact of this.allowedContacts) {
      const allowedPhone = contact.split('@')[0];
      if (phoneNumber === allowedPhone) return true;
    }

    return false;
  }

  private async sendResponse(
    jid: string,
    response: AgentResponse,
    originalMessage: UserMessage,
  ): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      logger.error('Cannot send response — no active socket');
      return;
    }

    const options: FormatterOptions = {
      maxMessageLength: this.config.maxMessageLength,
      typingIndicator: this.config.typingIndicator,
      readMessages: this.config.readMessages,
    };

    // Attach original message ID for read receipts
    response.metadata = {
      ...response.metadata,
      originalMessageId: originalMessage.id,
    };

    await sendFormattedResponse(socket, jid, response, options);
  }
}
