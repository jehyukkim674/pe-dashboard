import { app, shell, type BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = false; // 사용자가 [업데이트]를 눌러야 다운로드

const RELEASES_URL = 'https://github.com/jehyukkim674/pe-dashboard/releases/latest';

export type UpdateCheck =
  | { kind: 'available'; currentVersion: string; version: string; notes: string; canAutoInstall: boolean }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

// macOS 자동 업데이트(Squirrel.Mac)는 Developer ID 정식 서명을 요구한다. ad-hoc 서명 앱은
// 다운로드는 되지만 quitAndInstall이 서명 검증에 실패해 적용되지 않는다. 그래서 서명 여부를
// codesign으로 확인해, 서명이 안 됐으면 자동 설치 대신 수동 다운로드를 안내한다.
let signedCache: boolean | undefined;
export function canAutoInstall(): boolean {
  if (signedCache !== undefined) return signedCache;
  signedCache = false;
  try {
    // app.getPath('exe') = .../PE Dashboard.app/Contents/MacOS/PE Dashboard → 번들 루트는 3단계 위
    const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
    const r = spawnSync('codesign', ['-dvv', bundle], { encoding: 'utf8' });
    const info = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    // Developer ID로 서명되면 TeamIdentifier가 설정되고 Authority에 'Developer ID Application'이 뜬다
    signedCache =
      /Authority=Developer ID Application/.test(info) ||
      (/TeamIdentifier=/.test(info) && !/TeamIdentifier=not set/.test(info));
  } catch {
    signedCache = false;
  }
  return signedCache;
}

// 서명 안 된 빌드에서 자동 적용 대신 최신 릴리스 페이지를 연다 (수동 다운로드·교체 안내)
export async function openReleasePage(): Promise<void> {
  await shell.openExternal(RELEASES_URL);
}

// semver 비교: candidate가 current보다 새 버전일 때만 true (낮거나 같으면 false)
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// 수동/자동 체크 공용. 피드(GitHub Releases) 미설정·네트워크 오류는 kind:'error'로 수렴.
export async function checkUpdateStatus(): Promise<UpdateCheck> {
  const currentVersion = app.getVersion();
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    // 최신 릴리스가 현재보다 낮거나 같으면(로컬 빌드가 더 새 버전인 경우) 업데이트 제안 금지
    if (!info || !isNewerVersion(info.version, currentVersion)) {
      return { kind: 'latest', currentVersion };
    }
    return {
      kind: 'available',
      currentVersion,
      version: info.version,
      notes: flattenNotes(info.releaseNotes),
      canAutoInstall: canAutoInstall(),
    };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 다운로드 진행률 0~99% 송출, 완료 시 100% 송출. 재시작은 사용자가 '지금 재시작'을 눌러야 한다
// (electron-updater 기본값 autoInstallOnAppQuit=true라, 나중에 종료해도 자동 적용된다).
export async function startInstall(win: BrowserWindow): Promise<void> {
  // electron-updater는 다운로드 전에 같은 세션의 체크 상태를 요구한다
  // ("Please check update first"). 직전에 한 번 더 체크해 상태를 보장한다.
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  if (!info || !isNewerVersion(info.version, app.getVersion())) {
    throw new Error('설치할 새 버전이 없습니다');
  }

  const send = (percent: number) => win.webContents.send('updater:progress', percent);
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.removeAllListeners('update-downloaded');
  autoUpdater.on('download-progress', (p) => send(Math.min(99, Math.round(p.percent))));
  autoUpdater.once('update-downloaded', () => send(100));
  send(0);
  await autoUpdater.downloadUpdate();
}

// 다운로드된 업데이트를 적용하며 앱을 재시작한다 (사용자가 '지금 재시작' 클릭 시)
export function restartToUpdate(): void {
  autoUpdater.quitAndInstall();
}

function flattenNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? '')))
      .join('\n');
  }
  return '';
}
