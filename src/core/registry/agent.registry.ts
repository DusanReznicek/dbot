import type { ISubAgent, SubAgentInfo } from '../interfaces/agent.interface.js';
import { createLogger } from '../utils/logger.js';
import { AgentError } from '../utils/errors.js';

const logger = createLogger('AgentRegistry');

export class AgentRegistry {
  private agents = new Map<string, ISubAgent>();

  register(agent: ISubAgent): void {
    if (this.agents.has(agent.id)) {
      throw new AgentError(`Agent "${agent.id}" is already registered`, agent.id);
    }
    this.agents.set(agent.id, agent);
    logger.info(
      { agentId: agent.id, capabilities: agent.capabilities },
      'Agent registered',
    );
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    logger.info({ agentId }, 'Agent unregistered');
  }

  get(agentId: string): ISubAgent | undefined {
    return this.agents.get(agentId);
  }

  findByCapability(capability: string): ISubAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.capabilities.includes(capability)) {
        return agent;
      }
    }
    return undefined;
  }

  getAll(): ISubAgent[] {
    return Array.from(this.agents.values());
  }

  getAllInfo(): SubAgentInfo[] {
    return this.getAll().map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      status: agent.getHealthStatus(),
    }));
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  get size(): number {
    return this.agents.size;
  }
}
