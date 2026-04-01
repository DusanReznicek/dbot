import matter from 'gray-matter';
import type { ISkill, SkillConfig, SkillResult, ActionDescriptor } from '../../core/interfaces/skill.interface.js';
import { createLogger } from '../../core/utils/logger.js';
import mdManifest from './skill.manifest.json' with { type: 'json' };

const logger = createLogger('MarkdownParserSkill');

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  links: Link[];
  tags: string[];
}

export interface Link {
  type: 'wikilink' | 'markdown';
  target: string;
  displayText?: string;
}

export class MarkdownParserSkill implements ISkill {
  public readonly id = 'markdown-parser';
  public readonly name = 'Markdown Parser';
  public readonly version = '1.0.0';
  public readonly description = mdManifest.description;

  async initialize(_config: SkillConfig): Promise<void> {
    logger.info('MarkdownParser skill initialized');
  }

  async execute(action: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (action) {
      case 'parse': return this.parse(params.content as string);
      case 'stringify': return this.stringify(params.body as string, params.frontmatter as Record<string, unknown> | undefined);
      case 'getFrontmatter': return this.getFrontmatter(params.content as string);
      case 'setFrontmatter': return this.setFrontmatter(params.content as string, params.data as Record<string, unknown>);
      case 'extractLinks': return this.extractLinksAction(params.content as string);
      case 'extractTags': return this.extractTagsAction(params.content as string);
      default:
        return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` } };
    }
  }

  getAvailableActions(): ActionDescriptor[] {
    return mdManifest.actions as ActionDescriptor[];
  }

  async shutdown(): Promise<void> {
    logger.info('MarkdownParser skill shut down');
  }

  // --- Actions ---

  private parse(content: string): SkillResult {
    const { data: frontmatter, content: body } = matter(content);
    const links = extractLinks(content);
    const tags = extractTags(content, frontmatter);
    const parsed: ParsedMarkdown = { frontmatter, body: body.trim(), links, tags };
    return { success: true, data: parsed };
  }

  private stringify(body: string, frontmatter?: Record<string, unknown>): SkillResult {
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      const result = matter.stringify(body, frontmatter);
      return { success: true, data: result };
    }
    return { success: true, data: body };
  }

  private getFrontmatter(content: string): SkillResult {
    const { data } = matter(content);
    return { success: true, data };
  }

  private setFrontmatter(content: string, data: Record<string, unknown>): SkillResult {
    const parsed = matter(content);
    const merged = { ...parsed.data, ...data };
    const result = matter.stringify(parsed.content, merged);
    return { success: true, data: result };
  }

  private extractLinksAction(content: string): SkillResult {
    return { success: true, data: extractLinks(content) };
  }

  private extractTagsAction(content: string): SkillResult {
    const { data: frontmatter } = matter(content);
    return { success: true, data: extractTags(content, frontmatter) };
  }
}

// --- Pure functions ---

/**
 * Extract [[wikilinks]] and [markdown](links) from content.
 */
export function extractLinks(content: string): Link[] {
  const links: Link[] = [];

  // Wikilinks: [[target]] or [[target|display text]]
  const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiRegex.exec(content)) !== null) {
    links.push({
      type: 'wikilink',
      target: match[1].trim(),
      displayText: match[2]?.trim(),
    });
  }

  // Markdown links: [text](url)
  const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = mdRegex.exec(content)) !== null) {
    links.push({
      type: 'markdown',
      target: match[2].trim(),
      displayText: match[1].trim(),
    });
  }

  return links;
}

/**
 * Extract #tags from content body and frontmatter tags field.
 */
export function extractTags(content: string, frontmatter?: Record<string, unknown>): string[] {
  const tagSet = new Set<string>();

  // Inline #tags (not inside code blocks or links)
  const tagRegex = /(?:^|\s)#([a-zA-Z\u00C0-\u024F][\w\u00C0-\u024F/-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    tagSet.add(match[1]);
  }

  // Frontmatter tags field
  if (frontmatter?.tags) {
    const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
    for (const tag of fmTags) {
      if (typeof tag === 'string') {
        tagSet.add(tag.replace(/^#/, ''));
      }
    }
  }

  return Array.from(tagSet);
}
