import { app, BrowserWindow, dialog, ipcMain, type Rectangle } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer } from '../../server/src/start.js';
import { checkUpdateStatus, restartToUpdate, startInstall } from './updater.js';
import { createSplashWindow } from './splash.js';

// Finder/독에서 실행된 앱은 셸 PATH(.zprofile 등)를 상속받지 못해
// claude·gh·argocd 같은 CLI를 찾지 못한다. 로그인 셸의 PATH로 보정한다.
function fixGuiPath(): void {
  try {
    const shell = process.env.SHELL ?? '/bin/zsh';
    const shellPath = execFileSync(shell, ['-lc', 'echo -n "$PATH"'], {
      encoding: 'utf8', timeout: 5_000,
    });
    if (shellPath.includes('/')) process.env.PATH = shellPath;
  } catch {
    // 로그인 셸 실패 시 아래 흔한 경로 추가로 폴백
  }
  const current = (process.env.PATH ?? '').split(':');
  const extras = ['/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local', 'bin')]
    .filter((e) => !current.includes(e));
  process.env.PATH = [...current, ...extras].join(':');
}

let win: BrowserWindow | null = null;

// 마지막 창 크기·위치를 저장했다가 다음 실행 때 복원한다
function boundsFile(): string {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}

function loadBounds(): Partial<Rectangle> {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8')) as Partial<Rectangle>;
  } catch {
    return {};
  }
}

async function createWindow(): Promise<void> {
  fixGuiPath();

  // 부팅 동안 빈 창 대신 스플래시를 즉시 띄우고, 본 창은 콘텐츠가 준비될 때 보여준다
  const splash = createSplashWindow();
  let splashDone = false;
  const finishSplash = () => {
    if (splashDone) return;
    splashDone = true;
    if (!splash.isDestroyed()) splash.close();
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };

  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    ...loadBounds(),
    minWidth: 720,
    minHeight: 480,
    show: false, // 콘텐츠 준비 후 finishSplash에서 표시 (흰 화면 깜빡임 방지)
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('close', () => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win!.getBounds()));
    } catch {
      // 저장 실패는 무시 (다음 실행에 기본 크기 사용)
    }
  });

  // 콘텐츠 로드 완료 시 스플래시 종료 + 본 창 표시. 로드가 지연돼도 15초 후엔 강제로 띄운다.
  win.webContents.once('did-finish-load', finishSplash);
  setTimeout(finishSplash, 15_000);

  try {
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
  } catch (err) {
    finishSplash(); // 실패해도 스플래시를 닫아 사용자가 멈춘 화면에 갇히지 않게 한다
    throw err;
  }
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
    ipcMain.handle('updater:restart', () => restartToUpdate());
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
