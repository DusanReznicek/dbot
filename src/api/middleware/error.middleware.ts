import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DBotError, AgentError, SkillError, ChannelError, PermissionError } from '../../core/utils/errors.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('ErrorMiddleware');

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  logger.error({ err: error }, 'Request error');

  if (error instanceof PermissionError) {
    reply.status(403).send({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof AgentError) {
    reply.status(502).send({
      error: { code: error.code, message: error.message, agentId: error.agentId },
    });
    return;
  }

  if (error instanceof SkillError) {
    reply.status(500).send({
      error: { code: error.code, message: error.message, skillId: error.skillId },
    });
    return;
  }

  if (error instanceof ChannelError) {
    reply.status(502).send({
      error: { code: error.code, message: error.message, channelId: error.channelId },
    });
    return;
  }

  if (error instanceof DBotError) {
    reply.status(500).send({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  // Fastify validation errors
  if ('validation' in error) {
    reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
    return;
  }

  // Unknown errors
  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
