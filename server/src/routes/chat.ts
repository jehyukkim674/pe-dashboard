import type { FastifyInstance } from 'fastify';
import type { ChatAdapter, ChatEvent } from '../ai/adapter.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatAdapter): void {
  app.post('/api/chat', async (req, reply) => {
    const { sessionId, message, dashboardId } = req.body as {
      sessionId?: string;
      message?: string;
      dashboardId?: string;
    };
    if (!sessionId || !message) {
      return reply.code(400).send({ error: 'sessionId and message are required' });
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const emit = (e: ChatEvent | { type: 'done' }) =>
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

    try {
      await chatService.chat(sessionId, message, emit, { dashboardId });
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message } as ChatEvent);
    } finally {
      emit({ type: 'done' });
      reply.raw.end();
    }
  });
}
