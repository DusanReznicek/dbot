import Fastify from 'fastify';
import type { MasterAgent } from '../master-agent/master-agent.js';
import type { SkillRegistry } from '../core/registry/skill.registry.js';
import type { RestApiChannel } from '../channels/rest-api/rest-api.channel.js';
import type { ServerConfig } from '../core/config/config.schema.js';
import { errorHandler } from './middleware/error.middleware.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerAgentRoutes } from './routes/agents.routes.js';
import { registerSkillRoutes } from './routes/skills.routes.js';
import { registerChatRoutes } from './routes/chat.routes.js';
import { registerPermissionRoutes } from './routes/permissions.routes.js';
import { registerLLMRoutes } from './routes/llm.routes.js';
import type { PermissionManager } from '../core/permissions/permission.manager.js';
import type { LLMProviderFactory } from '../core/llm/llm-provider.factory.js';
import { createLogger } from '../core/utils/logger.js';

const logger = createLogger('ApiServer');

export interface ServerDeps {
  masterAgent: MasterAgent;
  skillRegistry: SkillRegistry;
  restApiChannel: RestApiChannel;
  permissionManager: PermissionManager;
  llmProviderFactory: LLMProviderFactory;
  config: ServerConfig;
  startedAt: number;
}

export async function createServer(deps: ServerDeps): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Auth middleware on /api routes
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request, reply);
    }
  });

  // Register routes
  registerHealthRoutes(app, {
    masterAgent: deps.masterAgent,
    skillRegistry: deps.skillRegistry,
    startedAt: deps.startedAt,
  });
  registerAgentRoutes(app, deps.masterAgent);
  registerSkillRoutes(app, deps.skillRegistry);
  registerChatRoutes(app, deps.restApiChannel);
  registerPermissionRoutes(app, deps.permissionManager);
  registerLLMRoutes(app, deps.llmProviderFactory);

  // Start server
  const address = await app.listen({ port: deps.config.port, host: deps.config.host });
  logger.info({ address }, 'API server started');

  return app;
}
