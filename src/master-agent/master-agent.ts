import { randomUUID } from 'node:crypto';
import type { IMasterAgent, ISubAgent, SubAgentInfo } from '../core/interfaces/agent.interface.js';
import type { AgentMessage, AgentResponse, UserMessage } from '../core/interfaces/message.interface.js';
import type { ILLMProvider } from '../core/interfaces/llm.interface.js';
import { MessageType } from '../core/interfaces/message.interface.js';
import type { IMessageBus } from '../core/message-bus/message-bus.interface.js';
import type { IPermissionManager } from '../core/permissions/permission.manager.js';
import type { PermissionRule } from '../core/permissions/permission.types.js';
import { AgentRegistry } from '../core/registry/agent.registry.js';
import { createLogger } from '../core/utils/logger.js';
import { AgentError } from '../core/utils/errors.js';
import { IntentRouter } from './intent-router.js';
import { ConversationContext } from './conversation-context.js';

const logger = createLogger('MasterAgent');

/** Callback type for asking the user a yes/no confirmation question. */
export type ConfirmationHandler = (question: string, conversationId: string) => Promise<boolean>;

export class MasterAgent implements IMasterAgent {
  public readonly id = 'master-agent';
  private agentRegistry: AgentRegistry;
  private intentRouter: IntentRouter;
  private conversationContext: ConversationContext;
  private messageBus: IMessageBus;
  private permissionManager?: IPermissionManager;
  private confirmationHandler?: ConfirmationHandler;
  private pendingConfirmations = new Map<string, { message: AgentMessage; rule: PermissionRule }>();

  constructor(messageBus: IMessageBus) {
    this.messageBus = messageBus;
    this.agentRegistry = new AgentRegistry();
    this.intentRouter = new IntentRouter(this.agentRegistry);
    this.conversationContext = new ConversationContext();
  }

  async initialize(): Promise<void> {
    logger.info('Master Agent initialized');
  }

  /**
   * Set the permission manager and listen for confirmation-required events.
   */
  setPermissionManager(manager: IPermissionManager): void {
    this.permissionManager = manager;
    logger.info('Permission manager set on Master Agent');
  }

  /**
   * Set a handler for user confirmation prompts.
   * The handler asks the user (via their active channel) and returns true/false.
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  /**
   * Handle a confirmation-required inter-agent message.
   * Asks the user for permission, then delivers or blocks the message.
   */
  async handleConfirmationRequest(
    message: AgentMessage,
    rule: PermissionRule,
  ): Promise<boolean> {
    const conversationId = message.conversationId || 'system';

    if (!this.confirmationHandler) {
      logger.warn('No confirmation handler set — blocking message');
      return false;
    }

    const question = `Agent "${message.source}" chce komunikovat s agentem "${message.target}" (akce: ${message.action}). Povolit?`;
    const confirmed = await this.confirmationHandler(question, conversationId);

    if (confirmed) {
      logger.info(
        { source: message.source, target: message.target, action: message.action },
        'User confirmed inter-agent message',
      );
      return true;
    }

    logger.info(
      { source: message.source, target: message.target, action: message.action },
      'User denied inter-agent message',
    );
    return false;
  }

  /**
   * Set LLM provider for intent routing.
   * If not set, the router falls back to hardcoded keyword matching.
   */
  setLLMProvider(provider: ILLMProvider): void {
    this.intentRouter.setLLMProvider(provider);
    logger.info({ providerId: provider.id }, 'LLM provider set on Master Agent');
  }

  async handleUserMessage(message: UserMessage): Promise<AgentResponse> {
    const conversationId = message.metadata?.conversationId as string || message.id;

    logger.info(
      { conversationId, channelId: message.channelId, type: message.type },
      'Handling user message',
    );

    // Route intent
    const route = await this.intentRouter.route(message.content);

    if (!route.agentId) {
      const response = this.createFallbackResponse(message, conversationId);
      this.conversationContext.addEntry(conversationId, message, response);
      return response;
    }

    // Dispatch to sub-agent
    try {
      const agentMessage = this.buildAgentMessage(message, route.agentId, route.action, conversationId);
      const response = await this.routeToAgent(route.agentId, agentMessage);
      this.conversationContext.setActiveAgent(conversationId, route.agentId);
      this.conversationContext.addEntry(conversationId, message, response);
      return response;
    } catch (err) {
      logger.error({ err, agentId: route.agentId }, 'Error routing to agent');
      const response = this.createErrorResponse(conversationId, route.agentId);
      this.conversationContext.addEntry(conversationId, message, response);
      return response;
    }
  }

  registerSubAgent(agent: ISubAgent): void {
    this.agentRegistry.register(agent);
  }

  unregisterSubAgent(agentId: string): void {
    this.agentRegistry.unregister(agentId);
  }

  getRegisteredAgents(): SubAgentInfo[] {
    return this.agentRegistry.getAllInfo();
  }

  async routeToAgent(agentId: string, message: AgentMessage): Promise<AgentResponse> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent "${agentId}" not found`, agentId, 'AGENT_NOT_FOUND');
    }

    // Direct call for in-process agents
    return agent.handleMessage(message);
  }

  async shutdown(): Promise<void> {
    const agents = this.agentRegistry.getAll();
    for (const agent of agents) {
      try {
        if (typeof (agent as any).shutdown === 'function') {
          await (agent as any).shutdown();
        }
      } catch (err) {
        logger.error({ err, agentId: agent.id }, 'Error shutting down agent');
      }
    }
    this.pendingConfirmations.clear();
    logger.info('Master Agent shut down');
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  private buildAgentMessage(
    userMessage: UserMessage,
    targetAgentId: string,
    action: string,
    conversationId: string,
  ): AgentMessage {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      source: this.id,
      target: targetAgentId,
      type: MessageType.REQUEST,
      action,
      payload: {
        content: userMessage.content,
        type: userMessage.type,
        attachment: userMessage.attachment,
        senderId: userMessage.senderId,
      },
      conversationId,
    };
  }

  private createFallbackResponse(message: UserMessage, conversationId: string): AgentResponse {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      agentId: this.id,
      conversationId,
      text: `Přijal jsem zprávu: "${message.content}". Zatím nemám agenta, který by ji zpracoval.`,
    };
  }

  private createErrorResponse(conversationId: string, agentId: string): AgentResponse {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      agentId: this.id,
      conversationId,
      text: `Došlo k chybě při komunikaci s agentem "${agentId}". Zkuste to prosím znovu.`,
      error: { code: 'AGENT_ERROR', message: `Failed to communicate with agent ${agentId}` },
    };
  }
}
