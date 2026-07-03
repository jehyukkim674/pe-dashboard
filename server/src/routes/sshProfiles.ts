import type { FastifyInstance } from 'fastify';
import type { SshProfiles } from '../datasources/sshProfiles.js';

// SSH 접속 프로필 관리. 조회는 이름만 반환한다.
export function sshProfileRoutes(app: FastifyInstance, profiles: SshProfiles): void {
  app.get('/api/ssh-profiles', async () => profiles.names());

  app.post('/api/ssh-profiles', async (req, reply) => {
    const { name, host, user, port } = req.body as {
      name?: string; host?: string; user?: string; port?: number;
    };
    if (!name || !host) {
      return reply.code(400).send({ error: 'name과 host가 필요합니다' });
    }
    try {
      await profiles.add({ name, host, ...(user ? { user } : {}), ...(port ? { port } : {}) });
      return { added: name };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete('/api/ssh-profiles/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!(await profiles.remove(name))) {
      return reply.code(404).send({ error: 'profile not found' });
    }
    return { removed: name };
  });
}
