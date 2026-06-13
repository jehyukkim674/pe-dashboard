import type { FastifyInstance } from 'fastify';
import type { HttpProfiles } from '../datasources/httpProfiles.js';

// HTTP 인증 헤더 프로필 관리. 조회는 이름만 반환 — 헤더 값(토큰)은 절대 내보내지 않는다.
export function httpProfileRoutes(app: FastifyInstance, profiles: HttpProfiles): void {
  app.get('/api/http-profiles', async () => profiles.names());

  app.post('/api/http-profiles', async (req, reply) => {
    const { name, headers } = req.body as { name?: string; headers?: Record<string, string> };
    if (!name || !headers || typeof headers !== 'object') {
      return reply.code(400).send({ error: 'name과 headers가 필요합니다' });
    }
    try {
      await profiles.add({ name, headers });
      return { added: name };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete('/api/http-profiles/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!(await profiles.remove(name))) {
      return reply.code(404).send({ error: 'profile not found' });
    }
    return { removed: name };
  });
}
