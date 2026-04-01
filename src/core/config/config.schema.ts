import { z } from 'zod';

export const serverSchema = z.object({
  port: z.number().int().min(0).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
});

export const llmProviderSchema = z.object({
  model: z.string(),
  apiKey: z.string().optional(),
});

export const ollamaProviderSchema = z.object({
  model: z.string().default('llama3.1'),
  baseUrl: z.string().default('http://localhost:11434'),
  keepAlive: z.string().default('5m'),
  timeout: z.number().int().default(120000),
});

export const llmSchema = z.object({
  defaultProvider: z.enum(['openai', 'anthropic', 'ollama', 'mistral']).default('openai'),
  providers: z.object({
    openai: llmProviderSchema.default({ model: 'gpt-4o' }),
    anthropic: llmProviderSchema.default({ model: 'claude-sonnet-4-20250514' }),
    ollama: ollamaProviderSchema.default({}),
    mistral: llmProviderSchema.default({ model: 'mistral-large-latest' }),
  }),
});

export const messageBusSchema = z.object({
  type: z.enum(['in-memory', 'redis']).default('in-memory'),
  redis: z
    .object({
      host: z.string().default('localhost'),
      port: z.number().int().default(6379),
    })
    .default({}),
});

export const loggingSchema = z.object({
  level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const whatsappChannelSchema = z.object({
  enabled: z.boolean().default(true),
  authMethod: z.enum(['qr', 'pairing']).default('qr'),
  authStateDir: z.string().default('./data/whatsapp-auth'),
  allowedContacts: z.array(z.string()).default([]),
  allowSelf: z.boolean().default(true),
  readMessages: z.boolean().default(true),
  typingIndicator: z.boolean().default(true),
  maxMessageLength: z.number().int().default(4096),
  reconnectInterval: z.number().int().default(5000),
  maxReconnectAttempts: z.number().int().default(10),
});

export const restApiChannelSchema = z.object({
  enabled: z.boolean().default(true),
});

export const cliChannelSchema = z.object({
  enabled: z.boolean().default(false),
});

export const telegramChannelSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  allowedChatIds: z.array(z.number()).default([]),
  allowGroups: z.boolean().default(false),
  typingIndicator: z.boolean().default(true),
  maxMessageLength: z.number().int().default(4096),
  rateLimitPerChat: z.number().int().default(10),
});

export const channelsSchema = z.object({
  whatsapp: whatsappChannelSchema.default({}),
  restApi: restApiChannelSchema.default({}),
  cli: cliChannelSchema.default({}),
  telegram: telegramChannelSchema.default({}),
});

export const metaPromptSourceSchema = z.union([
  z.string(),
  z.object({ file: z.string() }),
]);

export const masterAgentSchema = z.object({
  metaPrompt: metaPromptSourceSchema.optional(),
  fallbackResponse: z.string().optional(),
});

export const configSchema = z.object({
  server: serverSchema.default({}),
  llm: llmSchema.default({
    defaultProvider: 'openai',
    providers: {
      openai: { model: 'gpt-4o' },
      anthropic: { model: 'claude-sonnet-4-20250514' },
      ollama: {},
      mistral: { model: 'mistral-large-latest' },
    },
  }),
  messageBus: messageBusSchema.default({}),
  logging: loggingSchema.default({}),
  channels: channelsSchema.default({}),
  masterAgent: masterAgentSchema.default({}),
});

export type AppConfig = z.infer<typeof configSchema>;
export type ServerConfig = z.infer<typeof serverSchema>;
export type LLMConfig = z.infer<typeof llmSchema>;
export type MessageBusConfig = z.infer<typeof messageBusSchema>;
export type LoggingConfig = z.infer<typeof loggingSchema>;
export type ChannelsConfig = z.infer<typeof channelsSchema>;
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelSchema>;
export type TelegramChannelConfig = z.infer<typeof telegramChannelSchema>;
export type MasterAgentConfig = z.infer<typeof masterAgentSchema>;
