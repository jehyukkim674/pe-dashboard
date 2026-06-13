import { BrowserWindow } from 'electron';

// 시작 스플래시: 서버 부팅·렌더러 로드 동안(프로덕션 1~2초) 빈 창 대신 즉시 보여줄
// 가벼운 브랜드 화면. 외부 에셋 없이 인라인 HTML(data URL)로 띄워 패키징 의존성을 없앤다.
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;
    -webkit-user-select:none;cursor:default;}
  .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:16px;background:#ffffff;border-radius:16px;
    box-shadow:0 12px 48px rgba(0,0,0,0.22);color:#1a1a1a;}
  @media (prefers-color-scheme: dark){.card{background:#1f1f1f;color:#ededed;}}
  .spinner{width:36px;height:36px;border-radius:50%;
    border:3px solid rgba(128,128,128,0.25);border-top-color:#1677ff;
    animation:spin .8s linear infinite;}
  .title{font-size:20px;font-weight:600;letter-spacing:.2px;}
  .sub{font-size:12px;opacity:.6;}
  @keyframes spin{to{transform:rotate(360deg);}}
</style></head><body><div class="card">
  <div class="spinner"></div>
  <div class="title">PE Dashboard</div>
  <div class="sub">시작하는 중…</div>
</div></body></html>`;

export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  splash.once('ready-to-show', () => splash.show());
  return splash;
}
