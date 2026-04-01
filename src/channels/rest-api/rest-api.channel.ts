import { randomUUID } from 'node:crypto';
import type { UserMessage } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';
import { ChannelType, type ChannelStatus, type IChannel, type MessageHandler } from '../channel.interface.js';

const logger = createLogger('RestApiChannel');

/**
 * REST API channel — wraps the existing Fastify chat endpoint
 * as an IChannel implementation. The actual HTTP handling remains
 * in api/routes/chat.routes.ts; this channel serves as the bridge
 * between the ChannelRouter and the API layer.
 */
export class RestApiChannel implements IChannel {
  public readonly id = 'rest-api';
  public readonly name = 'REST API';
  public readonly type = ChannelType.REST_API;

  private connected = false;
  private messageHandler: MessageHandler | null = null;

  async initialize(): Promise<void> {
    logger.info('REST API channel initialized');
  }

  async start(): Promise<void> {
    this.connected = true;
    logger.info('REST API channel started');
  }

  async stop(): Promise<void> {
    this.connected = false;
    logger.info('REST API channel stopped');
  }

  getStatus(): ChannelStatus {
    return {
      connected: this.connected,
      authenticated: true, // API auth handled by middleware
    };
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Called from chat.routes.ts when a POST /api/v1/chat arrives.
   */
  async handleApiMessage(text: string, conversationId?: string) {
    const message: UserMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      channelId: this.id,
      senderId: 'api-user',
      type: 'text',
      content: text,
      metadata: { conversationId: conversationId || randomUUID() },
    };

    if (this.messageHandler) {
      return this.messageHandler(message, this.id);
    }
    throw new Error('No message handler set on REST API channel');
  }
}
