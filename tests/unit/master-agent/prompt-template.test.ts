import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../../src/master-agent/prompt-template.js';

describe('resolveTemplate', () => {
  it('resolves {{date}} to current date', () => {
    const result = resolveTemplate('Today is {{date}}', {});
    const today = new Date().toISOString().split('T')[0];
    expect(result).toBe(`Today is ${today}`);
  });

  it('resolves {{date}} to provided date', () => {
    const result = resolveTemplate('Date: {{date}}', { date: '2026-04-01' });
    expect(result).toBe('Date: 2026-04-01');
  });

  it('resolves {{agents}} to JSON', () => {
    const agents = [
      { id: 'obsidian-agent', name: 'Obsidian', description: 'Vault manager', capabilities: ['obsidian.read'] },
    ];
    const result = resolveTemplate('Agents: {{agents}}', { agents });
    expect(result).toContain('"id": "obsidian-agent"');
    expect(result).toContain('"name": "Obsidian"');
  });

  it('resolves {{agentNames}} to comma-separated names', () => {
    const agents = [
      { id: 'a', name: 'Agent A', description: '', capabilities: [] },
      { id: 'b', name: 'Agent B', description: '', capabilities: [] },
    ];
    const result = resolveTemplate('Names: {{agentNames}}', { agents });
    expect(result).toBe('Names: Agent A, Agent B');
  });

  it('resolves {{capabilities}} to flat list', () => {
    const agents = [
      { id: 'a', name: 'A', description: '', capabilities: ['read', 'write'] },
      { id: 'b', name: 'B', description: '', capabilities: ['search'] },
    ];
    const result = resolveTemplate('Caps: {{capabilities}}', { agents });
    expect(result).toBe('Caps: read, write, search');
  });

  it('resolves {{message}} variable', () => {
    const result = resolveTemplate('Got: "{{message}}"', { message: 'Hello world' });
    expect(result).toBe('Got: "Hello world"');
  });

  it('leaves unknown variables untouched', () => {
    const result = resolveTemplate('Hello {{unknown}} world', {});
    expect(result).toBe('Hello {{unknown}} world');
  });

  it('resolves custom string context values', () => {
    const result = resolveTemplate('User: {{userName}}', { userName: 'Dušan' });
    expect(result).toBe('User: Dušan');
  });

  it('returns empty string for empty template', () => {
    expect(resolveTemplate('', {})).toBe('');
  });

  it('handles multiple variables in one template', () => {
    const result = resolveTemplate(
      'Date: {{date}}, Names: {{agentNames}}',
      {
        date: '2026-04-01',
        agents: [{ id: 'a', name: 'Agent A', description: '', capabilities: [] }],
      },
    );
    expect(result).toBe('Date: 2026-04-01, Names: Agent A');
  });

  it('resolves {{agents}} to empty array when no agents', () => {
    const result = resolveTemplate('Agents: {{agents}}', { agents: [] });
    expect(result).toBe('Agents: []');
  });
});
