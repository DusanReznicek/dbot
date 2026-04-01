import { randomUUID } from 'node:crypto';
import type { ISubAgent, AgentContext, HealthStatus } from '../../core/interfaces/agent.interface.js';
import type { AgentMessage, AgentResponse } from '../../core/interfaces/message.interface.js';

/**
 * Template for creating new sub-agents.
 * Copy this directory and replace "template" with your agent name.
 */
export class TemplateAgent implements ISubAgent {
  public readonly id = 'template-agent';
  public readonly name = 'Template Agent';
  public readonly description = 'A template agent — replace with your description';
  public readonly capabilities: string[] = [];
  public readonly requiredSkills: string[] = [];

  private startedAt = 0;

  async initialize(_context: AgentContext): Promise<void> {
    this.startedAt = Date.now();
  }

  async handleMessage(message: AgentMessage): Promise<AgentResponse> {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      agentId: this.id,
      conversationId: message.conversationId,
      text: `Template agent received action: ${message.action}`,
    };
  }

  async shutdown(): Promise<void> {}

  getHealthStatus(): HealthStatus {
    return { healthy: true, uptime: Date.now() - this.startedAt };
  }
}
