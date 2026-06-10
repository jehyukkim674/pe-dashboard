import type { FastifyInstance } from 'fastify';
import type { DataSourceRegistry } from '../datasources/registry.js';
import type { WidgetDataSource } from '../types.js';

export function widgetDataRoutes(app: FastifyInstance, dataSources: DataSourceRegistry): void {
  app.post('/api/widget-data', async (req, reply) => {
    const ds = req.body as WidgetDataSource;
    if (!ds || typeof ds.kind !== 'string') {
      return reply.code(400).send({ error: 'body must include kind' });
    }
    try {
      return await dataSources.get(ds.kind).fetch(ds);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
