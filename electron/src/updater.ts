import { app, shell, type BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { classifyBundlePath, type InstallStrategy } from './update-helpers.js';
import { currentBundlePath, downloadUnsigned, restartWithSwap } from './updater-unsigned.js';

autoUpdater.autoDownload = false; // 사용자가 [업데이트]를 눌러야 다운로드

const RELEASES_URL = 'https://github.com/jehyukkim674/pe-dashboard/releases/latest';

export type UpdateCheck =
  | {
      kind: 'available';
      currentVersion: string;
      version: string;
      notes: string;
      canAutoInstall: boolean;
      // squirrel(서명) 경로만 앱 종료 시 자동 적용된다. custom(미서명)은 '지금 재시작'에서만 교체된다.
      autoApplyOnQuit: boolean;
    }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

// macOS 자동 업데이트(Squirrel.Mac)는 Developer ID 정식 서명을 요구한다. 미서명 빌드는
// quitAndInstall이 서명 검증에 실패하므로, 미서명이면 커스텀 다운로드+교체(custom)로,
// 교체 불가한 위치(읽기전용/App Translocation)면 수동 폴백(manual)으로 분기한다.
let strategyCache: InstallStrategy | undefined;

function isSigned(): boolean {
  try {
    const bundle = currentBundlePath();
    const r = spawnSync('codesign', ['-dvv', bundle], { encoding: 'utf8' });
    const info = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    return (
      /Authority=Developer ID Application/.test(info) ||
      (/TeamIdentifier=/.test(info) && !/TeamIdentifier=not set/.test(info))
    );
  } catch {
    return false;
  }
}

function isBundleWritable(bundle: string): boolean {
  try {
    accessSync(path.dirname(bundle), constants.W_OK);
    accessSync(bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// 설치 전략: 서명됨→squirrel, 미서명+교체가능→custom, 그 외→manual(수동 폴백).
export function installStrategy(): InstallStrategy {
  if (strategyCache !== undefined) return strategyCache;
  if (isSigned()) {
    strategyCache = 'squirrel';
  } else {
    const bundle = currentBundlePath();
    strategyCache = classifyBundlePath(bundle, isBundleWritable(bundle));
  }
  return strategyCache;
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
      canAutoInstall: installStrategy() !== 'manual',
      autoApplyOnQuit: installStrategy() === 'squirrel',
    };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 다운로드 진행률 0~100% 송출. 재시작은 사용자가 '지금 재시작'을 눌러야 한다.
export async function startInstall(win: BrowserWindow): Promise<void> {
  const send = (percent: number) => win.webContents.send('updater:progress', percent);

  // 다운로드 전에 최신 릴리스가 여전히 현재보다 새 버전인지 확인한다(서명·미서명 공통).
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  if (!info || !isNewerVersion(info.version, app.getVersion())) {
    throw new Error('설치할 새 버전이 없습니다');
  }

  if (installStrategy() === 'custom') {
    // 미서명: 커스텀 다운로드+압축해제(교체는 restartToUpdate에서). 받는 릴리스가 방금 확인한 버전과
    // 같은지 검증해, 체크 이후 새 릴리스가 나와 엉뚱한 버전이 설치되는 것을 막는다.
    await downloadUnsigned(send, info.version);
    return;
  }

  // 서명: electron-updater.
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.removeAllListeners('update-downloaded');
  autoUpdater.on('download-progress', (p) => send(Math.min(99, Math.round(p.percent))));
  autoUpdater.once('update-downloaded', () => send(100));
  send(0);
  await autoUpdater.downloadUpdate();
}

// 다운로드된 업데이트를 적용하며 앱을 재시작한다.
export function restartToUpdate(): void {
  if (installStrategy() === 'custom') {
    restartWithSwap();
    return;
  }
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
