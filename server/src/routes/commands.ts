import type { FastifyInstance } from 'fastify';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';
import type { ToolKit } from '../ai/tools.js';
import { applyOperations, type Operation } from '../ai/operations.js';
import { readAuditLog } from '../commands/auditLog.js';

export function commandRoutes(
  app: FastifyInstance,
  commands: CommandRegistry,
  pending: PendingCommands,
  tools: ToolKit,
): void {
  app.get('/api/commands', async () => commands.list());

  // 최근 실행된 명령 감사 로그 (최신이 마지막)
  app.get('/api/command-log', async (req) => {
    const { limit } = req.query as { limit?: string };
    return readAuditLog(Math.min(Number(limit) || 100, 1000));
  });

  app.post('/api/commands/pending/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = pending.take(id);
    if (!entry) return reply.code(404).send({ error: 'pending command not found' });
    await commands.register(entry.template);

    // 이 명령을 전제로 보류해 둔 위젯 작업을 이어서 적용한다
    let applied = 0;
    const errors: string[] = [];
    if (entry.deferred.length > 0) {
      await applyOperations(entry.deferred as Operation[], tools, (e) => {
        if (e.type === 'tool') applied++;
        if (e.type === 'error') errors.push(e.message);
      });
    }
    return { registered: entry.template.id, applied, errors };
  });

  app.post('/api/commands/pending/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!pending.take(id)) return reply.code(404).send({ error: 'pending command not found' });
    return { rejected: true };
  });
}
