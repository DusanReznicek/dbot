import type { FastifyReply, FastifyRequest } from 'fastify';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKey = process.env.DBOT_API_KEY;

  // Skip auth if no API key is configured
  if (!apiKey) return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
    });
    return;
  }
}
