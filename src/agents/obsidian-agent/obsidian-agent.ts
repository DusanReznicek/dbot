import { randomUUID } from 'node:crypto';
import type { ISubAgent, AgentContext, HealthStatus } from '../../core/interfaces/agent.interface.js';
import type { AgentMessage, AgentResponse } from '../../core/interfaces/message.interface.js';
import type { FileSystemSkill } from '../../skills/file-system/file-system.skill.js';
import type { MarkdownParserSkill } from '../../skills/markdown-parser/markdown-parser.skill.js';
import type { ObsidianSyncSkill } from '../../skills/obsidian-sync/obsidian-sync.skill.js';
import { VaultManager } from './vault-manager.js';
import type { ObsidianAgentConfig } from './obsidian-agent.config.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('ObsidianAgent');

export class ObsidianAgent implements ISubAgent {
  public readonly id = 'obsidian-agent';
  public readonly name = 'Obsidian Agent';
  public readonly description = 'Manages Obsidian vault: read, write, edit, search, list notes, manage metadata, and sync';
  public readonly capabilities = [
    'obsidian.read',
    'obsidian.write',
    'obsidian.edit',
    'obsidian.search',
    'obsidian.list',
    'obsidian.metadata',
    'obsidian.sync',
    'obsidian.task',
    'obsidian.daily',
  ];
  public readonly requiredSkills = ['file-system', 'markdown-parser', 'obsidian-sync'];

  private vault!: VaultManager;
  private config!: ObsidianAgentConfig;
  private startedAt = 0;

  async initialize(context: AgentContext): Promise<void> {
    this.config = context.config as unknown as ObsidianAgentConfig;
    const fileSystem = context.skills.get('file-system') as FileSystemSkill;
    const markdownParser = context.skills.get('markdown-parser') as MarkdownParserSkill;
    const obsidianSync = context.skills.get('obsidian-sync') as ObsidianSyncSkill;

    this.vault = new VaultManager(fileSystem, markdownParser, obsidianSync, this.config);
    this.startedAt = Date.now();
    logger.info({ vaultPath: this.config.vaultPath }, 'Obsidian Agent initialized');
  }

  async handleMessage(message: AgentMessage): Promise<AgentResponse> {
    const { action, payload, conversationId } = message;
    const content = payload.content as string;

    logger.info({ action, conversationId }, 'Handling message');

    try {
      switch (action) {
        case 'obsidian.read': return this.handleRead(content, conversationId);
        case 'obsidian.write': return this.handleWrite(content, conversationId);
        case 'obsidian.edit': return this.handleEdit(content, conversationId);
        case 'obsidian.search': return this.handleSearch(content, conversationId);
        case 'obsidian.list': return this.handleList(content, conversationId);
        case 'obsidian.metadata': return this.handleMetadata(content, conversationId);
        case 'obsidian.sync': return this.handleSync(conversationId);
        case 'obsidian.task': return this.handleTask(content, conversationId);
        case 'obsidian.daily': return this.handleDailyNote(content, conversationId);
        default:
          return this.respond(conversationId, `Neznámá akce: ${action}`);
      }
    } catch (err) {
      logger.error({ err, action }, 'Error handling message');
      return this.respond(conversationId, `Chyba při zpracování: ${err instanceof Error ? err.message : 'unknown'}`, true);
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Obsidian Agent shut down');
  }

  getHealthStatus(): HealthStatus {
    return {
      healthy: true,
      uptime: Date.now() - this.startedAt,
      details: {
        vaultPath: this.config?.vaultPath,
        syncEnabled: this.config?.syncEnabled,
      },
    };
  }

  // --- Action handlers ---

  private async handleRead(content: string, conversationId: string): Promise<AgentResponse> {
    // Extract file path from user message
    const path = this.extractPath(content);
    if (!path) {
      return this.respond(conversationId, 'Prosím specifikuj cestu k poznámce, kterou chceš přečíst.');
    }

    const note = await this.vault.readNote(path);
    if (!note) {
      return this.respond(conversationId, `Poznámka "${path}" nebyla nalezena.`);
    }

    let text = `📄 **${path}**\n\n${note.body}`;
    if (note.tags.length > 0) {
      text += `\n\nTagy: ${note.tags.map((t) => `#${t}`).join(', ')}`;
    }
    return this.respond(conversationId, text);
  }

  private async handleWrite(content: string, conversationId: string): Promise<AgentResponse> {
    // Parse: "Vytvoř poznámku <title> s obsahem: <content>"
    const parsed = this.parseWriteCommand(content);
    if (!parsed) {
      return this.respond(conversationId, 'Prosím specifikuj název poznámky a obsah. Např: "Vytvoř poznámku Meeting notes s obsahem: ..."');
    }

    const path = this.buildNotePath(parsed.title);
    const success = await this.vault.writeNote(path, parsed.body, {
      created: new Date().toISOString(),
    });

    if (success) {
      return this.respond(conversationId, `Poznámka vytvořena: ${path}`);
    }
    return this.respond(conversationId, `Nepodařilo se vytvořit poznámku: ${path}`, true);
  }

  private async handleEdit(content: string, conversationId: string): Promise<AgentResponse> {
    const path = this.extractPath(content);
    if (!path) {
      return this.respond(conversationId, 'Prosím specifikuj cestu k poznámce, kterou chceš upravit.');
    }

    // For now, append content
    const newContent = this.extractAfterKeyword(content, ['obsah:', 'content:', 'text:']);
    if (!newContent) {
      return this.respond(conversationId, 'Prosím specifikuj nový obsah.');
    }

    const success = await this.vault.editNote(path, newContent);
    if (success) {
      return this.respond(conversationId, `Poznámka upravena: ${path}`);
    }
    return this.respond(conversationId, `Poznámka "${path}" nebyla nalezena.`);
  }

  private async handleSearch(content: string, conversationId: string): Promise<AgentResponse> {
    // Extract search query
    const query = this.extractSearchQuery(content);
    if (!query) {
      return this.respond(conversationId, 'Prosím specifikuj, co hledat.');
    }

    const results = await this.vault.searchNotes(query);
    if (results.length === 0) {
      return this.respond(conversationId, `Žádné poznámky neobsahují "${query}".`);
    }

    const lines = results.slice(0, 10).map((r, i) =>
      `${i + 1}. **${r.path}** (${r.matchCount}x)\n   ${r.snippet.slice(0, 150)}`,
    );
    return this.respond(conversationId, `Nalezeno ${results.length} poznámek pro "${query}":\n\n${lines.join('\n\n')}`);
  }

  private async handleList(content: string, conversationId: string): Promise<AgentResponse> {
    const dir = this.extractPath(content) || undefined;
    const notes = await this.vault.listNotes(dir);

    if (notes.length === 0) {
      return this.respond(conversationId, `Žádné poznámky${dir ? ` ve složce "${dir}"` : ''}.`);
    }

    const list = notes.slice(0, 30).map((n) => `• ${n}`).join('\n');
    return this.respond(
      conversationId,
      `${notes.length} poznámek${dir ? ` ve složce "${dir}"` : ''}:\n\n${list}${notes.length > 30 ? `\n\n... a ${notes.length - 30} dalších` : ''}`,
    );
  }

  private async handleMetadata(content: string, conversationId: string): Promise<AgentResponse> {
    const path = this.extractPath(content);
    if (!path) {
      return this.respond(conversationId, 'Prosím specifikuj cestu k poznámce.');
    }

    const metadata = await this.vault.getMetadata(path);
    if (!metadata) {
      return this.respond(conversationId, `Poznámka "${path}" nebyla nalezena.`);
    }

    const entries = Object.entries(metadata).map(([k, v]) => `• **${k}**: ${JSON.stringify(v)}`).join('\n');
    return this.respond(conversationId, `Metadata pro ${path}:\n\n${entries || '(žádná metadata)'}`);
  }

  private async handleTask(content: string, conversationId: string): Promise<AgentResponse> {
    const taskText = this.parseTaskContent(content);
    if (!taskText) {
      return this.respond(conversationId, 'Prosím specifikuj úkol. Např: "Přidej úkol: Zavolat doktorovi"');
    }

    const formatted = `- [ ] ${taskText}`;
    const taskFile = this.config.taskFile || 'tasks.md';
    const success = await this.vault.appendToNote(taskFile, formatted, {
      type: 'tasks',
      created: new Date().toISOString(),
    });

    if (success) {
      return this.respond(conversationId, `✅ Úkol přidán: ${taskText}`);
    }
    return this.respond(conversationId, `Nepodařilo se přidat úkol do ${taskFile}`, true);
  }

  private async handleDailyNote(content: string, conversationId: string): Promise<AgentResponse> {
    const noteText = this.parseDailyContent(content);
    if (!noteText) {
      return this.respond(conversationId, 'Prosím specifikuj co zapsat. Např: "Zapiš: Dokončil jsem projekt"');
    }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const formatted = `- **${time}** ${noteText}`;
    const dailyPath = this.vault.getDailyNotePath(now);

    const success = await this.vault.appendToNote(dailyPath, formatted, {
      type: 'daily',
      date: dateStr,
    });

    if (success) {
      return this.respond(conversationId, `✅ Zapsáno do denní poznámky (${dateStr}): ${noteText}`);
    }
    return this.respond(conversationId, `Nepodařilo se zapsat do denní poznámky`, true);
  }

  private async handleSync(conversationId: string): Promise<AgentResponse> {
    const result = await this.vault.syncVault();
    return this.respond(conversationId, result.message);
  }

  // --- Helpers ---

  private respond(conversationId: string, text: string, isError = false): AgentResponse {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      agentId: this.id,
      conversationId,
      text,
      error: isError ? { code: 'AGENT_ERROR', message: text } : undefined,
    };
  }

  private extractPath(text: string): string | null {
    // Try to find a path-like string (with / or .md extension)
    const pathMatch = text.match(/(?:[\w-]+\/)*[\w-]+\.md/);
    if (pathMatch) return pathMatch[0];

    // Try quoted path
    const quotedMatch = text.match(/"([^"]+)"/);
    if (quotedMatch) return quotedMatch[1];

    return null;
  }

  private parseWriteCommand(text: string): { title: string; body: string } | null {
    // Match patterns like: "poznámku <title> s obsahem: <body>"
    const patterns = [
      /poznámku\s+(.+?)\s+s\s+obsahem:\s*(.+)/si,
      /note\s+(.+?)\s+with\s+content:\s*(.+)/si,
      /create\s+(.+?):\s*(.+)/si,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return { title: match[1].trim().replace(/"/g, ''), body: match[2].trim() };
      }
    }

    return null;
  }

  private buildNotePath(title: string): string {
    const folder = this.config.defaultFolder === '/' ? '' : this.config.defaultFolder + '/';
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_');
    return `${folder}${safeName}.md`;
  }

  private extractSearchQuery(text: string): string | null {
    // Remove action keywords to get the query
    const cleaned = text
      .replace(/(?:najdi|hledej|vyhledej|find|search)\s+(?:poznámku?\s+(?:o\s+)?)?/i, '')
      .replace(/v\s+(?:obsidianu?|vaultu?)\s*/i, '')
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  private parseTaskContent(text: string): string | null {
    const patterns = [
      /(?:přidej\s+)?úkol:\s*(.+)/si,
      /(?:add\s+)?task:\s*(.+)/si,
      /todo:\s*(.+)/si,
      /ukol:\s*(.+)/si,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    // Fallback: strip known trigger words and return the rest
    const cleaned = text
      .replace(/(?:vytvoř|vytvor|přidej|pridej|zapiš|zapis|add|nový|novy|new|zapni|zadej|zapsat)\s+(?:mi\s+)?(?:úkol|ukol|task|todo)\s*/i, '')
      .trim();
    return cleaned.length > 2 ? cleaned : null;
  }

  private parseDailyContent(text: string): string | null {
    const patterns = [
      /(?:zapiš|zapsat|zapis)(?:\s+do\s+denní\s+poznámky)?:\s*(.+)/si,
      /denní\s+poznámk[ay]:\s*(.+)/si,
      /daily(?:\s+note)?:\s*(.+)/si,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    // Fallback: strip trigger phrases
    const cleaned = text
      .replace(/(?:zapiš|zapsat|zapis)\s+(?:do\s+)?(?:denní\s+poznámky?\s*)?/i, '')
      .replace(/(?:denní|denni)\s+(?:poznámk[ay])?\s*/i, '')
      .replace(/^daily\s+(?:note\s+)?/i, '')
      .trim();
    return cleaned.length > 2 ? cleaned : null;
  }

  private extractAfterKeyword(text: string, keywords: string[]): string | null {
    for (const kw of keywords) {
      const idx = text.toLowerCase().indexOf(kw.toLowerCase());
      if (idx !== -1) {
        return text.slice(idx + kw.length).trim();
      }
    }
    return null;
  }
}
