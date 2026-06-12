import type { FastifyInstance } from 'fastify';
import type { ChatAdapter, ChatEvent } from '../ai/adapter.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatAdapter): void {
  app.post('/api/chat', async (req, reply) => {
    const { sessionId, message, dashboardId, model } = req.body as {
      sessionId?: string;
      message?: string;
      dashboardId?: string;
      model?: string;
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

    // 클라이언트가 스트림을 끊으면(새 메시지 전송·드로어 닫기) 진행 중인 AI 실행을 중단
    const abort = new AbortController();
    reply.raw.on('close', () => abort.abort());

    try {
      await chatService.chat(sessionId, message, emit, { dashboardId, model, signal: abort.signal });
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message } as ChatEvent);
    } finally {
      emit({ type: 'done' });
      reply.raw.end();
    }
  });
}
