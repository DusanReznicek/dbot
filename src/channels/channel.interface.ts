import type { AgentResponse, UserMessage } from '../core/interfaces/message.interface.js';

export enum ChannelType {
  WHATSAPP = 'WHATSAPP',
  REST_API = 'REST_API',
  CLI = 'CLI',
  TELEGRAM = 'TELEGRAM',
}

export interface ChannelStatus {
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  metadata?: Record<string, unknown>;
}

export interface IChannel {
  id: string;
  name: string;
  type: ChannelType;

  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChannelStatus;
}

export type MessageHandler = (message: UserMessage, channelId: string) => Promise<AgentResponse>;

export interface IChannelRouter {
  registerChannel(channel: IChannel): void;
  unregisterChannel(channelId: string): void;
  getActiveChannels(): Array<{ id: string; name: string; type: ChannelType; status: ChannelStatus }>;
  setMessageHandler(handler: MessageHandler): void;
  handleIncoming(message: UserMessage, channelId: string): Promise<AgentResponse>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
