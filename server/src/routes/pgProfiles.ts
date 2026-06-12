import type { FastifyInstance } from 'fastify';
import type { PgProfiles } from '../datasources/pgProfiles.js';

// Postgres 연결 프로필 관리. 조회는 이름만 반환 — 연결 문자열(비밀)은 절대 내보내지 않는다.
export function pgProfileRoutes(app: FastifyInstance, profiles: PgProfiles): void {
  app.get('/api/pg-profiles', async () => profiles.names());

  app.post('/api/pg-profiles', async (req, reply) => {
    const { name, connString } = req.body as { name?: string; connString?: string };
    if (!name || !connString) {
      return reply.code(400).send({ error: 'name과 connString이 필요합니다' });
    }
    try {
      await profiles.add({ name, connString });
      return { added: name };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete('/api/pg-profiles/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!(await profiles.remove(name))) {
      return reply.code(404).send({ error: 'profile not found' });
    }
    return { removed: name };
  });
}
