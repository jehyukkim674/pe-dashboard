import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools, type ToolKit } from '../src/ai/tools.js';

describe('AI tools', () => {
  let tools: ToolKit;
  let store: DashboardStore;
  let pending: PendingCommands;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tools-'));
    store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    pending = new PendingCommands();
    tools = buildTools({ store, commands, pending });
  });

  it('exposes definitions matching handlers', () => {
    const names = tools.definitions.map((d) => d.name).sort();
    expect(names).toEqual(Object.keys(tools.handlers).sort());
    expect(names).toContain('create_dashboard');
    expect(names).toContain('run_command_preview');
  });

  it('create_dashboard then add_widget round-trips through the store', async () => {
    const created = (await tools.handlers.create_dashboard({ name: '배포' })) as { id: string };
    const widget = await tools.handlers.add_widget({
      dashboardId: created.id,
      widget: {
        type: 'stat',
        title: '실패 수',
        layout: { x: 0, y: 0, w: 3, h: 2 },
        dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
      },
    });
    expect((widget as { id: string }).id).toBeTruthy();
    expect((await store.get(created.id))!.widgets).toHaveLength(1);
  });

  it('add_widget rejects unknown commandId', async () => {
    const created = (await tools.handlers.create_dashboard({ name: 'x' })) as { id: string };
    await expect(
      tools.handlers.add_widget({
        dashboardId: created.id,
        widget: {
          type: 'stat',
          title: 't',
          layout: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: { kind: 'cli', commandId: 'nope', params: {} },
        },
      }),
    ).rejects.toThrow(/unknown command/);
  });

  it('run_command_preview truncates long output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tools2-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    await commands.register({
      id: 'long_out',
      description: 'test',
      argv: ['node', '-e', 'console.log("x".repeat(10000))'],
      params: [],
    });
    const kit = buildTools({ store, commands, pending });
    const preview = (await kit.handlers.run_command_preview({
      commandId: 'long_out',
      params: {},
    })) as { stdout: string };
    expect(preview.stdout.length).toBeLessThanOrEqual(2000);
  });

  it('run_command_preview masks secrets in stdout before returning to AI', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tools-mask-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    await commands.register({
      id: 'leak', description: 'test',
      argv: ['node', '-e', 'console.log("token=abcdef123456")'], params: [],
    });
    const kit = buildTools({ store, commands, pending });
    const preview = (await kit.handlers.run_command_preview({
      commandId: 'leak', params: {},
    })) as { stdout: string };
    expect(preview.stdout).not.toContain('abcdef123456');
    expect(preview.stdout).toContain('***');
  });

  it('register_command queues pending confirmation instead of registering', async () => {
    const result = (await tools.handlers.register_command({
      id: 'kubectl_ctx',
      description: '컨텍스트',
      argv: ['kubectl', 'config', 'current-context'],
      params: [],
    })) as { pendingId: string; status: string };
    expect(result.status).toBe('pending_confirmation');
    expect(pending.peek(result.pendingId)?.id).toBe('kubectl_ctx');
  });

  it('create_dashboard rejects missing name', async () => {
    await expect(tools.handlers.create_dashboard({})).rejects.toThrow(/name is required/);
  });

  it('update_widget validates patched dataSource', async () => {
    const created = (await tools.handlers.create_dashboard({ name: 'u' })) as { id: string };
    const widget = (await tools.handlers.add_widget({
      dashboardId: created.id,
      widget: {
        type: 'stat', title: 't', layout: { x: 0, y: 0, w: 3, h: 2 },
        dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
      },
    })) as { id: string };
    await expect(
      tools.handlers.update_widget({
        dashboardId: created.id,
        widgetId: widget.id,
        patch: { dataSource: { kind: 'cli', commandId: 'nope', params: {} } },
      }),
    ).rejects.toThrow(/unknown command/);
  });

  it('register_command rejects malformed template immediately', async () => {
    await expect(
      tools.handlers.register_command({ id: 'bad id!', description: 'x', argv: ['echo'], params: [] }),
    ).rejects.toThrow(/invalid template id/);
  });

  it('register_command rejects destructive binaries outright', async () => {
    await expect(
      tools.handlers.register_command({ id: 'rm_rf', description: 'x', argv: ['rm', '-rf', '{p}'], params: ['p'] }),
    ).rejects.toThrow(/차단/);
  });

  it('register_command attaches a warning for mutating commands', async () => {
    const out = (await tools.handlers.register_command({
      id: 'k_delete', description: 'x', argv: ['kubectl', 'delete', 'pod', '{n}'], params: ['n'],
    })) as { pendingId: string; warning?: string };
    expect(out.pendingId).toBeDefined();
    expect(out.warning).toMatch(/변경|삭제/);
  });

  it('register_command has no warning for read-only commands', async () => {
    const out = (await tools.handlers.register_command({
      id: 'docker_ps', description: 'x', argv: ['docker', 'ps', '--format', 'json'], params: [],
    })) as { warning?: string };
    expect(out.warning).toBeUndefined();
  });

  describe('조회 전용 모드 (readOnly)', () => {
    let readOnlyTools: ToolKit;

    beforeEach(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'tools-ro-'));
      const roStore = new DashboardStore(path.join(dir, 'dashboards'));
      await roStore.init();
      const commands = new CommandRegistry(path.join(dir, 'commands.json'));
      await commands.load();
      readOnlyTools = buildTools({ store: roStore, commands, pending: new PendingCommands() }, { readOnly: true });
    });

    it('blocks mutating handlers', async () => {
      await expect(readOnlyTools.handlers.create_dashboard({ name: 'x' })).rejects.toThrow(/조회 전용/);
      await expect(readOnlyTools.handlers.delete_dashboard({ id: 'x' })).rejects.toThrow(/조회 전용/);
      await expect(
        readOnlyTools.handlers.register_command({ id: 'a', description: 'x', argv: ['ls'], params: [] }),
      ).rejects.toThrow(/조회 전용/);
    });

    it('keeps read handlers and hides mutating definitions', async () => {
      expect(await readOnlyTools.handlers.list_dashboards({})).toEqual([]);
      expect(await readOnlyTools.handlers.list_commands({})).not.toHaveLength(0);
      const names = readOnlyTools.definitions.map((d) => d.name);
      expect(names).not.toContain('create_dashboard');
      expect(names).toContain('list_dashboards');
    });
  });
});
