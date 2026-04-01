import { existsSync, readdirSync, statSync } from 'node:fs';
import type { ISkill, SkillConfig, SkillResult, ActionDescriptor } from '../../core/interfaces/skill.interface.js';
import { createLogger } from '../../core/utils/logger.js';
import syncManifest from './skill.manifest.json' with { type: 'json' };

const logger = createLogger('ObsidianSyncSkill');

/**
 * ObsidianSyncSkill v2 — sync runs in a separate container (`obsidian-sync`)
 * via `ob sync --continuous`. This skill only checks vault status on the filesystem.
 * There is no HTTP API to call — the sync process watches the shared volume automatically.
 */
export class ObsidianSyncSkill implements ISkill {
  public readonly id = 'obsidian-sync';
  public readonly name = 'Obsidian Sync';
  public readonly version = '2.0.0';
  public readonly description = syncManifest.description;

  private vaultPath = '';
  private enabled = true;
  private lastCheckTime: number | null = null;

  async initialize(config: SkillConfig): Promise<void> {
    this.vaultPath = (config.vaultPath as string) || '';
    this.enabled = config.enabled !== false;
    logger.info({ vaultPath: this.vaultPath, enabled: this.enabled }, 'ObsidianSync skill initialized');
  }

  async execute(action: string, _params: Record<string, unknown>): Promise<SkillResult> {
    switch (action) {
      case 'sync': return this.sync();
      case 'getStatus': return this.getStatus();
      case 'getLastSyncTime': return this.getLastSyncTime();
      default:
        return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` } };
    }
  }

  getAvailableActions(): ActionDescriptor[] {
    return syncManifest.actions as ActionDescriptor[];
  }

  async shutdown(): Promise<void> {
    logger.info('ObsidianSync skill shut down');
  }

  // --- Actions ---

  private async sync(): Promise<SkillResult> {
    if (!this.enabled) {
      return { success: false, error: { code: 'SYNC_DISABLED', message: 'Sync is disabled' } };
    }

    // Sync runs continuously in the obsidian-sync container.
    // This action verifies the vault is accessible and the .obsidian dir exists
    // (indicates obsidian-headless has initialized the vault).
    const vaultExists = this.vaultPath && existsSync(this.vaultPath);
    const obsidianDir = this.vaultPath && existsSync(`${this.vaultPath}/.obsidian`);

    this.lastCheckTime = Date.now();

    if (!vaultExists) {
      return {
        success: false,
        error: { code: 'VAULT_NOT_FOUND', message: `Vault directory not found at ${this.vaultPath}` },
      };
    }

    const status = {
      status: 'synced',
      vaultPath: this.vaultPath,
      vaultExists: true,
      obsidianInitialized: !!obsidianDir,
      message: obsidianDir
        ? 'Vault is active — sync runs continuously in obsidian-sync container'
        : 'Vault exists but .obsidian directory not found — sync container may not have initialized yet',
      checkedAt: new Date().toISOString(),
    };

    logger.info(status, 'Vault sync check completed');
    return { success: true, data: status };
  }

  private async getStatus(): Promise<SkillResult> {
    if (!this.enabled) {
      return { success: true, data: { enabled: false, connected: false } };
    }

    const vaultExists = this.vaultPath && existsSync(this.vaultPath);
    let fileCount = 0;

    if (vaultExists) {
      try {
        const files = readdirSync(this.vaultPath);
        fileCount = files.filter(f => f.endsWith('.md')).length;
      } catch {
        // ignore read errors
      }
    }

    let lastModified: string | null = null;
    if (vaultExists) {
      try {
        const stat = statSync(this.vaultPath);
        lastModified = stat.mtime.toISOString();
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      data: {
        enabled: true,
        vaultExists: !!vaultExists,
        vaultPath: this.vaultPath,
        markdownFiles: fileCount,
        lastModified,
        syncMode: 'continuous (obsidian-headless container)',
      },
    };
  }

  private async getLastSyncTime(): Promise<SkillResult> {
    return { success: true, data: this.lastCheckTime };
  }
}
