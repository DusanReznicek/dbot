import type { FastifyInstance } from 'fastify';
import type { PermissionManager } from '../../core/permissions/permission.manager.js';

export function registerPermissionRoutes(
  app: FastifyInstance,
  permissionManager: PermissionManager,
): void {
  // GET /api/v1/permissions — list all rules
  app.get('/api/v1/permissions', async (_request, _reply) => {
    return {
      enabled: permissionManager.isEnabled(),
      rules: permissionManager.getRules(),
    };
  });

  // POST /api/v1/permissions — add a new rule
  app.post('/api/v1/permissions', async (request, reply) => {
    const body = request.body as {
      source: string;
      target: string;
      actions?: string[];
      requireConfirmation?: boolean;
    };

    if (!body.source || !body.target) {
      return reply.status(400).send({ error: 'source and target are required' });
    }

    const rule = permissionManager.addRule({
      source: body.source,
      target: body.target,
      actions: body.actions ?? [],
      requireConfirmation: body.requireConfirmation ?? false,
    });

    return reply.status(201).send(rule);
  });

  // DELETE /api/v1/permissions/:id — remove a rule
  app.delete('/api/v1/permissions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = permissionManager.removeRule(id);

    if (!removed) {
      return reply.status(404).send({ error: `Rule "${id}" not found` });
    }

    return { success: true };
  });

  // PUT /api/v1/permissions/toggle — enable/disable globally
  app.put('/api/v1/permissions/toggle', async (request, _reply) => {
    const body = request.body as { enabled: boolean };
    permissionManager.setEnabled(body.enabled);
    return { enabled: permissionManager.isEnabled() };
  });

  // POST /api/v1/permissions/check — check a specific permission
  app.post('/api/v1/permissions/check', async (request, _reply) => {
    const body = request.body as { source: string; target: string; action: string };
    const result = permissionManager.check(body.source, body.target, body.action);
    return result;
  });
}
