import type { FastifyInstance } from 'fastify';
import type { ChatAdapter, ChatEvent } from '../ai/adapter.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatAdapter): void {
  // 대화 초기화: 서버가 들고 있는 세션 히스토리(AI 기억)를 삭제한다
  app.delete('/api/chat/session/:sessionId', async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    chatService.clearSession(sessionId);
    return { ok: true };
  });

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
    // 클라이언트가 소켓을 닫은 뒤 쓰면 "write after end"류 오류가 난다 — 종료된 스트림엔 쓰지 않는다.
    const emit = (e: ChatEvent | { type: 'done' }) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    // 클라이언트가 스트림을 끊으면(새 메시지 전송·드로어 닫기) 진행 중인 AI 실행을 중단
    const abort = new AbortController();
    reply.raw.on('close', () => abort.abort());

    try {
      await chatService.chat(sessionId, message, emit, { dashboardId, model, signal: abort.signal });
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message } as ChatEvent);
    } finally {
      emit({ type: 'done' });
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
}
