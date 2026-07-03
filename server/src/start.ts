import net from 'node:net';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { DashboardStore } from './dashboardStore.js';
import { CommandRegistry } from './commands/registry.js';
import { ResultCache } from './commands/resultCache.js';
import { configureAuditLog } from './commands/auditLog.js';
import { writeDailyBackup } from './backup.js';
import { PendingCommands } from './commands/pending.js';
import { DataSourceRegistry } from './datasources/registry.js';
import { CliSource } from './datasources/cliSource.js';
import { HttpSource } from './datasources/httpSource.js';
import { HttpProfiles } from './datasources/httpProfiles.js';
import { PgProfiles } from './datasources/pgProfiles.js';
import { PostgresSource } from './datasources/postgresSource.js';
import { SshProfiles } from './datasources/sshProfiles.js';
import { SshSource } from './datasources/sshSource.js';
import { buildTools } from './ai/tools.js';
import { ChatService } from './ai/chatService.js';
import { ClaudeCliAdapter } from './ai/claudeCliAdapter.js';
import { runClaudeStream } from './ai/claudeStream.js';
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
  configureAuditLog(path.join(opts.dataDir, 'logs', 'commands.jsonl'));

  const store = new DashboardStore(path.join(opts.dataDir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(opts.dataDir, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();

  // 하루 1개 자동 백업 (최근 7개 보관) — 실패해도 기동을 막지 않는다
  void writeDailyBackup(path.join(opts.dataDir, 'backups'), store, commands).catch(() => {});

  // 같은 명령을 쓰는 위젯들과 AI 화면 컨텍스트가 실행을 공유한다 (TTL 10초)
  const commandCache = new ResultCache();

  const pgProfiles = new PgProfiles(path.join(opts.dataDir, 'pg-profiles.json'));
  await pgProfiles.load();
  const httpProfiles = new HttpProfiles(path.join(opts.dataDir, 'http-profiles.json'));
  await httpProfiles.load();
  const sshProfiles = new SshProfiles(path.join(opts.dataDir, 'ssh-profiles.json'));
  await sshProfiles.load();

  const dataSources = new DataSourceRegistry();
  dataSources.register(new CliSource(commands, commandCache));
  dataSources.register(new HttpSource(httpProfiles));
  dataSources.register(new PostgresSource(pgProfiles));
  dataSources.register(new SshSource(commands, sshProfiles, commandCache));

  // AI_READONLY=true면 조회 전용 모드: AI는 데이터 조회·질문 응답만 가능하고
  // 대시보드 생성·수정·삭제·명령 등록이 차단된다. 기본은 편집 허용.
  const aiReadOnly = process.env.AI_READONLY === 'true';
  const tools = buildTools({ store, commands, pending }, { readOnly: aiReadOnly });

  // 기본은 claude CLI. CHAT_ADAPTER=api + ANTHROPIC_API_KEY 설정 시 기존 API 모드.
  const chatService: ChatAdapter =
    process.env.CHAT_ADAPTER === 'api'
      ? new ChatService({ client: new Anthropic(), tools, store, commands })
      : new ClaudeCliAdapter({
          store, commands, pending, pgProfiles, dataSources, toolkit: tools,
          readOnly: aiReadOnly, cache: commandCache, execStream: runClaudeStream,
        });

  const app = await buildApp({ store, commands, pending, dataSources, chatService, tools, pgProfiles, httpProfiles, sshProfiles });

  if (opts.staticDir) {
    await fs.access(path.join(opts.staticDir, 'index.html')).catch(() => {
      throw new Error(`staticDir에 index.html이 없습니다: ${opts.staticDir} — 웹 빌드(npm run build -w web)를 먼저 실행하세요`);
    });
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
  try {
    await app.listen({ port: target, host: '127.0.0.1' });
  } catch (e) {
    // isFree 확인과 listen 사이(TOCTOU)에 포트를 뺏기면 EADDRINUSE로 죽는다 — 임의 포트로 폴백한다
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE' && target !== 0) {
      await app.listen({ port: 0, host: '127.0.0.1' });
    } else {
      throw e;
    }
  }
  const address = app.server.address();
  return typeof address === 'object' && address ? address.port : preferred;
}
