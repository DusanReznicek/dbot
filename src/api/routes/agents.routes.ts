import type { FastifyInstance } from 'fastify';
import type { MasterAgent } from '../../master-agent/master-agent.js';

export function registerAgentRoutes(app: FastifyInstance, masterAgent: MasterAgent): void {
  app.get('/api/v1/agents', async () => {
    return { agents: masterAgent.getRegisteredAgents() };
  });
}
