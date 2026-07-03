import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { PgProfiles } from '../src/datasources/pgProfiles.js';
import { HttpProfiles } from '../src/datasources/httpProfiles.js';
import { DataSourceRegistry } from '../src/datasources/registry.js';
import { buildTools } from '../src/ai/tools.js';
import { ClaudeCliAdapter } from '../src/ai/claudeCliAdapter.js';

describe('export/import routes', () => {
  let app: FastifyInstance;
  let store: DashboardStore;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'exp-'));
    store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    const pending = new PendingCommands();
    const toolkit = buildTools({ store, commands, pending });
    app = await buildApp({
      store, commands, pending,
      tools: toolkit,
      pgProfiles: new PgProfiles('/tmp/pe-test-pg-profiles.json'),
      httpProfiles: new HttpProfiles('/tmp/pe-test-http-profiles.json'),
      dataSources: new DataSourceRegistry(),
      chatService: new ClaudeCliAdapter({ store, commands, toolkit }),
    });
  });

  it('exports dashboards and custom commands only', async () => {
    await store.create('배포');
    const res = await app.inject({ method: 'GET', url: '/api/export' });
    const body = res.json() as { dashboards: unknown[]; commands: { builtin?: boolean }[] };
    expect(res.statusCode).toBe(200);
    expect(body.dashboards).toHaveLength(1);
    expect(body.commands.every((c) => !c.builtin)).toBe(true);
  });

  it('imports dashboards (upsert) and skips existing/dangerous commands', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: {
        version: 1,
        dashboards: [{ id: 'abc-123', name: '가져온 보드', widgets: [] }],
        commands: [
          { id: 'docker_ps', description: 'x', argv: ['docker', 'ps'], params: [] },
          { id: 'gh_pr_list', description: '중복', argv: ['x'], params: [] }, // builtin과 중복 → 스킵
          { id: 'rm_rf', description: 'x', argv: ['rm', '-rf', '{p}'], params: ['p'] }, // 위험 → 거부
        ],
      },
    });
    const body = res.json() as { dashboards: number; commands: number; skipped: string[] };
    expect(body.dashboards).toBe(1);
    expect(body.commands).toBe(1);
    expect(body.skipped.join()).toMatch(/rm_rf/);
    expect((await store.get('abc-123'))?.name).toBe('가져온 보드');

    // 같은 id 재가져오기 = 덮어쓰기
    await app.inject({
      method: 'POST', url: '/api/import',
      payload: { dashboards: [{ id: 'abc-123', name: '갱신됨', widgets: [] }] },
    });
    expect((await store.get('abc-123'))?.name).toBe('갱신됨');
  });

  it('rejects bodies without arrays', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: { foo: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('잘못된 항목이 섞여도 500 없이 정상 항목만 가져오고 나머지는 건너뛴다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/import',
      payload: {
        dashboards: [
          { id: 'good-1', name: '정상', widgets: [] },
          { id: 'bad/id', name: '잘못된 id', widgets: [] }, // store.save가 던지지만 전체를 죽이면 안 됨
          { id: 'good-2', name: '정상2', widgets: [] },
        ],
        commands: [null, { id: 'ok_cmd', description: 'd', argv: ['echo', 'x'], params: [] }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dashboards: number; commands: number; skipped: string[] };
    expect(body.dashboards).toBe(2); // good-1, good-2
    expect(body.commands).toBe(1);
    expect(await store.get('good-1')).toBeDefined();
    expect(await store.get('good-2')).toBeDefined();
    expect(body.skipped.join()).toMatch(/bad\/id|잘못된 명령/);
  });
});
