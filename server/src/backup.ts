import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DashboardStore } from './dashboardStore.js';
import type { CommandRegistry } from './commands/registry.js';
import { writeJsonAtomic } from './jsonFile.js';

const KEEP_BACKUPS = 7;
const FILE_RE = /^backup-\d{4}-\d{2}-\d{2}\.json$/;

// 서버 시작 시 하루 1개 백업 스냅샷(export 번들과 같은 포맷)을 남기고
// 오래된 것은 정리한다. 복구는 UI의 '가져오기'로 이 파일을 올리면 된다.
export async function writeDailyBackup(
  dir: string,
  store: DashboardStore,
  commands: CommandRegistry,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `backup-${today}.json`);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(file);
    return; // 오늘 치 백업이 이미 있음
  } catch {
    // 없음 → 생성
  }

  const bundle = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    dashboards: await store.list(),
    commands: commands.list().filter((t) => !t.builtin),
  };
  await writeJsonAtomic(file, bundle);

  const files = (await fs.readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    await fs.unlink(path.join(dir, old));
  }
}
