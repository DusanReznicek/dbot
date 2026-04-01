import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownParserSkill, extractLinks, extractTags } from '../../../src/skills/markdown-parser/markdown-parser.skill.js';

describe('MarkdownParserSkill', () => {
  let skill: MarkdownParserSkill;

  beforeEach(async () => {
    skill = new MarkdownParserSkill();
    await skill.initialize({});
  });

  describe('parse', () => {
    it('parses frontmatter, body, links and tags', async () => {
      const content = `---
title: Test Note
tags: [project]
---

# Hello

Some text with [[WikiLink]] and [Google](https://google.com) #idea
`;
      const result = await skill.execute('parse', { content });
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.frontmatter.title).toBe('Test Note');
      expect(data.body).toContain('# Hello');
      expect(data.links).toHaveLength(2);
      expect(data.tags).toContain('project');
      expect(data.tags).toContain('idea');
    });

    it('parses content without frontmatter', async () => {
      const result = await skill.execute('parse', { content: '# Just a heading\n\nSome text.' });
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.frontmatter).toEqual({});
      expect(data.body).toContain('Just a heading');
    });
  });

  describe('stringify', () => {
    it('produces markdown with frontmatter', async () => {
      const result = await skill.execute('stringify', {
        body: '# Hello',
        frontmatter: { title: 'Test' },
      });
      expect(result.success).toBe(true);
      const output = result.data as string;
      expect(output).toContain('---');
      expect(output).toContain('title: Test');
      expect(output).toContain('# Hello');
    });

    it('returns body only when no frontmatter', async () => {
      const result = await skill.execute('stringify', { body: '# Hello' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('# Hello');
    });
  });

  describe('getFrontmatter', () => {
    it('extracts frontmatter data', async () => {
      const content = '---\ntitle: Note\nauthor: John\n---\nBody here';
      const result = await skill.execute('getFrontmatter', { content });
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.title).toBe('Note');
      expect(data.author).toBe('John');
    });
  });

  describe('setFrontmatter', () => {
    it('merges new frontmatter into existing', async () => {
      const content = '---\ntitle: Old\n---\nBody';
      const result = await skill.execute('setFrontmatter', {
        content,
        data: { title: 'New', status: 'draft' },
      });
      expect(result.success).toBe(true);
      const output = result.data as string;
      expect(output).toContain('title: New');
      expect(output).toContain('status: draft');
      expect(output).toContain('Body');
    });
  });

  describe('extractLinks', () => {
    it('extracts wikilinks and markdown links', async () => {
      const content = 'See [[Note A]] and [[Note B|display]] and [link](http://example.com)';
      const result = await skill.execute('extractLinks', { content });
      expect(result.success).toBe(true);
      const links = result.data as any[];
      expect(links).toHaveLength(3);
      expect(links[0]).toEqual({ type: 'wikilink', target: 'Note A', displayText: undefined });
      expect(links[1]).toEqual({ type: 'wikilink', target: 'Note B', displayText: 'display' });
      expect(links[2]).toEqual({ type: 'markdown', target: 'http://example.com', displayText: 'link' });
    });
  });

  describe('extractTags', () => {
    it('extracts inline and frontmatter tags', async () => {
      const content = '---\ntags: [meta]\n---\n\nSome #inline text #another';
      const result = await skill.execute('extractTags', { content });
      expect(result.success).toBe(true);
      const tags = result.data as string[];
      expect(tags).toContain('meta');
      expect(tags).toContain('inline');
      expect(tags).toContain('another');
    });

    it('deduplicates tags', async () => {
      const content = '---\ntags: [dup]\n---\n\n#dup again';
      const result = await skill.execute('extractTags', { content });
      const tags = result.data as string[];
      const dupCount = tags.filter((t) => t === 'dup').length;
      expect(dupCount).toBe(1);
    });
  });

  describe('unknown action', () => {
    it('returns error for unknown action', async () => {
      const result = await skill.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ACTION');
    });
  });
});

describe('extractLinks (pure function)', () => {
  it('handles content with no links', () => {
    expect(extractLinks('Just plain text')).toEqual([]);
  });

  it('handles wikilink with display text', () => {
    const links = extractLinks('See [[target|shown]]');
    expect(links[0].displayText).toBe('shown');
  });
});

describe('extractTags (pure function)', () => {
  it('handles frontmatter tags as single string', () => {
    const tags = extractTags('', { tags: 'single' });
    expect(tags).toContain('single');
  });

  it('strips # prefix from frontmatter tags', () => {
    const tags = extractTags('', { tags: ['#prefixed'] });
    expect(tags).toContain('prefixed');
    expect(tags).not.toContain('#prefixed');
  });
});
