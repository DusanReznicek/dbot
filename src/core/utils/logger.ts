import pino from 'pino';

export interface LogContext {
  agentId?: string;
  channelId?: string;
  conversationId?: string;
  [key: string]: unknown;
}

const rootLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

export function createLogger(name: string, context?: LogContext): pino.Logger {
  return rootLogger.child({ name, ...context });
}

export function setLogLevel(level: string): void {
  rootLogger.level = level;
}

export const logger = rootLogger;
