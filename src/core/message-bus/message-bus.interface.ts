import type { AgentMessage } from '../interfaces/message.interface.js';

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export interface Subscription {
  id: string;
  channel: string;
  unsubscribe(): void;
}

export interface IMessageBus {
  publish(channel: string, message: AgentMessage): Promise<void>;
  subscribe(channel: string, handler: MessageHandler): Subscription;
  unsubscribe(subscription: Subscription): void;
  request(channel: string, message: AgentMessage, timeout?: number): Promise<AgentMessage>;
  shutdown(): Promise<void>;
}
