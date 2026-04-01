import type { AgentResponse, UserMessage } from '../core/interfaces/message.interface.js';
import { DBotError } from '../core/utils/errors.js';
import { createLogger } from '../core/utils/logger.js';
import type { IChannel, IChannelRouter, MessageHandler } from './channel.interface.js';

const logger = createLogger('ChannelRouter');

export class ChannelRouter implements IChannelRouter {
  private channels = new Map<string, IChannel>();
  private messageHandler: MessageHandler | null = null;

  registerChannel(channel: IChannel): void {
    if (this.channels.has(channel.id)) {
      throw new DBotError(`Channel "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
    logger.info({ channelId: channel.id, type: channel.type }, 'Channel registered');
  }

  unregisterChannel(channelId: string): void {
    this.channels.delete(channelId);
    logger.info({ channelId }, 'Channel unregistered');
  }

  getActiveChannels() {
    return Array.from(this.channels.values()).map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      status: ch.getStatus(),
    }));
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async handleIncoming(message: UserMessage, channelId: string): Promise<AgentResponse> {
    if (!this.messageHandler) {
      throw new DBotError('No message handler configured on ChannelRouter');
    }
    logger.debug({ channelId, messageId: message.id }, 'Routing incoming message');
    return this.messageHandler(message, channelId);
  }

  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.initialize();
      await channel.start();
      logger.info({ channelId: channel.id }, 'Channel started');
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
      logger.info({ channelId: channel.id }, 'Channel stopped');
    }
  }
}
