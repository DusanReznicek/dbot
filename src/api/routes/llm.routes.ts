import type { FastifyInstance } from 'fastify';
import type { LLMProviderFactory } from '../../core/llm/llm-provider.factory.js';
import { OllamaProvider } from '../../core/llm/ollama.provider.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('LLMRoutes');

export function registerLLMRoutes(
  app: FastifyInstance,
  providerFactory: LLMProviderFactory,
): void {
  // GET /api/v1/llm/providers — list available providers
  app.get('/api/v1/llm/providers', async () => {
    return {
      providers: providerFactory.getAvailableProviders(),
    };
  });

  // GET /api/v1/llm/models — list models for Ollama provider
  app.get('/api/v1/llm/models', async (_req, reply) => {
    const ollama = providerFactory.getProvider('ollama');
    if (!ollama || !(ollama instanceof OllamaProvider)) {
      return reply.status(404).send({ error: 'Ollama provider not available' });
    }

    const models = await ollama.listModels();
    return {
      currentModel: ollama.getModel(),
      models,
    };
  });

  // PUT /api/v1/llm/models — switch active Ollama model
  app.put<{ Body: { model: string } }>('/api/v1/llm/models', async (req, reply) => {
    const ollama = providerFactory.getProvider('ollama');
    if (!ollama || !(ollama instanceof OllamaProvider)) {
      return reply.status(404).send({ error: 'Ollama provider not available' });
    }

    const { model } = req.body || {};
    if (!model || typeof model !== 'string') {
      return reply.status(400).send({ error: 'model is required (string)' });
    }

    const previous = ollama.getModel();
    ollama.setModel(model);
    logger.info({ model, previous }, 'Model switched via API');

    return { previous, current: model };
  });

  // GET /api/v1/llm/models/:model — get info for a specific model
  app.get<{ Params: { model: string } }>('/api/v1/llm/models/:model', async (req, reply) => {
    const ollama = providerFactory.getProvider('ollama');
    if (!ollama || !(ollama instanceof OllamaProvider)) {
      return reply.status(404).send({ error: 'Ollama provider not available' });
    }

    const info = await ollama.getModelInfo(req.params.model);
    if (!info) {
      return reply.status(404).send({ error: `Model "${req.params.model}" not found` });
    }
    return info;
  });

  // POST /api/v1/llm/models/pull — pull (download) a model
  app.post<{ Body: { model: string } }>('/api/v1/llm/models/pull', async (req, reply) => {
    const ollama = providerFactory.getProvider('ollama');
    if (!ollama || !(ollama instanceof OllamaProvider)) {
      return reply.status(404).send({ error: 'Ollama provider not available' });
    }

    const { model } = req.body || {};
    if (!model || typeof model !== 'string') {
      return reply.status(400).send({ error: 'model is required (string)' });
    }

    logger.info({ model }, 'Pulling model via API');
    const result = await ollama.pullModel(model);

    if (!result.success) {
      return reply.status(500).send({ error: result.error });
    }
    return { success: true, model };
  });

  // GET /api/v1/llm/status — Ollama availability check
  app.get('/api/v1/llm/status', async () => {
    const ollama = providerFactory.getProvider('ollama');
    if (!ollama || !(ollama instanceof OllamaProvider)) {
      return { ollama: { available: false, reason: 'provider not configured' } };
    }

    const available = await ollama.isAvailable();
    return {
      ollama: {
        available,
        currentModel: ollama.getModel(),
      },
    };
  });
}
