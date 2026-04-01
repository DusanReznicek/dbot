import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'js-yaml';
import { loadConfig } from './core/config/config.loader.js';
import { createLogger, setLogLevel } from './core/utils/logger.js';
import { InMemoryMessageBus } from './core/message-bus/in-memory.message-bus.js';
import { RedisMessageBus } from './core/message-bus/redis.message-bus.js';
import type { IMessageBus } from './core/message-bus/message-bus.interface.js';
import { SkillRegistry } from './core/registry/skill.registry.js';
import { LLMProviderFactory } from './core/llm/llm-provider.factory.js';
import { MasterAgent } from './master-agent/master-agent.js';
import { ChannelRouter } from './channels/channel-router.js';
import { RestApiChannel } from './channels/rest-api/rest-api.channel.js';
import { WhatsAppChannel } from './channels/whatsapp/whatsapp.channel.js';
import { TelegramChannel } from './channels/telegram/telegram.channel.js';
import { FileSystemSkill } from './skills/file-system/file-system.skill.js';
import { MarkdownParserSkill } from './skills/markdown-parser/markdown-parser.skill.js';
import { ObsidianSyncSkill } from './skills/obsidian-sync/obsidian-sync.skill.js';
import { ObsidianAgent, obsidianAgentConfigSchema } from './agents/obsidian-agent/index.js';
import fsManifest from './skills/file-system/skill.manifest.json' with { type: 'json' };
import mdManifest from './skills/markdown-parser/skill.manifest.json' with { type: 'json' };
import syncManifest from './skills/obsidian-sync/skill.manifest.json' with { type: 'json' };
import { PermissionManager } from './core/permissions/permission.manager.js';
import { createServer } from './api/server.js';

const logger = createLogger('Main');
const startedAt = Date.now();

async function main(): Promise<void> {
  // 1. Load and validate config
  const config = loadConfig();
  setLogLevel(config.logging.level);
  logger.info({ env: process.env.NODE_ENV || 'development' }, 'Configuration loaded');

  // 2. Initialize message bus
  let messageBus: IMessageBus & { setPermissionManager: (m: any) => void };

  if (config.messageBus.type === 'redis') {
    const redisBus = new RedisMessageBus({
      host: config.messageBus.redis.host,
      port: config.messageBus.redis.port,
    });
    await redisBus.connect();
    messageBus = redisBus;
    logger.info({ host: config.messageBus.redis.host, port: config.messageBus.redis.port }, 'Redis message bus connected');
  } else {
    messageBus = new InMemoryMessageBus();
    logger.info('In-memory message bus initialized');
  }

  // 3. Initialize registries
  const skillRegistry = new SkillRegistry();
  logger.info('Skill registry initialized');

  // 4. Initialize LLM providers
  const llmFactory = new LLMProviderFactory();
  llmFactory.initializeFromConfig(config.llm);
  logger.info({ providers: llmFactory.getAvailableProviders() }, 'LLM providers initialized');

  // 5. Initialize Master Agent
  const masterAgent = new MasterAgent(messageBus);
  await masterAgent.initialize();

  // Inject LLM provider for intent routing (if available)
  const defaultLLM = llmFactory.getDefaultProvider(config.llm);
  if (defaultLLM) {
    masterAgent.setLLMProvider(defaultLLM);
  } else {
    logger.warn('No LLM provider available — using hardcoded intent routing');
  }
  // 5b. Initialize Permission Manager
  const permissionManager = new PermissionManager();
  permissionManager.loadFromFile(resolve('config/permissions.yaml'));
  messageBus.setPermissionManager(permissionManager);
  masterAgent.setPermissionManager(permissionManager);
  logger.info({ enabled: permissionManager.isEnabled() }, 'Permission manager initialized');

  logger.info('Master Agent initialized');

  // 6. Bootstrap agents from config/agents.yaml
  const agentsConfigPath = resolve('config/agents.yaml');
  if (existsSync(agentsConfigPath)) {
    const agentsRaw = YAML.load(readFileSync(agentsConfigPath, 'utf-8')) as { agents?: Array<{ id: string; enabled: boolean; config: Record<string, unknown> }> };

    for (const agentDef of agentsRaw?.agents || []) {
      if (!agentDef.enabled) continue;

      if (agentDef.id === 'obsidian-agent') {
        // Env overrides for vault configuration
        const envOverrides: Record<string, unknown> = {};
        if (process.env.DBOT_VAULT_PATH) envOverrides.vaultPath = process.env.DBOT_VAULT_PATH;
        if (process.env.DBOT_VAULT_DEFAULT_FOLDER) envOverrides.defaultFolder = process.env.DBOT_VAULT_DEFAULT_FOLDER;
        if (process.env.DBOT_VAULT_SYNC_ENABLED !== undefined) envOverrides.syncEnabled = process.env.DBOT_VAULT_SYNC_ENABLED === 'true';

        const agentConfig = obsidianAgentConfigSchema.parse({ ...agentDef.config, ...envOverrides });

        // Initialize skills
        const fileSystemSkill = new FileSystemSkill();
        await fileSystemSkill.initialize({ basePath: agentConfig.vaultPath });
        skillRegistry.register(fileSystemSkill, fsManifest as any);

        const markdownParserSkill = new MarkdownParserSkill();
        await markdownParserSkill.initialize({});
        skillRegistry.register(markdownParserSkill, mdManifest as any);

        const obsidianSyncSkill = new ObsidianSyncSkill();
        await obsidianSyncSkill.initialize({
          vaultPath: agentConfig.vaultPath,
          enabled: agentConfig.syncEnabled,
        });
        skillRegistry.register(obsidianSyncSkill, syncManifest as any);

        // Initialize agent
        const obsidianAgent = new ObsidianAgent();
        await obsidianAgent.initialize({
          config: agentConfig as unknown as Record<string, unknown>,
          skills: new Map<string, unknown>([
            ['file-system', fileSystemSkill],
            ['markdown-parser', markdownParserSkill],
            ['obsidian-sync', obsidianSyncSkill],
          ]),
          llmProvider: defaultLLM || null,
        });

        masterAgent.registerSubAgent(obsidianAgent);
        logger.info({ agentId: obsidianAgent.id, vaultPath: agentConfig.vaultPath }, 'Obsidian Agent registered');
      }
    }
  }

  // 7. Initialize Channel Router
  const channelRouter = new ChannelRouter();
  channelRouter.setMessageHandler(async (message, _channelId) => {
    return masterAgent.handleUserMessage(message);
  });

  // 6. Register channels
  const restApiChannel = new RestApiChannel();
  restApiChannel.setMessageHandler(async (message, channelId) => {
    return channelRouter.handleIncoming(message, channelId);
  });
  channelRouter.registerChannel(restApiChannel);

  if (config.channels.whatsapp.enabled) {
    const whatsAppChannel = new WhatsAppChannel(config.channels.whatsapp);
    whatsAppChannel.setMessageHandler(async (message, channelId) => {
      return channelRouter.handleIncoming(message, channelId);
    });
    channelRouter.registerChannel(whatsAppChannel);
    logger.info('WhatsApp channel registered');
  }

  if (config.channels.telegram.enabled) {
    const telegramChannel = new TelegramChannel(config.channels.telegram);
    telegramChannel.setMessageHandler(async (message, channelId) => {
      return channelRouter.handleIncoming(message, channelId);
    });
    channelRouter.registerChannel(telegramChannel);
    logger.info('Telegram channel registered');
  }

  // 7. Start all channels (WhatsApp connects, REST API activates)
  await channelRouter.startAll();
  logger.info('All channels started');

  // 8. Start API server
  const server = await createServer({
    masterAgent,
    skillRegistry,
    restApiChannel,
    permissionManager,
    llmProviderFactory: llmFactory,
    config: config.server,
    startedAt,
  });

  // Graceful shutdown: channels → server → agents → message bus
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return; // Prevent double shutdown
    isShuttingDown = true;

    logger.info({ signal }, 'Graceful shutdown initiated...');

    try {
      // 1. Stop accepting new messages
      logger.info('Stopping channels...');
      await channelRouter.stopAll();

      // 2. Stop API server
      logger.info('Closing API server...');
      await server.close();

      // 3. Shutdown agents
      logger.info('Shutting down agents...');
      await masterAgent.shutdown();

      // 4. Shutdown message bus (Redis disconnect)
      logger.info('Shutting down message bus...');
      await messageBus.shutdown();

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info({ pid: process.pid, env: process.env.NODE_ENV || 'development' }, 'DBot is running');
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
