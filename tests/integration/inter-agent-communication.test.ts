import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMessageBus } from '../../src/core/message-bus/in-memory.message-bus.js';
import { PermissionManager } from '../../src/core/permissions/permission.manager.js';
import { MessageType } from '../../src/core/interfaces/message.interface.js';
import type { AgentMessage } from '../../src/core/interfaces/message.interface.js';

function createAgentMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    timestamp: Date.now(),
    source: 'agent-a',
    target: 'agent-b',
    type: MessageType.REQUEST,
    action: 'test.action',
    payload: { content: 'hello' },
    conversationId: 'conv-1',
    ...overrides,
  };
}

describe('Inter-agent communication with permissions', () => {
  let bus: InMemoryMessageBus;
  let permManager: PermissionManager;

  beforeEach(() => {
    bus = new InMemoryMessageBus();
    permManager = new PermissionManager();
    bus.setPermissionManager(permManager);
  });

  it('blocks inter-agent message when permissions are disabled', async () => {
    const message = createAgentMessage();
    await expect(bus.publish('test-channel', message)).rejects.toThrow('globally disabled');
  });

  it('blocks inter-agent message when no matching rule exists', async () => {
    permManager.setEnabled(true);
    const message = createAgentMessage();
    await expect(bus.publish('test-channel', message)).rejects.toThrow('No permission rule');
  });

  it('allows inter-agent message with matching rule', async () => {
    permManager.setEnabled(true);
    permManager.addRule({
      source: 'agent-a',
      target: 'agent-b',
      actions: ['test.action'],
      requireConfirmation: false,
    });

    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    await bus.publish('test-channel', createAgentMessage());
    expect(received).toHaveLength(1);
    expect(received[0].action).toBe('test.action');
  });

  it('holds message when confirmation is required', async () => {
    permManager.setEnabled(true);
    permManager.addRule({
      source: 'agent-a',
      target: 'agent-b',
      actions: [],
      requireConfirmation: true,
    });

    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    const confirmationEvents: unknown[] = [];
    bus.subscribe('permission:confirmation-required' as string, (event) => {
      confirmationEvents.push(event);
    });

    // Publish — should NOT deliver to subscribers, should emit confirmation event
    await bus.publish('test-channel', createAgentMessage());
    expect(received).toHaveLength(0);
  });

  it('allows messages without source/target (non inter-agent)', async () => {
    // Messages without both source and target skip permission checks
    const message = createAgentMessage({ source: undefined, target: undefined });

    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    await bus.publish('test-channel', message);
    expect(received).toHaveLength(1);
  });

  it('blocks wrong action even with existing rule', async () => {
    permManager.setEnabled(true);
    permManager.addRule({
      source: 'agent-a',
      target: 'agent-b',
      actions: ['allowed.action'],
      requireConfirmation: false,
    });

    const message = createAgentMessage({ action: 'forbidden.action' });
    await expect(bus.publish('test-channel', message)).rejects.toThrow('No permission rule');
  });

  it('runtime rule addition works immediately', async () => {
    permManager.setEnabled(true);

    const message = createAgentMessage();

    // First: blocked
    await expect(bus.publish('test-channel', message)).rejects.toThrow();

    // Add rule at runtime
    permManager.addRule({
      source: 'agent-a',
      target: 'agent-b',
      actions: ['test.action'],
      requireConfirmation: false,
    });

    // Now: allowed
    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    await bus.publish('test-channel', createAgentMessage());
    expect(received).toHaveLength(1);
  });

  it('runtime rule removal blocks previously allowed messages', async () => {
    permManager.setEnabled(true);
    const rule = permManager.addRule({
      source: 'agent-a',
      target: 'agent-b',
      actions: [],
      requireConfirmation: false,
    });

    // Allowed
    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });
    await bus.publish('test-channel', createAgentMessage());
    expect(received).toHaveLength(1);

    // Remove rule
    permManager.removeRule(rule.id);

    // Now blocked
    await expect(bus.publish('test-channel', createAgentMessage())).rejects.toThrow();
  });
});
