import type { FastifyInstance } from 'fastify';
import type { MasterAgent } from '../../master-agent/master-agent.js';
import type { SkillRegistry } from '../../core/registry/skill.registry.js';

export interface HealthDeps {
  masterAgent: MasterAgent;
  skillRegistry: SkillRegistry;
  startedAt: number;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/api/v1/health', async () => {
    const agents = deps.masterAgent.getRegisteredAgents();
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
      agents: {
        count: agents.length,
        list: agents.map((a) => ({ id: a.id, name: a.name, healthy: a.status.healthy })),
      },
      skills: {
        count: deps.skillRegistry.size,
      },
    };
  });
}
