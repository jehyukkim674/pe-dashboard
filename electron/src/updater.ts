import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = false; // 사용자가 [업데이트]를 눌러야 다운로드

export type UpdateCheck =
  | { kind: 'available'; currentVersion: string; version: string; notes: string }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

// 수동/자동 체크 공용. 피드(GitHub Releases) 미설정·네트워크 오류는 kind:'error'로 수렴.
export async function checkUpdateStatus(): Promise<UpdateCheck> {
  const currentVersion = app.getVersion();
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (!info || info.version === currentVersion) {
      return { kind: 'latest', currentVersion };
    }
    return {
      kind: 'available',
      currentVersion,
      version: info.version,
      notes: flattenNotes(info.releaseNotes),
    };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 다운로드 진행률 0~99% 송출, 완료 시 100% 표시 후 재시작 (DataMigration UX 동일)
export async function startInstall(win: BrowserWindow): Promise<void> {
  const send = (percent: number) => win.webContents.send('updater:progress', percent);
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.removeAllListeners('update-downloaded');
  autoUpdater.on('download-progress', (p) => send(Math.min(99, Math.round(p.percent))));
  autoUpdater.once('update-downloaded', () => {
    send(100);
    setTimeout(() => autoUpdater.quitAndInstall(), 500); // 100% 표시할 시간
  });
  send(0);
  await autoUpdater.downloadUpdate();
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
