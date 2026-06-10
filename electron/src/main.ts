import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { startServer } from '../../server/src/start.js';
import { checkUpdateStatus, startInstall } from './updater.js';

let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 720,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    // 개발 모드: 서버·Vite는 별도 프로세스(npm run app:dev)로 이미 떠 있다
    await win.loadURL(devUrl);
    return;
  }

  // 프로덕션: 같은 프로세스에서 Fastify 기동, web/dist는 extraResources로 동봉
  const { port } = await startServer({
    dataDir: path.join(app.getPath('userData'), 'data'),
    staticDir: path.join(process.resourcesPath, 'web'),
    preferredPort: 5174,
  });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

// 동일 데이터 디렉토리에 대한 동시 쓰기 방지: 두 번째 인스턴스는 즉시 종료
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    ipcMain.handle('updater:check', () => checkUpdateStatus());
    ipcMain.handle('updater:install', () => (win ? startInstall(win) : undefined));
    await createWindow();
  }).catch((err: unknown) => {
    dialog.showErrorBox(
      'PE Dashboard — 시작 실패',
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
}
