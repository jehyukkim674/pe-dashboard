import type { FastifyInstance } from 'fastify';
import type { ChatService, ChatEvent } from '../ai/chatService.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatService): void {
  app.post('/api/chat', async (req, reply) => {
    const { sessionId, message } = req.body as { sessionId?: string; message?: string };
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
      await chatService.chat(sessionId, message, emit);
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message } as ChatEvent);
    } finally {
      emit({ type: 'done' });
      reply.raw.end();
    }
  });
}
