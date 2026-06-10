import net from 'node:net';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { DashboardStore } from './dashboardStore.js';
import { CommandRegistry } from './commands/registry.js';
import { PendingCommands } from './commands/pending.js';
import { DataSourceRegistry } from './datasources/registry.js';
import { CliSource } from './datasources/cliSource.js';
import { buildTools } from './ai/tools.js';
import { ChatService } from './ai/chatService.js';
import { ClaudeCliAdapter } from './ai/claudeCliAdapter.js';
import type { ChatAdapter } from './ai/adapter.js';

export interface StartOptions {
  dataDir: string;
  preferredPort?: number; // 기본 5174. 사용 중이면 빈 포트로 폴백. 0이면 임의 포트
  staticDir?: string;     // 지정 시 web/dist 정적 서빙 (Electron 프로덕션)
}

// CLI(index.ts)와 Electron 메인 프로세스가 공유하는 서버 부트스트랩.
export async function startServer(
  opts: StartOptions,
): Promise<{ app: FastifyInstance; port: number }> {
  const store = new DashboardStore(path.join(opts.dataDir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(opts.dataDir, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();

  const dataSources = new DataSourceRegistry();
  dataSources.register(new CliSource(commands));

  const tools = buildTools({ store, commands, pending });

  // 기본은 claude CLI. CHAT_ADAPTER=api + ANTHROPIC_API_KEY 설정 시 기존 API 모드.
  const chatService: ChatAdapter =
    process.env.CHAT_ADAPTER === 'api'
      ? new ChatService({ client: new Anthropic(), tools, store, commands })
      : new ClaudeCliAdapter({ store, commands, toolkit: tools });

  const app = await buildApp({ store, commands, pending, dataSources, chatService });

  if (opts.staticDir) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html'); // SPA 폴백
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  const port = await listenWithFallback(app, opts.preferredPort ?? 5174);
  return { app, port };
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

async function listenWithFallback(app: FastifyInstance, preferred: number): Promise<number> {
  const target = preferred !== 0 && (await isFree(preferred)) ? preferred : 0;
  await app.listen({ port: target, host: '127.0.0.1' });
  const address = app.server.address();
  return typeof address === 'object' && address ? address.port : preferred;
}
