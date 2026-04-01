export interface UserMessage {
  id: string;
  timestamp: number;
  channelId: string;
  senderId: string;
  type: UserMessageType;
  content: string;
  attachment?: string; // base64
  replyTo?: string; // ID of original message
  metadata?: Record<string, unknown>;
}

export type UserMessageType = 'text' | 'image' | 'document' | 'audio' | 'reaction';

export interface AgentMessage {
  id: string;
  timestamp: number;
  source: string; // agent ID
  target: string; // agent ID or '*' for broadcast
  type: MessageType;
  action: string; // e.g. "obsidian.read", "obsidian.search"
  payload: Record<string, unknown>;
  conversationId: string;
  parentMessageId?: string; // for request-response correlation
  metadata?: Record<string, unknown>;
}

export enum MessageType {
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE',
  EVENT = 'EVENT',
  SYSTEM = 'SYSTEM',
}

export interface AgentResponse {
  id: string;
  timestamp: number;
  agentId: string;
  conversationId: string;
  text: string;
  image?: string; // base64
  document?: { data: string; fileName: string; mimeType: string };
  metadata?: Record<string, unknown>;
  error?: { code: string; message: string };
}
