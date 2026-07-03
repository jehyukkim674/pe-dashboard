import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DashboardStore } from './dashboardStore.js';
import type { CommandRegistry } from './commands/registry.js';
import type { PendingCommands } from './commands/pending.js';
import type { DataSourceRegistry } from './datasources/registry.js';
import type { ChatAdapter } from './ai/adapter.js';
import type { ToolKit } from './ai/tools.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { commandRoutes } from './routes/commands.js';
import { widgetDataRoutes } from './routes/widgetData.js';
import { chatRoutes } from './routes/chat.js';
import { exportImportRoutes } from './routes/exportImport.js';
import { pgProfileRoutes } from './routes/pgProfiles.js';
import { httpProfileRoutes } from './routes/httpProfiles.js';
import { sshProfileRoutes } from './routes/sshProfiles.js';
import type { PgProfiles } from './datasources/pgProfiles.js';
import type { HttpProfiles } from './datasources/httpProfiles.js';
import type { SshProfiles } from './datasources/sshProfiles.js';

export interface AppDeps {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
  dataSources: DataSourceRegistry;
  chatService: ChatAdapter;
  tools: ToolKit;
  pgProfiles: PgProfiles;
  httpProfiles: HttpProfiles;
  sshProfiles: SshProfiles;
}

// 로컬 전용 앱: 브라우저에서 온 요청은 localhost/127.0.0.1 출처만 허용한다.
// origin 헤더가 없으면(동일 출처 fetch·Electron·비브라우저) 통과. 이렇게 해야
// 사용자가 방문한 임의의 외부 웹페이지 JS가 127.0.0.1 API를 호출해 명령 실행·DB 조회·
// 저장된 인증 헤더 응답을 읽어가는 것(CORS 반사)을 막는다.
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // 동일 출처/비브라우저 요청
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  });
  dashboardRoutes(app, deps.store);
  commandRoutes(app, deps.commands, deps.pending, deps.tools);
  widgetDataRoutes(app, deps.dataSources);
  chatRoutes(app, deps.chatService);
  exportImportRoutes(app, deps.store, deps.commands);
  pgProfileRoutes(app, deps.pgProfiles);
  httpProfileRoutes(app, deps.httpProfiles);
  sshProfileRoutes(app, deps.sshProfiles);
  return app;
}
