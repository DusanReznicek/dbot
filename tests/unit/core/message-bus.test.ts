import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryMessageBus } from '../../../src/core/message-bus/in-memory.message-bus.js';
import { MessageType } from '../../../src/core/interfaces/message.interface.js';
import type { AgentMessage } from '../../../src/core/interfaces/message.interface.js';

function createMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    source: 'test-source',
    target: 'test-target',
    type: MessageType.REQUEST,
    action: 'test.action',
    payload: {},
    conversationId: randomUUID(),
    ...overrides,
  };
}

describe('InMemoryMessageBus', () => {
  let bus: InMemoryMessageBus;

  beforeEach(() => {
    bus = new InMemoryMessageBus();
  });

  it('U1: publish + subscribe delivers message', async () => {
    const received: AgentMessage[] = [];
    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    const msg = createMessage();
    await bus.publish('test-channel', msg);

    // EventEmitter is sync, so message should be delivered immediately
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(msg.id);
  });

  it('U2: unsubscribe stops delivery', async () => {
    const received: AgentMessage[] = [];
    const sub = bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    sub.unsubscribe();
    await bus.publish('test-channel', createMessage());

    expect(received).toHaveLength(0);
  });

  it('U3: request-response correlation', async () => {
    const requestMsg = createMessage({ type: MessageType.REQUEST });

    // Simulate a responder
    bus.subscribe('test-channel', (msg) => {
      if (msg.type === MessageType.REQUEST) {
        const response = createMessage({
          type: MessageType.RESPONSE,
          parentMessageId: msg.id,
          source: 'responder',
          target: msg.source,
        });
        bus.publish('test-channel', response);
      }
    });

    const response = await bus.request('test-channel', requestMsg, 1000);
    expect(response.parentMessageId).toBe(requestMsg.id);
    expect(response.type).toBe(MessageType.RESPONSE);
  });

  it('U4: request timeout', async () => {
    const msg = createMessage();
    await expect(bus.request('test-channel', msg, 100)).rejects.toThrow('Request timeout');
  });

  it('U5: broadcast delivery to wildcard subscribers', async () => {
    const received: AgentMessage[] = [];
    bus.subscribe('*', (msg) => {
      received.push(msg);
    });

    await bus.publish('specific-channel', createMessage());

    expect(received).toHaveLength(1);
  });

  it('multiple subscribers on same channel', async () => {
    const received1: AgentMessage[] = [];
    const received2: AgentMessage[] = [];

    bus.subscribe('ch', (msg) => received1.push(msg));
    bus.subscribe('ch', (msg) => received2.push(msg));

    await bus.publish('ch', createMessage());

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('shutdown clears all subscriptions', async () => {
    const received: AgentMessage[] = [];
    bus.subscribe('ch', (msg) => received.push(msg));

    await bus.shutdown();
    await bus.publish('ch', createMessage());

    expect(received).toHaveLength(0);
  });
});
