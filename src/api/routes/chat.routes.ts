import type { FastifyInstance } from 'fastify';
import type { RestApiChannel } from '../../channels/rest-api/rest-api.channel.js';

interface ChatBody {
  message: string;
  conversationId?: string;
}

export function registerChatRoutes(app: FastifyInstance, restApiChannel: RestApiChannel): void {
  app.post<{ Body: ChatBody }>('/api/v1/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1 },
          conversationId: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { message, conversationId } = request.body;
    return restApiChannel.handleApiMessage(message, conversationId);
  });
}
