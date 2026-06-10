import type { FastifyInstance } from 'fastify';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';

export function commandRoutes(
  app: FastifyInstance,
  commands: CommandRegistry,
  pending: PendingCommands,
): void {
  app.get('/api/commands', async () => commands.list());

  app.post('/api/commands/pending/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = pending.take(id);
    if (!template) return reply.code(404).send({ error: 'pending command not found' });
    await commands.register(template);
    return { registered: template.id };
  });

  app.post('/api/commands/pending/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!pending.take(id)) return reply.code(404).send({ error: 'pending command not found' });
    return { rejected: true };
  });
}
