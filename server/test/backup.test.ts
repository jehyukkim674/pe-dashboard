import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeDailyBackup, localDateStamp } from '../src/backup.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'bk-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  return { dir, store, commands, backupDir: path.join(dir, 'backups') };
}

describe('localDateStamp', () => {
  it('로컬 시간대 기준 YYYY-MM-DD를 만든다(UTC 아님)', () => {
    // 로컬 자정 직후 시각 — UTC로 변환하면 날짜가 달라질 수 있는 시점
    const d = new Date(2026, 0, 15, 0, 30, 0); // 2026-01-15 00:30 로컬
    expect(localDateStamp(d)).toBe('2026-01-15');
  });
  it('한 자리 월/일을 0-패딩한다', () => {
    expect(localDateStamp(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05');
  });
});

describe('writeDailyBackup', () => {
  it('오늘 파일명이 로컬 날짜를 쓴다', async () => {
    const { store, commands, backupDir } = await setup();
    await writeDailyBackup(backupDir, store, commands);
    const files = await readdir(backupDir);
    expect(files[0]).toBe(`backup-${localDateStamp()}.json`);
  });

  it('writes one backup per day with export-bundle shape', async () => {
    const { store, commands, backupDir } = await setup();
    await store.create('백업검증');
    await writeDailyBackup(backupDir, store, commands);
    await writeDailyBackup(backupDir, store, commands); // 같은 날 중복 호출 → 1개 유지

    const files = await readdir(backupDir);
    expect(files).toHaveLength(1);
    const bundle = JSON.parse(await readFile(path.join(backupDir, files[0]), 'utf8'));
    expect(bundle.dashboards[0].name).toBe('백업검증');
    expect(bundle.version).toBe(1);
  });

  it('prunes old backups beyond 7', async () => {
    const { store, commands, backupDir } = await setup();
    await mkdir(backupDir, { recursive: true });
    for (let i = 1; i <= 9; i++) {
      await writeFile(path.join(backupDir, `backup-2026-05-0${i}.json`), '{}');
    }
    await writeDailyBackup(backupDir, store, commands);
    const files = (await readdir(backupDir)).sort();
    expect(files).toHaveLength(7);
    expect(files[0] > 'backup-2026-05-03.json').toBe(true); // 가장 오래된 것들 삭제됨
  });
});
