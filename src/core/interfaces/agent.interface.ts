import type { AgentMessage, AgentResponse, UserMessage } from './message.interface.js';

export interface IMasterAgent {
  id: string;
  initialize(): Promise<void>;
  handleUserMessage(message: UserMessage): Promise<AgentResponse>;
  registerSubAgent(agent: ISubAgent): void;
  unregisterSubAgent(agentId: string): void;
  getRegisteredAgents(): SubAgentInfo[];
  routeToAgent(agentId: string, message: AgentMessage): Promise<AgentResponse>;
}

export interface ISubAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[]; // e.g. ["obsidian.read", "obsidian.write"]
  requiredSkills: string[]; // skill IDs

  initialize(context: AgentContext): Promise<void>;
  handleMessage(message: AgentMessage): Promise<AgentResponse>;
  shutdown(): Promise<void>;
  getHealthStatus(): HealthStatus;
}

export interface AgentContext {
  config: Record<string, unknown>;
  skills: Map<string, unknown>; // skill ID → skill instance
  llmProvider: unknown; // ILLMProvider — loosely typed to avoid circular deps
}

export interface SubAgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  status: HealthStatus;
}

export interface HealthStatus {
  healthy: boolean;
  uptime: number;
  lastActivity?: number;
  details?: Record<string, unknown>;
}
