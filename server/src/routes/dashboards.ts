import type { FastifyInstance } from 'fastify';
import { validateDashboardInput, type DashboardStore } from '../dashboardStore.js';

// 저장소가 허용하는 id 형식. 형식이 어긋난 id는 존재하지 않는 것으로 취급해 404를 준다
// (store.get이 던지는 'invalid id' 예외가 500으로 새어 나가는 것을 막는다).
const VALID_ID = /^[\w-]+$/;

export function dashboardRoutes(app: FastifyInstance, store: DashboardStore): void {
  app.get('/api/dashboards', async () => store.list());

  app.post('/api/dashboards', async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string') return reply.code(400).send({ error: 'name is required' });
    return store.create(name);
  });

  app.get('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!VALID_ID.test(id)) return reply.code(404).send({ error: 'not found' });
    const dashboard = await store.get(id);
    if (!dashboard) return reply.code(404).send({ error: 'not found' });
    return dashboard;
  });

  // 수동 편집(레이아웃 드래그 등)은 대시보드 전체를 저장
  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!VALID_ID.test(id)) return reply.code(404).send({ error: 'not found' });
    if (!(await store.get(id))) return reply.code(404).send({ error: 'not found' });
    try {
      const validated = validateDashboardInput(req.body);
      await store.save({ ...validated, id });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    return { ok: true };
  });

  app.delete('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!VALID_ID.test(id)) return reply.code(404).send({ error: 'not found' });
    if (!(await store.delete(id))) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
