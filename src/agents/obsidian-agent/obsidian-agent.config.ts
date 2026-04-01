import { z } from 'zod';

export const obsidianAgentConfigSchema = z.object({
  vaultPath: z.string().min(1),
  syncEnabled: z.boolean().default(true),
  defaultFolder: z.string().default('/'),
  taskFile: z.string().default('tasks.md'),
  dailyNotesFolder: z.string().default('daily'),
  excludePatterns: z.array(z.string()).default(['.obsidian/**', '.trash/**']),
});

export type ObsidianAgentConfig = z.infer<typeof obsidianAgentConfigSchema>;
