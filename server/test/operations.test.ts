import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools, type ToolKit } from '../src/ai/tools.js';
import { applyOperations, type Operation } from '../src/ai/operations.js';
import type { ChatEvent } from '../src/ai/adapter.js';

describe('applyOperations', () => {
  let toolkit: ToolKit;
  let store: DashboardStore;
  let pending: PendingCommands;
  let events: ChatEvent[];
  const emit = (e: ChatEvent) => events.push(e);

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ops-'));
    store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    pending = new PendingCommands();
    toolkit = buildTools({ store, commands, pending });
    events = [];
  });

  it('applies create_dashboard then add_widget with $last alias', async () => {
    const ops: Operation[] = [
      { op: 'create_dashboard', name: '배포' },
      {
        op: 'add_widget',
        dashboardId: '$last',
        widget: {
          type: 'stat', title: '실패 수', layout: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
        },
      },
    ];
    await applyOperations(ops, toolkit, emit);

    const dashboards = await store.list();
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].widgets).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
  });

  it('continues after a failing operation', async () => {
    const ops: Operation[] = [
      { op: 'delete_dashboard', id: 'no-such' },
      { op: 'create_dashboard', name: '생존' },
    ];
    await applyOperations(ops, toolkit, emit);

    expect((await store.list()).map((d) => d.name)).toEqual(['생존']);
    expect(events.some((e) => e.type === 'error' && e.message.includes('delete_dashboard'))).toBe(true);
    expect(events.some((e) => e.type === 'tool')).toBe(true);
  });

  it('register_command queues pending and emits confirm_request', async () => {
    const ops: Operation[] = [
      { op: 'register_command', id: 'k_ctx', description: 'ctx', argv: ['kubectl', 'config', 'current-context'], params: [] },
    ];
    await applyOperations(ops, toolkit, emit);

    const confirm = events.find((e) => e.type === 'confirm_request');
    expect(confirm).toBeDefined();
    expect(pending.peek((confirm as { pendingId: string }).pendingId)?.id).toBe('k_ctx');
  });

  it('emits error for unknown op without crashing', async () => {
    await applyOperations([{ op: 'format_disk' } as never], toolkit, emit);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('set_alert sets and clears a widget alert', async () => {
    const d = await store.create('알림');
    const w = await store.addWidget(d.id, {
      type: 'log', title: '로그', layout: { x: 0, y: 0, w: 6, h: 5 },
      dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
    });
    // 자연어 요청이 매핑되는 형태: 실패 시 알림
    await applyOperations([{ op: 'set_alert', dashboardId: d.id, widgetId: w.id, alert: { on: 'fail' } }], toolkit, emit);
    expect((await store.get(d.id))!.widgets[0].alert).toEqual({ on: 'fail' });

    // null이면 해제
    await applyOperations([{ op: 'set_alert', dashboardId: d.id, widgetId: w.id, alert: null }], toolkit, emit);
    expect((await store.get(d.id))!.widgets[0].alert).toBeUndefined();
  });
});
