import type { FastifyInstance } from 'fastify';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';
import { readAuditLog } from '../commands/auditLog.js';

export function commandRoutes(
  app: FastifyInstance,
  commands: CommandRegistry,
  pending: PendingCommands,
): void {
  app.get('/api/commands', async () => commands.list());

  // 최근 실행된 명령 감사 로그 (최신이 마지막)
  app.get('/api/command-log', async (req) => {
    const { limit } = req.query as { limit?: string };
    return readAuditLog(Math.min(Number(limit) || 100, 1000));
  });

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
