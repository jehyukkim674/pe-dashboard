import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';

describe('DashboardStore', () => {
  let store: DashboardStore;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dash-'));
    store = new DashboardStore(dir);
    await store.init();
  });

  it('creates and lists dashboards', async () => {
    const d = await store.create('배포 현황');
    expect(d.id).toBeTruthy();
    expect(d.widgets).toEqual([]);
    const all = await store.list();
    expect(all.map((x) => x.name)).toEqual(['배포 현황']);
  });

  it('returns undefined for missing dashboard', async () => {
    expect(await store.get('no-such-id')).toBeUndefined();
  });

  it('rejects path-traversal ids', async () => {
    await expect(store.get('../etc/passwd')).rejects.toThrow(/invalid/);
  });

  it('deletes a dashboard', async () => {
    const d = await store.create('temp');
    expect(await store.delete(d.id)).toBe(true);
    expect(await store.delete(d.id)).toBe(false);
  });

  it('save persists changes and survives reload', async () => {
    const d = await store.create('old');
    await store.save({ ...d, name: 'new' });
    expect((await store.get(d.id))!.name).toBe('new');
  });

  it('adds, updates and removes widgets', async () => {
    const d = await store.create('w');
    const widget = await store.addWidget(d.id, {
      type: 'stat',
      title: '실패 수',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
    });
    expect(widget.id).toBeTruthy();

    const updated = await store.updateWidget(d.id, widget.id, { title: '빌드 실패' });
    expect(updated.title).toBe('빌드 실패');
    expect(updated.type).toBe('stat'); // 패치 외 필드 보존

    await store.removeWidget(d.id, widget.id);
    expect((await store.get(d.id))!.widgets).toEqual([]);
  });

  it('throws when widget target is missing', async () => {
    const d = await store.create('x');
    await expect(store.updateWidget(d.id, 'nope', {})).rejects.toThrow(/widget not found/);
    await expect(
      store.addWidget('no-dash', {
        type: 'text',
        title: 't',
        layout: { x: 0, y: 0, w: 1, h: 1 },
      }),
    ).rejects.toThrow(/dashboard not found/);
  });
});
