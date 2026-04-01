import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'eventemitter3';
import type { AgentMessage } from '../interfaces/message.interface.js';
import { MessageType } from '../interfaces/message.interface.js';
import type { IMessageBus, MessageHandler, Subscription } from './message-bus.interface.js';
import type { IPermissionManager } from '../permissions/permission.manager.js';
import { DBotError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('InMemoryMessageBus');

const DEFAULT_REQUEST_TIMEOUT = 30_000; // 30 seconds

export class InMemoryMessageBus implements IMessageBus {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, { channel: string; handler: MessageHandler }>();
  private permissionManager?: IPermissionManager;

  /**
   * Inject a permission manager to enforce inter-agent communication rules.
   */
  setPermissionManager(manager: IPermissionManager): void {
    this.permissionManager = manager;
    logger.info('Permission manager set on message bus');
  }

  async publish(channel: string, message: AgentMessage): Promise<void> {
    // Enforce permissions for inter-agent messages (source and target both set)
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
        // Emit a confirmation-required event; the MasterAgent listens for these
        this.emitter.emit('permission:confirmation-required', {
          message,
          rule: result.rule,
        });
        return; // Do not deliver yet — wait for confirmation
      }
    }

    logger.debug({ channel, messageId: message.id }, 'Publishing message');
    this.emitter.emit(channel, message);

    // Also emit to wildcard subscribers
    if (channel !== '*') {
      this.emitter.emit('*', message);
    }
  }

  subscribe(channel: string, handler: MessageHandler): Subscription {
    const id = randomUUID();

    const wrappedHandler = (message: AgentMessage): void => {
      Promise.resolve(handler(message)).catch((err) => {
        logger.error({ err, channel, subscriptionId: id }, 'Error in message handler');
      });
    };

    this.emitter.on(channel, wrappedHandler);
    this.subscriptions.set(id, { channel, handler: wrappedHandler });

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

      // Listen for response with matching parentMessageId
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

      // Publish the request
      this.publish(channel, message).catch((err) => {
        clearTimeout(timer);
        responseSub.unsubscribe();
        reject(err);
      });
    });
  }

  async shutdown(): Promise<void> {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
    logger.info('Message bus shut down');
  }

  private unsubscribeById(id: string): void {
    const sub = this.subscriptions.get(id);
    if (sub) {
      this.emitter.off(sub.channel, sub.handler);
      this.subscriptions.delete(id);
      logger.debug({ subscriptionId: id, channel: sub.channel }, 'Unsubscribed');
    }
  }
}
