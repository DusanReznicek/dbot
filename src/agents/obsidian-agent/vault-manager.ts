import type { FileSystemSkill } from '../../skills/file-system/file-system.skill.js';
import type { MarkdownParserSkill, ParsedMarkdown } from '../../skills/markdown-parser/markdown-parser.skill.js';
import type { ObsidianSyncSkill } from '../../skills/obsidian-sync/obsidian-sync.skill.js';
import { createLogger } from '../../core/utils/logger.js';
import type { ObsidianAgentConfig } from './obsidian-agent.config.js';

const logger = createLogger('VaultManager');

export interface NoteInfo {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  links: Array<{ type: string; target: string; displayText?: string }>;
  tags: string[];
}

export interface SearchResult {
  path: string;
  snippet: string;
  matchCount: number;
}

export class VaultManager {
  constructor(
    private fileSystem: FileSystemSkill,
    private markdownParser: MarkdownParserSkill,
    private obsidianSync: ObsidianSyncSkill,
    private config: ObsidianAgentConfig,
  ) {}

  async readNote(path: string): Promise<NoteInfo | null> {
    const result = await this.fileSystem.execute('read', { path });
    if (!result.success) return null;

    const content = result.data as string;
    const parsed = await this.markdownParser.execute('parse', { content });
    if (!parsed.success) return null;

    const md = parsed.data as ParsedMarkdown;
    return {
      path,
      frontmatter: md.frontmatter,
      body: md.body,
      links: md.links,
      tags: md.tags,
    };
  }

  async writeNote(
    path: string,
    content: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<boolean> {
    let finalContent = content;

    if (frontmatter) {
      const result = await this.markdownParser.execute('stringify', { body: content, frontmatter });
      if (result.success) {
        finalContent = result.data as string;
      }
    }

    const result = await this.fileSystem.execute('write', { path, content: finalContent });
    if (result.success) {
      logger.info({ path }, 'Note written');
    }
    return result.success;
  }

  async editNote(
    path: string,
    content?: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<boolean> {
    const existing = await this.readNote(path);
    if (!existing) return false;

    const newBody = content ?? existing.body;
    const newFrontmatter = frontmatter
      ? { ...existing.frontmatter, ...frontmatter }
      : existing.frontmatter;

    return this.writeNote(path, newBody, newFrontmatter);
  }

  async searchNotes(query: string): Promise<SearchResult[]> {
    const listResult = await this.fileSystem.execute('list', { dir: '/', pattern: '*.md' });
    if (!listResult.success) return [];

    const files = listResult.data as string[];
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const filePath of files) {
      // Check if query matches filename
      const fileNameMatch = filePath.toLowerCase().includes(queryLower);

      const readResult = await this.fileSystem.execute('read', { path: filePath });
      if (!readResult.success) continue;

      const content = (readResult.data as string).toLowerCase();
      const contentMatch = content.includes(queryLower);

      if (fileNameMatch || contentMatch) {
        // Extract snippet around the match
        const rawContent = readResult.data as string;
        const snippet = this.extractSnippet(rawContent, query);
        const matchCount = (content.match(new RegExp(this.escapeRegex(queryLower), 'g')) || []).length;

        results.push({ path: filePath, snippet, matchCount });
      }
    }

    // Sort by match count (most matches first)
    results.sort((a, b) => b.matchCount - a.matchCount);
    return results;
  }

  async listNotes(dir?: string): Promise<string[]> {
    const result = await this.fileSystem.execute('list', { dir: dir || '/', pattern: '*.md' });
    if (!result.success) return [];
    return result.data as string[];
  }

  async getMetadata(path: string): Promise<Record<string, unknown> | null> {
    const readResult = await this.fileSystem.execute('read', { path });
    if (!readResult.success) return null;

    const fmResult = await this.markdownParser.execute('getFrontmatter', { content: readResult.data as string });
    if (!fmResult.success) return null;

    return fmResult.data as Record<string, unknown>;
  }

  async setMetadata(path: string, data: Record<string, unknown>): Promise<boolean> {
    const readResult = await this.fileSystem.execute('read', { path });
    if (!readResult.success) return false;

    const result = await this.markdownParser.execute('setFrontmatter', {
      content: readResult.data as string,
      data,
    });
    if (!result.success) return false;

    const writeResult = await this.fileSystem.execute('write', { path, content: result.data as string });
    return writeResult.success;
  }

  /**
   * Append content to an existing note, or create it if it doesn't exist.
   */
  async appendToNote(
    path: string,
    content: string,
    defaultFrontmatter?: Record<string, unknown>,
  ): Promise<boolean> {
    const existsResult = await this.fileSystem.execute('exists', { path });
    const fileExists = existsResult.success && existsResult.data === true;

    if (fileExists) {
      const result = await this.fileSystem.execute('append', { path, content: '\n' + content });
      if (result.success) {
        logger.info({ path }, 'Content appended to note');
      }
      return result.success;
    }

    // File doesn't exist — create with frontmatter
    return this.writeNote(path, content, defaultFrontmatter);
  }

  /**
   * Get the daily note path for a given date (defaults to today).
   * Returns: `{dailyNotesFolder}/YYYY-MM-DD.md`
   */
  getDailyNotePath(date?: Date): string {
    const d = date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const folder = this.config.dailyNotesFolder || 'daily';
    return `${folder}/${dateStr}.md`;
  }

  async syncVault(): Promise<{ success: boolean; message: string }> {
    if (!this.config.syncEnabled) {
      return { success: false, message: 'Sync is disabled in agent configuration' };
    }

    const result = await this.obsidianSync.execute('sync', {});
    if (result.success) {
      return { success: true, message: 'Vault synchronized successfully' };
    }
    return { success: false, message: result.error?.message || 'Sync failed' };
  }

  private extractSnippet(content: string, query: string, contextChars = 100): string {
    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(query.toLowerCase());
    if (idx === -1) {
      return content.slice(0, contextChars * 2).trim() + '...';
    }
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(content.length, idx + query.length + contextChars);
    let snippet = content.slice(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet += '...';
    return snippet;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
