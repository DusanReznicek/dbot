import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import type { ISkill, SkillConfig, SkillResult, ActionDescriptor } from '../../core/interfaces/skill.interface.js';
import { SkillError } from '../../core/utils/errors.js';
import { createLogger } from '../../core/utils/logger.js';
import manifest from './skill.manifest.json' with { type: 'json' };

const logger = createLogger('FileSystemSkill');

export class FileSystemSkill implements ISkill {
  public readonly id = 'file-system';
  public readonly name = 'File System';
  public readonly version = '1.0.0';
  public readonly description = manifest.description;

  private basePath = '';

  async initialize(config: SkillConfig): Promise<void> {
    const base = config.basePath as string;
    if (!base) {
      throw new SkillError('basePath is required', this.id);
    }
    this.basePath = resolve(base);
    if (!existsSync(this.basePath)) {
      throw new SkillError(`basePath does not exist: ${this.basePath}`, this.id);
    }
    logger.info({ basePath: this.basePath }, 'FileSystem skill initialized');
  }

  async execute(action: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (action) {
      case 'read': return this.read(params.path as string);
      case 'write': return this.write(params.path as string, params.content as string);
      case 'append': return this.append(params.path as string, params.content as string);
      case 'delete': return this.del(params.path as string);
      case 'list': return this.list(params.dir as string | undefined, params.pattern as string | undefined);
      case 'exists': return this.exists(params.path as string);
      default:
        return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` } };
    }
  }

  getAvailableActions(): ActionDescriptor[] {
    return manifest.actions as ActionDescriptor[];
  }

  async shutdown(): Promise<void> {
    logger.info('FileSystem skill shut down');
  }

  // --- Actions ---

  private read(filePath: string): SkillResult {
    const fullPath = this.safePath(filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: { code: 'NOT_FOUND', message: `File not found: ${filePath}` } };
    }
    const content = readFileSync(fullPath, 'utf-8');
    return { success: true, data: content };
  }

  private write(filePath: string, content: string): SkillResult {
    const fullPath = this.safePath(filePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content, 'utf-8');
    logger.debug({ path: filePath }, 'File written');
    return { success: true };
  }

  private append(filePath: string, content: string): SkillResult {
    const fullPath = this.safePath(filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: { code: 'NOT_FOUND', message: `File not found: ${filePath}` } };
    }
    appendFileSync(fullPath, content, 'utf-8');
    return { success: true };
  }

  private del(filePath: string): SkillResult {
    const fullPath = this.safePath(filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: { code: 'NOT_FOUND', message: `File not found: ${filePath}` } };
    }
    unlinkSync(fullPath);
    logger.debug({ path: filePath }, 'File deleted');
    return { success: true };
  }

  private list(dir?: string, pattern?: string): SkillResult {
    const fullDir = this.safePath(dir || '/');
    if (!existsSync(fullDir)) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Directory not found: ${dir}` } };
    }

    const files = this.listRecursive(fullDir);
    const relativePaths = files.map((f) => relative(this.basePath, f));

    if (pattern) {
      const regex = this.globToRegex(pattern);
      const filtered = relativePaths.filter((p) => regex.test(p));
      return { success: true, data: filtered };
    }

    return { success: true, data: relativePaths };
  }

  private exists(filePath: string): SkillResult {
    const fullPath = this.safePath(filePath);
    return { success: true, data: existsSync(fullPath) };
  }

  // --- Helpers ---

  /**
   * Resolves a relative path within basePath, preventing path traversal.
   */
  private safePath(relativePath: string): string {
    const resolved = resolve(this.basePath, relativePath);
    if (!resolved.startsWith(this.basePath)) {
      throw new SkillError(
        `Path traversal detected: ${relativePath} resolves outside sandbox`,
        this.id,
      );
    }
    return resolved;
  }

  private listRecursive(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          results.push(...this.listRecursive(fullPath));
        }
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }
}
