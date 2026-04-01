import type { ILLMProvider } from '../interfaces/llm.interface.js';
import type { LLMConfig } from '../config/config.schema.js';
import { OpenAIProvider } from './openai.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OllamaProvider } from './ollama.provider.js';
import { MistralProvider } from './mistral.provider.js';
import { createLogger } from '../utils/logger.js';
import { DBotError } from '../utils/errors.js';

const logger = createLogger('LLMProviderFactory');

export class LLMProviderFactory {
  private providers = new Map<string, ILLMProvider>();

  /**
   * Creates and caches LLM providers based on config.
   * Cloud providers need API keys; Ollama is always initialized (local).
   */
  initializeFromConfig(config: LLMConfig): void {
    // Try OpenAI
    const openaiKey = config.providers.openai.apiKey || process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const provider = new OpenAIProvider({
          model: config.providers.openai.model,
          apiKey: openaiKey,
        });
        this.providers.set('openai', provider);
      } catch (err) {
        logger.warn({ err }, 'Failed to initialize OpenAI provider');
      }
    } else {
      logger.debug('OpenAI API key not found — skipping');
    }

    // Try Anthropic
    const anthropicKey = config.providers.anthropic.apiKey || process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      try {
        const provider = new AnthropicProvider({
          model: config.providers.anthropic.model,
          apiKey: anthropicKey,
        });
        this.providers.set('anthropic', provider);
      } catch (err) {
        logger.warn({ err }, 'Failed to initialize Anthropic provider');
      }
    } else {
      logger.debug('Anthropic API key not found — skipping');
    }

    // Try Mistral
    const mistralKey = config.providers.mistral.apiKey || process.env.MISTRAL_API_KEY;
    if (mistralKey) {
      try {
        const provider = new MistralProvider({
          model: config.providers.mistral.model,
          apiKey: mistralKey,
        });
        this.providers.set('mistral', provider);
      } catch (err) {
        logger.warn({ err }, 'Failed to initialize Mistral provider');
      }
    } else {
      logger.debug('Mistral API key not found — skipping');
    }

    // Ollama — local provider, no API key needed
    try {
      const ollamaConfig = config.providers.ollama;
      const provider = new OllamaProvider({
        model: ollamaConfig.model,
        baseUrl: ollamaConfig.baseUrl,
        keepAlive: ollamaConfig.keepAlive,
        timeout: ollamaConfig.timeout,
      });
      this.providers.set('ollama', provider);
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Ollama provider');
    }

    logger.info(
      { providers: Array.from(this.providers.keys()) },
      'LLM providers initialized',
    );
  }

  getProvider(id: string): ILLMProvider | undefined {
    return this.providers.get(id);
  }

  getDefaultProvider(config: LLMConfig): ILLMProvider | undefined {
    return this.providers.get(config.defaultProvider);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  requireProvider(id: string): ILLMProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new DBotError(`LLM provider "${id}" not available. Available: ${this.getAvailableProviders().join(', ')}`);
    }
    return provider;
  }
}
