import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObsidianAgent } from '../../../src/agents/obsidian-agent/obsidian-agent.js';
import type { AgentMessage } from '../../../src/core/interfaces/message.interface.js';

function createMockSkill(responses: Record<string, any> = {}) {
  return {
    id: 'mock',
    name: 'Mock',
    version: '1.0.0',
    description: 'mock',
    initialize: vi.fn(),
    execute: vi.fn(async (action: string, params: any) => {
      const key = `${action}:${params.path || params.dir || params.content || ''}`;
      if (responses[key]) return responses[key];
      if (responses[action]) return responses[action];
      return { success: true, data: null };
    }),
    getAvailableActions: vi.fn(() => []),
    shutdown: vi.fn(),
  };
}

function msg(action: string, content: string): AgentMessage {
  return {
    id: 'test-id',
    timestamp: Date.now(),
    conversationId: 'conv-1',
    action,
    payload: { content },
  };
}

describe('ObsidianAgent', () => {
  let agent: ObsidianAgent;
  let fsMock: ReturnType<typeof createMockSkill>;
  let mdMock: ReturnType<typeof createMockSkill>;
  let syncMock: ReturnType<typeof createMockSkill>;

  beforeEach(async () => {
    fsMock = createMockSkill({
      'read:test.md': { success: true, data: '---\ntitle: Test\n---\n\nHello world #tag1' },
      'read:missing.md': { success: false, error: { code: 'NOT_FOUND', message: 'not found' } },
      'write': { success: true, data: null },
      'list': { success: true, data: ['note1.md', 'sub/note2.md'] },
    });

    mdMock = createMockSkill({
      'parse': {
        success: true,
        data: {
          frontmatter: { title: 'Test' },
          body: 'Hello world #tag1',
          links: [],
          tags: ['tag1'],
        },
      },
      'stringify': { success: true, data: '---\ntitle: Test\n---\nHello world' },
      'getFrontmatter': { success: true, data: { title: 'Test' } },
      'setFrontmatter': { success: true, data: '---\ntitle: New\n---\nHello world' },
    });

    syncMock = createMockSkill({
      'sync': { success: true, data: { status: 'synced' } },
    });

    agent = new ObsidianAgent();
    await agent.initialize({
      config: {
        vaultPath: '/tmp/test-vault',
        syncEnabled: true,
        defaultFolder: '/',
        excludePatterns: [],
      } as unknown as Record<string, unknown>,
      skills: new Map<string, unknown>([
        ['file-system', fsMock],
        ['markdown-parser', mdMock],
        ['obsidian-sync', syncMock],
      ]),
      llmProvider: null,
    });
  });

  it('has correct id and capabilities', () => {
    expect(agent.id).toBe('obsidian-agent');
    expect(agent.capabilities).toContain('obsidian.read');
    expect(agent.capabilities).toContain('obsidian.write');
    expect(agent.capabilities).toContain('obsidian.search');
    expect(agent.capabilities).toContain('obsidian.sync');
  });

  it('reads a note successfully', async () => {
    const response = await agent.handleMessage(msg('obsidian.read', 'Přečti test.md'));
    expect(response.text).toContain('test.md');
    expect(response.text).toContain('Hello world');
    expect(response.error).toBeUndefined();
  });

  it('returns not found for missing note', async () => {
    fsMock.execute.mockImplementation(async (action: string, params: any) => {
      if (action === 'read') return { success: false, error: { code: 'NOT_FOUND', message: 'not found' } };
      return { success: true, data: null };
    });
    const response = await agent.handleMessage(msg('obsidian.read', 'Přečti missing.md'));
    expect(response.text).toContain('nebyla nalezena');
  });

  it('writes a note via Czech command', async () => {
    const response = await agent.handleMessage(
      msg('obsidian.write', 'Vytvoř poznámku Meeting notes s obsahem: Zápis ze schůzky'),
    );
    expect(response.text).toContain('vytvořena');
    expect(fsMock.execute).toHaveBeenCalledWith('write', expect.objectContaining({ path: expect.stringContaining('Meeting notes') }));
  });

  it('returns error when write command is unparseable', async () => {
    const response = await agent.handleMessage(msg('obsidian.write', 'something random'));
    expect(response.text).toContain('specifikuj');
  });

  it('lists notes', async () => {
    const response = await agent.handleMessage(msg('obsidian.list', 'Vypiš poznámky'));
    expect(response.text).toContain('note1.md');
    expect(response.text).toContain('note2.md');
  });

  it('handles sync action', async () => {
    const response = await agent.handleMessage(msg('obsidian.sync', 'Synchronizuj'));
    expect(response.text).toContain('successfully');
    expect(syncMock.execute).toHaveBeenCalledWith('sync', {});
  });

  it('handles sync disabled', async () => {
    // Re-initialize with sync disabled
    const disabledAgent = new ObsidianAgent();
    await disabledAgent.initialize({
      config: {
        vaultPath: '/tmp/test-vault',
        syncEnabled: false,
        defaultFolder: '/',
        excludePatterns: [],
      } as unknown as Record<string, unknown>,
      skills: new Map<string, unknown>([
        ['file-system', fsMock],
        ['markdown-parser', mdMock],
        ['obsidian-sync', syncMock],
      ]),
      llmProvider: null,
    });
    const response = await disabledAgent.handleMessage(msg('obsidian.sync', 'Sync'));
    expect(response.text).toContain('disabled');
  });

  it('returns unknown action message', async () => {
    const response = await agent.handleMessage(msg('obsidian.unknown', 'test'));
    expect(response.text).toContain('Neznámá akce');
  });

  it('returns metadata for a note', async () => {
    const response = await agent.handleMessage(msg('obsidian.metadata', 'Metadata test.md'));
    expect(response.text).toContain('title');
  });

  it('getHealthStatus returns healthy', () => {
    const status = agent.getHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it('handles read without path gracefully', async () => {
    const response = await agent.handleMessage(msg('obsidian.read', 'přečti něco'));
    expect(response.text).toContain('specifikuj');
  });

  // ---- Task handling ----

  it('has task and daily capabilities', () => {
    expect(agent.capabilities).toContain('obsidian.task');
    expect(agent.capabilities).toContain('obsidian.daily');
  });

  it('appends task to existing tasks file', async () => {
    fsMock.execute.mockImplementation(async (action: string, params: any) => {
      if (action === 'exists') return { success: true, data: true };
      if (action === 'append') return { success: true, data: null };
      return { success: true, data: null };
    });

    const response = await agent.handleMessage(msg('obsidian.task', 'Přidej úkol: Zavolat doktorovi'));
    expect(response.text).toContain('Úkol přidán');
    expect(response.text).toContain('Zavolat doktorovi');
    expect(fsMock.execute).toHaveBeenCalledWith('append', expect.objectContaining({
      path: 'tasks.md',
      content: expect.stringContaining('- [ ] Zavolat doktorovi'),
    }));
  });

  it('creates task file if it does not exist', async () => {
    fsMock.execute.mockImplementation(async (action: string, params: any) => {
      if (action === 'exists') return { success: true, data: false };
      if (action === 'write') return { success: true, data: null };
      return { success: true, data: null };
    });
    mdMock.execute.mockImplementation(async (action: string) => {
      if (action === 'stringify') return { success: true, data: '---\ntype: tasks\n---\n- [ ] Koupit mléko' };
      return { success: true, data: null };
    });

    const response = await agent.handleMessage(msg('obsidian.task', 'Task: Koupit mléko'));
    expect(response.text).toContain('Úkol přidán');
    expect(response.text).toContain('Koupit mléko');
    expect(fsMock.execute).toHaveBeenCalledWith('write', expect.objectContaining({
      path: 'tasks.md',
    }));
  });

  it('returns error when task text is unparseable', async () => {
    const response = await agent.handleMessage(msg('obsidian.task', 'ab'));
    expect(response.text).toContain('specifikuj');
  });

  // ---- Daily note handling ----

  it('appends to daily note with timestamp', async () => {
    fsMock.execute.mockImplementation(async (action: string, params: any) => {
      if (action === 'exists') return { success: true, data: true };
      if (action === 'append') return { success: true, data: null };
      return { success: true, data: null };
    });

    const response = await agent.handleMessage(msg('obsidian.daily', 'Zapiš: Dokončil jsem projekt'));
    expect(response.text).toContain('Zapsáno do denní poznámky');
    expect(response.text).toContain('Dokončil jsem projekt');
    expect(fsMock.execute).toHaveBeenCalledWith('append', expect.objectContaining({
      path: expect.stringMatching(/^daily\/\d{4}-\d{2}-\d{2}\.md$/),
      content: expect.stringMatching(/- \*\*\d{2}:\d{2}\*\* Dokončil jsem projekt/),
    }));
  });

  it('daily note path matches YYYY-MM-DD format', async () => {
    fsMock.execute.mockImplementation(async (action: string) => {
      if (action === 'exists') return { success: true, data: false };
      if (action === 'write') return { success: true, data: null };
      return { success: true, data: null };
    });
    mdMock.execute.mockImplementation(async (action: string) => {
      if (action === 'stringify') return { success: true, data: '---\ntype: daily\n---\ncontent' };
      return { success: true, data: null };
    });

    const response = await agent.handleMessage(msg('obsidian.daily', 'Daily note: Test entry'));
    expect(response.text).toContain('Zapsáno');
    // Verify the path used for the daily note
    const writeCalls = fsMock.execute.mock.calls.filter((c: any[]) => c[0] === 'write');
    expect(writeCalls.length).toBeGreaterThan(0);
    const writePath = writeCalls[0][1].path;
    expect(writePath).toMatch(/^daily\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('returns error when daily note text is unparseable', async () => {
    const response = await agent.handleMessage(msg('obsidian.daily', 'ab'));
    expect(response.text).toContain('specifikuj');
  });
});
