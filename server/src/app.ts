import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DashboardStore } from './dashboardStore.js';
import type { CommandRegistry } from './commands/registry.js';
import type { PendingCommands } from './commands/pending.js';
import type { DataSourceRegistry } from './datasources/registry.js';
import type { ChatService } from './ai/chatService.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { commandRoutes } from './routes/commands.js';
import { widgetDataRoutes } from './routes/widgetData.js';
import { chatRoutes } from './routes/chat.js';

export interface AppDeps {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
  dataSources: DataSourceRegistry;
  chatService: ChatService;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors, { origin: true }); // 로컬 전용
  dashboardRoutes(app, deps.store);
  commandRoutes(app, deps.commands, deps.pending);
  widgetDataRoutes(app, deps.dataSources);
  chatRoutes(app, deps.chatService);
  return app;
}
