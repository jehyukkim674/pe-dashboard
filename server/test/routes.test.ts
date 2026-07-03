import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type AppDeps } from '../src/app.js';
import { buildTools } from '../src/ai/tools.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { PgProfiles } from '../src/datasources/pgProfiles.js';
import { HttpProfiles } from '../src/datasources/httpProfiles.js';
import { DataSourceRegistry } from '../src/datasources/registry.js';
import { CliSource } from '../src/datasources/cliSource.js';

describe('routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let deps: AppDeps;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'app-'));
    const store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    const dataSources = new DataSourceRegistry();
    dataSources.register(new CliSource(commands));
    const pending = new PendingCommands();
    deps = {
      store, commands, dataSources, pending,
      tools: buildTools({ store, commands, pending }),
      pgProfiles: new PgProfiles('/tmp/pe-test-pg-profiles.json'),
      httpProfiles: new HttpProfiles('/tmp/pe-test-http-profiles.json'),
      chatService: { chat: async () => {}, clearSession: () => {} } as never, // chat 라우트는 수동 검증
    };
    app = await buildApp(deps);
  });

  it('dashboard CRUD via REST', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/dashboards', payload: { name: '배포' },
    });
    expect(created.statusCode).toBe(200);
    const dashboard = created.json();

    const list = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(list.json()).toHaveLength(1);

    dashboard.widgets = [{
      id: 'w1', type: 'text', title: '메모',
      layout: { x: 0, y: 0, w: 4, h: 3 }, display: { content: 'hi' },
    }];
    const saved = await app.inject({
      method: 'PUT', url: `/api/dashboards/${dashboard.id}`, payload: dashboard,
    });
    expect(saved.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/dashboards/${dashboard.id}` });
    expect(got.json().widgets).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/dashboards/${dashboard.id}` });
    expect(deleted.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/dashboards/${dashboard.id}` })).statusCode).toBe(404);
  });

  it('GET /api/commands returns templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commands' });
    expect(res.json().map((t: { id: string }) => t.id)).toContain('gh_run_list');
  });

  it('POST /api/widget-data runs a registered command', async () => {
    await deps.commands.register({
      id: 'echo_hi', description: 't',
      argv: ['node', '-e', 'console.log(JSON.stringify({hi:1}))'], params: [],
    });
    const res = await app.inject({
      method: 'POST', url: '/api/widget-data',
      payload: { kind: 'cli', commandId: 'echo_hi', params: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().json).toEqual({ hi: 1 });
  });

  it('POST /api/widget-data rejects unknown command with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/widget-data',
      payload: { kind: 'cli', commandId: 'nope', params: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/widget-data rejects malformed body with clear error', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/widget-data',
      payload: { commandId: 'echo_hi' }, // kind 누락
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/kind/);
  });

  it('잘못된 형식의 id는 500이 아닌 404를 준다', async () => {
    // store.filePath가 던지는 invalid-id 예외가 500으로 새지 않아야 한다 ('!'는 [\w-] 밖)
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({
        method, url: '/api/dashboards/bad!id',
        ...(method === 'PUT' ? { payload: { name: 'x', widgets: [] } } : {}),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('PUT /api/dashboards/:id rejects malformed body with 400 and does not corrupt store', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: '원본' } });
    const { id } = created.json();
    const bad = await app.inject({
      method: 'PUT', url: `/api/dashboards/${id}`,
      payload: { name: 123, widgets: 'nope' }, // 스키마 위반
    });
    expect(bad.statusCode).toBe(400);
    // 원본은 그대로 읽혀야 한다 (부분 손상 없음)
    const got = await app.inject({ method: 'GET', url: `/api/dashboards/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().name).toBe('원본');
  });

  it('confirm이 중복 id로 register 실패해도 409를 주고 대기 항목을 잃지 않는다', async () => {
    await deps.commands.register({ id: 'dup', description: 'd', argv: ['echo', 'x'], params: [] });
    const pid = deps.pending.add({ id: 'dup', description: 'd2', argv: ['echo', 'y'], params: [] });
    const res = await app.inject({ method: 'POST', url: `/api/commands/pending/${pid}/confirm` });
    expect(res.statusCode).toBe(409);
    // 대기 항목이 소비되지 않아 다시 조회 가능해야 한다
    expect(deps.pending.get(pid)).toBeDefined();
  });

  it('pending command confirm registers template; reject discards', async () => {
    const template = { id: 'c1', description: 'd', argv: ['echo', 'x'], params: [] };
    const p1 = deps.pending.add(template);
    const ok = await app.inject({ method: 'POST', url: `/api/commands/pending/${p1}/confirm` });
    expect(ok.statusCode).toBe(200);
    expect(deps.commands.get('c1')).toBeDefined();

    const p2 = deps.pending.add({ ...template, id: 'c2' });
    await app.inject({ method: 'POST', url: `/api/commands/pending/${p2}/reject` });
    expect(deps.commands.get('c2')).toBeUndefined();

    const gone = await app.inject({ method: 'POST', url: `/api/commands/pending/${p2}/confirm` });
    expect(gone.statusCode).toBe(404);
  });
});
