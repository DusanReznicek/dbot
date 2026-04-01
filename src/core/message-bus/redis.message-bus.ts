import { randomUUID } from 'node:crypto';
import Redis_ from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const IoRedis = (Redis_ as any).default ?? Redis_;
import type { AgentMessage } from '../interfaces/message.interface.js';
import { MessageType } from '../interfaces/message.interface.js';
import type { IMessageBus, MessageHandler, Subscription } from './message-bus.interface.js';
import type { IPermissionManager } from '../permissions/permission.manager.js';
import { DBotError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RedisMessageBus');

const DEFAULT_REQUEST_TIMEOUT = 30_000;

export interface RedisMessageBusConfig {
  host: string;
  port: number;
  password?: string;
  keyPrefix?: string;
}

type RedisClient = Redis_.Redis;

export class RedisMessageBus implements IMessageBus {
  private publisher: RedisClient;
  private subscriber: RedisClient;
  private localHandlers = new Map<string, Set<{ id: string; handler: MessageHandler }>>();
  private subscriptions = new Map<string, { channel: string; handler: MessageHandler }>();
  private permissionManager?: IPermissionManager;
  private instanceId = randomUUID().slice(0, 8);

  constructor(config: RedisMessageBusConfig) {
    const redisOpts = {
      host: config.host,
      port: config.port,
      password: config.password,
      keyPrefix: config.keyPrefix,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    };

    this.publisher = new IoRedis(redisOpts) as RedisClient;
    this.subscriber = new IoRedis(redisOpts) as RedisClient;

    // Handle incoming messages from Redis subscriber
    this.subscriber.on('message', (channel: string, raw: string) => {
      try {
        const message = JSON.parse(raw) as AgentMessage;
        this.deliverToLocalHandlers(channel, message);
      } catch (err) {
        logger.error({ err, channel }, 'Failed to parse Redis message');
      }
    });
  }

  /**
   * Inject a permission manager to enforce inter-agent communication rules.
   */
  setPermissionManager(manager: IPermissionManager): void {
    this.permissionManager = manager;
    logger.info('Permission manager set on Redis message bus');
  }

  /**
   * Connect both publisher and subscriber Redis clients.
   */
  async connect(): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    logger.info({ instanceId: this.instanceId }, 'Redis message bus connected');
  }

  async publish(channel: string, message: AgentMessage): Promise<void> {
    // Enforce permissions for inter-agent messages
    if (this.permissionManager && message.source && message.target) {
      const action = message.action || '*';
      const result = this.permissionManager.check(message.source, message.target, action);
      if (!result.allowed) {
        logger.warn(
          { source: message.source, target: message.target, action, reason: result.reason },
          'Message blocked by permission manager',
        );
        throw new DBotError(
          result.reason || 'Permission denied',
          'PERMISSION_DENIED',
          { source: message.source, target: message.target, action },
        );
      }
      if (result.requireConfirmation) {
        // Publish to a special confirmation channel
        await this.publisher.publish(
          'permission:confirmation-required',
          JSON.stringify({ message, rule: result.rule }),
        );
        return;
      }
    }

    logger.debug({ channel, messageId: message.id }, 'Publishing message to Redis');
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: MessageHandler): Subscription {
    const id = randomUUID();

    // Track local handler
    if (!this.localHandlers.has(channel)) {
      this.localHandlers.set(channel, new Set());
      // Subscribe to Redis channel (only on first local subscription for this channel)
      this.subscriber.subscribe(channel).catch((err: unknown) => {
        logger.error({ err, channel }, 'Failed to subscribe to Redis channel');
      });
    }

    const entry = { id, handler };
    this.localHandlers.get(channel)!.add(entry);
    this.subscriptions.set(id, { channel, handler });

    logger.debug({ channel, subscriptionId: id }, 'Subscribed');

    return {
      id,
      channel,
      unsubscribe: () => this.unsubscribeById(id),
    };
  }

  unsubscribe(subscription: Subscription): void {
    this.unsubscribeById(subscription.id);
  }

  async request(
    channel: string,
    message: AgentMessage,
    timeout: number = DEFAULT_REQUEST_TIMEOUT,
  ): Promise<AgentMessage> {
    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        responseSub.unsubscribe();
        reject(
          new DBotError(
            `Request timeout after ${timeout}ms on channel "${channel}"`,
            'REQUEST_TIMEOUT',
            { channel, messageId: message.id },
          ),
        );
      }, timeout);

      const responseSub = this.subscribe(channel, (response: AgentMessage) => {
        if (
          response.parentMessageId === message.id &&
          response.type === MessageType.RESPONSE
        ) {
          clearTimeout(timer);
          responseSub.unsubscribe();
          resolve(response);
        }
      });

      this.publish(channel, message).catch((err) => {
        clearTimeout(timer);
        responseSub.unsubscribe();
        reject(err);
      });
    });
  }

  async shutdown(): Promise<void> {
    await this.subscriber.unsubscribe();
    this.subscriber.disconnect();
    this.publisher.disconnect();
    this.localHandlers.clear();
    this.subscriptions.clear();
    logger.info('Redis message bus shut down');
  }

  private deliverToLocalHandlers(channel: string, message: AgentMessage): void {
    const handlers = this.localHandlers.get(channel);
    if (handlers) {
      for (const entry of handlers) {
        Promise.resolve(entry.handler(message)).catch((err) => {
          logger.error({ err, channel, subscriptionId: entry.id }, 'Error in message handler');
        });
      }
    }

    // Also deliver to wildcard subscribers
    if (channel !== '*') {
      const wildcardHandlers = this.localHandlers.get('*');
      if (wildcardHandlers) {
        for (const entry of wildcardHandlers) {
          Promise.resolve(entry.handler(message)).catch((err) => {
            logger.error({ err, channel: '*', subscriptionId: entry.id }, 'Error in wildcard handler');
          });
        }
      }
    }
  }

  private unsubscribeById(id: string): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;

    const channelHandlers = this.localHandlers.get(sub.channel);
    if (channelHandlers) {
      for (const entry of channelHandlers) {
        if (entry.id === id) {
          channelHandlers.delete(entry);
          break;
        }
      }

      // Unsubscribe from Redis if no more local handlers for this channel
      if (channelHandlers.size === 0) {
        this.localHandlers.delete(sub.channel);
        this.subscriber.unsubscribe(sub.channel).catch((err: unknown) => {
          logger.error({ err, channel: sub.channel }, 'Failed to unsubscribe from Redis channel');
        });
      }
    }

    this.subscriptions.delete(id);
    logger.debug({ subscriptionId: id, channel: sub.channel }, 'Unsubscribed');
  }
}
