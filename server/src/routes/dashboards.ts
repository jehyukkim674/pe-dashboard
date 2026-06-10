import type { FastifyInstance } from 'fastify';
import type { DashboardStore } from '../dashboardStore.js';
import type { Dashboard } from '../types.js';

export function dashboardRoutes(app: FastifyInstance, store: DashboardStore): void {
  app.get('/api/dashboards', async () => store.list());

  app.post('/api/dashboards', async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string') return reply.code(400).send({ error: 'name is required' });
    return store.create(name);
  });

  app.get('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dashboard = await store.get(id);
    if (!dashboard) return reply.code(404).send({ error: 'not found' });
    return dashboard;
  });

  // 수동 편집(레이아웃 드래그 등)은 대시보드 전체를 저장
  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.get(id))) return reply.code(404).send({ error: 'not found' });
    const dashboard = req.body as Dashboard;
    await store.save({ ...dashboard, id });
    return { ok: true };
  });

  app.delete('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.delete(id))) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
