export class DBotError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string = 'DBOT_ERROR', context?: Record<string, unknown>) {
    super(message);
    this.name = 'DBotError';
    this.code = code;
    this.context = context;
  }
}

export class AgentError extends DBotError {
  public readonly agentId: string;

  constructor(message: string, agentId: string, code: string = 'AGENT_ERROR') {
    super(message, code, { agentId });
    this.name = 'AgentError';
    this.agentId = agentId;
  }
}

export class SkillError extends DBotError {
  public readonly skillId: string;

  constructor(message: string, skillId: string, code: string = 'SKILL_ERROR') {
    super(message, code, { skillId });
    this.name = 'SkillError';
    this.skillId = skillId;
  }
}

export class ChannelError extends DBotError {
  public readonly channelId: string;

  constructor(message: string, channelId: string, code: string = 'CHANNEL_ERROR') {
    super(message, code, { channelId });
    this.name = 'ChannelError';
    this.channelId = channelId;
  }
}

export class PermissionError extends DBotError {
  constructor(
    message: string,
    source: string,
    target: string,
    action: string,
  ) {
    super(message, 'PERMISSION_DENIED', { source, target, action });
    this.name = 'PermissionError';
  }
}
