import { app, BrowserWindow, ipcMain } from 'electron';
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

app.whenReady().then(async () => {
  ipcMain.handle('updater:check', () => checkUpdateStatus());
  ipcMain.handle('updater:install', () => (win ? startInstall(win) : undefined));
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
