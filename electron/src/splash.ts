import { BrowserWindow } from 'electron';

// 시작 스플래시: 서버 부팅·렌더러 로드 동안 빈 창 대신 즉시 보여줄 가벼운 브랜드 화면.
// 외부 에셋 없이 인라인 HTML(data URL)로 띄워 패키징 의존성을 없앤다.
// 단계별 진행바를 노출해, 느린 시작 구간에도 어디까지 진행됐는지 피드백을 준다.
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;
    -webkit-user-select:none;cursor:default;}
  .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:16px;background:#ffffff;border-radius:16px;
    box-shadow:0 12px 48px rgba(0,0,0,0.22);color:#1a1a1a;}
  @media (prefers-color-scheme: dark){.card{background:#1f1f1f;color:#ededed;}}
  .title{font-size:20px;font-weight:600;letter-spacing:.2px;}
  .bar{width:200px;height:5px;border-radius:3px;background:rgba(128,128,128,0.2);overflow:hidden;}
  .fill{width:8%;height:100%;border-radius:3px;background:#1677ff;
    transition:width .35s cubic-bezier(.4,0,.2,1);}
  .sub{font-size:12px;opacity:.6;}
</style></head><body><div class="card">
  <div class="title">PE Dashboard</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div class="sub" id="sub">시작하는 중…</div>
</div>
<script>
  // 메인 프로세스가 executeJavaScript로 호출해 진행 상태를 갱신한다
  window.setStage = function (pct, text) {
    var f = document.getElementById('fill');
    if (f) f.style.width = Math.max(0, Math.min(100, pct)) + '%';
    var s = document.getElementById('sub');
    if (s && text) s.textContent = text;
  };
</script></body></html>`;

export interface Splash {
  window: BrowserWindow;
  // 진행 단계를 갱신한다 (스플래시 로드 완료 후 안전하게 적용, 실패는 무시).
  setStage: (pct: number, text: string) => void;
}

export function createSplashWindow(): Splash {
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
  // loadURL은 로드 완료 시 resolve — 이후에 window.setStage가 정의돼 있다.
  const ready = splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)
    .catch(() => {});
  splash.once('ready-to-show', () => splash.show());

  const setStage = (pct: number, text: string): void => {
    void ready.then(() => {
      if (splash.isDestroyed()) return;
      splash.webContents
        .executeJavaScript(`window.setStage && window.setStage(${pct}, ${JSON.stringify(text)})`)
        .catch(() => {}); // 스플래시가 이미 닫혔으면 무시
    });
  };

  return { window: splash, setStage };
}
