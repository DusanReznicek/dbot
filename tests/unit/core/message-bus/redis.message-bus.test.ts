/**
 * Unit tests for RedisMessageBus using mocked ioredis.
 * These tests verify the bus logic without requiring a real Redis instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MessageType } from '../../../../src/core/interfaces/message.interface.js';
import type { AgentMessage } from '../../../../src/core/interfaces/message.interface.js';

// ─── Mock ioredis ────────────────────────────────────────────────────────────
class MockRedis extends EventEmitter {
  connected = false;
  subscribedChannels = new Set<string>();

  async connect() {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  async publish(_channel: string, _message: string): Promise<number> {
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    this.subscribedChannels.add(channel);
  }

  async unsubscribe(channel?: string): Promise<void> {
    if (channel) {
      this.subscribedChannels.delete(channel);
    } else {
      this.subscribedChannels.clear();
    }
  }

  // Simulate receiving a message from Redis
  simulateMessage(channel: string, raw: string) {
    this.emit('message', channel, raw);
  }
}

let mockInstances: MockRedis[] = [];

vi.mock('ioredis', () => {
  return {
    default: class {
      private mock: MockRedis;
      constructor() {
        this.mock = new MockRedis();
        mockInstances.push(this.mock);
        // Proxy EventEmitter methods
        return new Proxy(this, {
          get: (target, prop) => {
            if (prop in target) return (target as any)[prop];
            return (target.mock as any)[prop]?.bind?.(target.mock) ?? (target.mock as any)[prop];
          },
        });
      }
    },
  };
});

// Import AFTER mock is set up
const { RedisMessageBus } = await import('../../../../src/core/message-bus/redis.message-bus.js');

function createMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    timestamp: Date.now(),
    source: 'test-source',
    target: 'test-target',
    type: MessageType.REQUEST,
    action: 'test.action',
    payload: { content: 'hello' },
    conversationId: 'conv-1',
    ...overrides,
  };
}

describe('RedisMessageBus', () => {
  let bus: InstanceType<typeof RedisMessageBus>;

  beforeEach(() => {
    mockInstances = [];
    bus = new RedisMessageBus({ host: 'localhost', port: 6379 });
  });

  it('creates publisher and subscriber Redis clients', () => {
    // Constructor creates two Redis instances
    expect(mockInstances.length).toBe(2);
  });

  it('connect() connects both clients', async () => {
    await bus.connect();
    expect(mockInstances[0].connected).toBe(true);
    expect(mockInstances[1].connected).toBe(true);
  });

  it('publish() serializes message to JSON', async () => {
    await bus.connect();
    const publishSpy = vi.spyOn(mockInstances[0], 'publish');
    const msg = createMessage({ source: undefined, target: undefined } as any);

    await bus.publish('test-channel', msg);
    expect(publishSpy).toHaveBeenCalledWith('test-channel', JSON.stringify(msg));
  });

  it('subscribe() subscribes to Redis channel on first handler', () => {
    const subscribeSpy = vi.spyOn(mockInstances[1], 'subscribe');

    bus.subscribe('my-channel', vi.fn());
    expect(subscribeSpy).toHaveBeenCalledWith('my-channel');
  });

  it('delivers incoming Redis messages to local handlers', async () => {
    await bus.connect();
    const handler = vi.fn();
    bus.subscribe('my-channel', handler);

    const msg = createMessage();
    // Simulate Redis delivering a message
    mockInstances[1].simulateMessage('my-channel', JSON.stringify(msg));

    // Handler is called async, wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));
  });

  it('unsubscribe removes handler and unsubscribes from Redis when last', () => {
    const unsubSpy = vi.spyOn(mockInstances[1], 'unsubscribe');

    const sub = bus.subscribe('my-channel', vi.fn());
    sub.unsubscribe();

    expect(unsubSpy).toHaveBeenCalledWith('my-channel');
  });

  it('shutdown() disconnects both clients', async () => {
    await bus.connect();
    await bus.shutdown();
    expect(mockInstances[0].connected).toBe(false);
    expect(mockInstances[1].connected).toBe(false);
  });

  it('blocks inter-agent messages when permission manager denies', async () => {
    await bus.connect();
    const mockPermManager = {
      check: vi.fn().mockReturnValue({ allowed: false, requireConfirmation: false, reason: 'Denied' }),
    };
    bus.setPermissionManager(mockPermManager as any);

    const msg = createMessage({ source: 'agent-a', target: 'agent-b' });
    await expect(bus.publish('ch', msg)).rejects.toThrow('Denied');
  });

  it('holds message when confirmation is required', async () => {
    await bus.connect();
    const mockPermManager = {
      check: vi.fn().mockReturnValue({
        allowed: true,
        requireConfirmation: true,
        rule: { id: 'rule-1' },
      }),
    };
    bus.setPermissionManager(mockPermManager as any);

    const publishSpy = vi.spyOn(mockInstances[0], 'publish');
    const msg = createMessage({ source: 'agent-a', target: 'agent-b' });

    await bus.publish('ch', msg);
    // Should publish to confirmation channel, not the original
    expect(publishSpy).toHaveBeenCalledWith(
      'permission:confirmation-required',
      expect.any(String),
    );
  });
});
