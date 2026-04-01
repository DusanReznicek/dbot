export interface ISkill {
  id: string;
  name: string;
  version: string;
  description: string;

  initialize(config: SkillConfig): Promise<void>;
  execute(action: string, params: Record<string, unknown>): Promise<SkillResult>;
  getAvailableActions(): ActionDescriptor[];
  shutdown(): Promise<void>;
}

export interface SkillConfig {
  [key: string]: unknown;
}

export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface ActionDescriptor {
  name: string;
  description: string;
  parameters: ParameterDescriptor[];
  returns: string;
}

export interface ParameterDescriptor {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  actions: ActionDescriptor[];
  configSchema: Record<string, unknown>; // JSON Schema
  permissions: string[]; // required permissions
}
