import type { FastifyInstance } from 'fastify';
import type { SkillRegistry } from '../../core/registry/skill.registry.js';

export function registerSkillRoutes(app: FastifyInstance, skillRegistry: SkillRegistry): void {
  app.get('/api/v1/skills', async () => {
    const skills = skillRegistry.getAll().map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      actions: manifest.actions.map((a) => a.name),
    }));
    return { skills };
  });
}
