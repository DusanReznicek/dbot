import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemSkill } from '../../../src/skills/file-system/file-system.skill.js';

describe('FileSystemSkill', () => {
  let skill: FileSystemSkill;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dbot-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    skill = new FileSystemSkill();
    await skill.initialize({ basePath: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('write + read file', async () => {
    await skill.execute('write', { path: 'test.md', content: '# Hello' });
    const result = await skill.execute('read', { path: 'test.md' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('# Hello');
  });

  it('write creates nested directories', async () => {
    await skill.execute('write', { path: 'sub/dir/note.md', content: 'nested' });
    const result = await skill.execute('read', { path: 'sub/dir/note.md' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('nested');
  });

  it('read non-existent file returns error', async () => {
    const result = await skill.execute('read', { path: 'nonexistent.md' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('append to file', async () => {
    await skill.execute('write', { path: 'append.md', content: 'line1\n' });
    await skill.execute('append', { path: 'append.md', content: 'line2\n' });
    const result = await skill.execute('read', { path: 'append.md' });
    expect(result.data).toBe('line1\nline2\n');
  });

  it('delete file', async () => {
    await skill.execute('write', { path: 'delete-me.md', content: 'bye' });
    const delResult = await skill.execute('delete', { path: 'delete-me.md' });
    expect(delResult.success).toBe(true);
    const existsResult = await skill.execute('exists', { path: 'delete-me.md' });
    expect(existsResult.data).toBe(false);
  });

  it('list files', async () => {
    await skill.execute('write', { path: 'a.md', content: '' });
    await skill.execute('write', { path: 'b.md', content: '' });
    await skill.execute('write', { path: 'sub/c.md', content: '' });
    const result = await skill.execute('list', { dir: '.' });
    expect(result.success).toBe(true);
    const files = result.data as string[];
    expect(files).toContain('a.md');
    expect(files).toContain('b.md');
    expect(files).toContain(join('sub', 'c.md'));
  });

  it('list with pattern filter', async () => {
    await skill.execute('write', { path: 'note.md', content: '' });
    await skill.execute('write', { path: 'readme.txt', content: '' });
    const result = await skill.execute('list', { dir: '.', pattern: '*.md' });
    const files = result.data as string[];
    expect(files).toContain('note.md');
    expect(files).not.toContain('readme.txt');
  });

  it('exists returns true for existing file', async () => {
    await skill.execute('write', { path: 'exists.md', content: '' });
    const result = await skill.execute('exists', { path: 'exists.md' });
    expect(result.data).toBe(true);
  });

  it('path traversal throws SkillError', async () => {
    await expect(skill.execute('read', { path: '../../../etc/passwd' })).rejects.toThrow('Path traversal');
  });

  it('path traversal with absolute path', async () => {
    await expect(skill.execute('read', { path: '/etc/passwd' })).rejects.toThrow('Path traversal');
  });
});
