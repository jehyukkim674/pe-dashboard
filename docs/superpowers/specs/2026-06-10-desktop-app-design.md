# PE Dashboard 데스크톱 앱 전환 — 설계 문서

날짜: 2026-06-10
상태: 승인됨
선행: `2026-06-10-pe-dashboard-design.md` (1단계 웹앱, 구현 완료)

## 개요

1단계로 완성된 PE Dashboard 웹앱을 세 가지로 변경한다.

1. **Electron 데스크톱 앱**: 크롬 브라우저가 아닌 자체 창(웹뷰)으로 실행.
   `npm run app`으로 개발 실행, electron-builder로 macOS `.app`/`.dmg` 빌드.
2. **AI 백엔드를 Claude CLI로 교체**: Anthropic API 키 대신 로컬에 설치·로그인된
   `claude` CLI를 백그라운드에서 단발 호출. 정해진 작업 JSON 포맷으로 결과를 받아
   대시보드에 적용한다.
3. **자동 업데이트**: `~/Dev/DataMigration`(Tauri + plugin-updater)의 UX를
   electron-updater로 동일하게 재현 — 확인 → 다운로드 진행률 표시 → **100%** →
   자동 재시작.

## 1. Electron 구조

```
pe-dashboard/
├── electron/                # 새 워크스페이스 (TypeScript)
│   ├── package.json         # electron, electron-updater, electron-builder
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts          # 메인 프로세스: 서버 기동 + BrowserWindow
│   │   ├── preload.ts       # contextBridge: 업데이트 IPC 노출
│   │   └── updater.ts       # electron-updater 래퍼
│   └── electron-builder.yml # .app/.dmg + latest-mac.yml 생성, GitHub publish
├── server/                  # 기존 + buildApp을 Electron에서 직접 호출 가능하게
└── web/                     # 기존 + UpdateModal 추가
```

### 실행 모드

- **개발 (`npm run app:dev`)**: Vite dev 서버(5173) + Fastify(5174)를 띄우고
  Electron 창이 `http://localhost:5173` 로드 (HMR 유지).
- **프로덕션 (.app)**: Electron 메인 프로세스가 같은 프로세스 안에서 Fastify를
  기동(`buildApp` 직접 import). Fastify가 `web/dist`를 `@fastify/static`으로
  정적 서빙하고, 창은 `http://localhost:5174` 로드. 별도 자식 프로세스 없음.
- 포트 5174가 사용 중이면 빈 포트로 폴백하고 창은 실제 포트를 로드한다.
- 데이터 디렉토리: 프로덕션에서는 `app.getPath('userData')/data`
  (개발에서는 기존 `<repo>/data` 유지).
- 보안 기본값 유지: `contextIsolation: true`, `nodeIntegration: false`,
  preload의 contextBridge로 업데이트 API만 노출.
- 창 기본 크기 1600×1000 (DataMigration과 동일), 닫으면 앱 종료(macOS 표준
  Dock 동작은 1단계에서 단순화: 마지막 창 닫히면 quit).

## 2. Claude CLI 어댑터 ("기본 포맷")

### LLM 어댑터 인터페이스

기존 `ChatService`(Anthropic API tool-use 루프)를 어댑터 패턴으로 분리한다.

```ts
interface ChatAdapter {
  chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void>;
}
```

- **`ClaudeCliAdapter` (기본)**: 채팅 1회 = `claude -p <프롬프트> --output-format json`
  1회 실행 (execFile, 타임아웃 120초, 셸 미사용).
- **`ApiChatAdapter` (보존)**: 기존 ChatService. `ANTHROPIC_API_KEY`가 설정되어
  있고 `CHAT_ADAPTER=api`일 때 선택. 기본값은 `cli`.
- ChatEvent 타입·SSE 라우트·프론트 ChatDrawer는 **변경 없음**.

### 작업 JSON 포맷 (기본 포맷)

프롬프트에 현재 대시보드 상태 + 명령 템플릿 목록 + 아래 스키마를 담는다.
Claude는 이 JSON **하나만** 반환해야 한다.

```json
{
  "reply": "사용자에게 보여줄 한국어 답변",
  "operations": [
    { "op": "create_dashboard", "name": "배포 현황" },
    { "op": "delete_dashboard", "id": "..." },
    { "op": "add_widget", "dashboardId": "...", "widget": { "type": "stat", "title": "...", "layout": {"x":0,"y":0,"w":3,"h":2}, "dataSource": {...}, "display": {...} } },
    { "op": "update_widget", "dashboardId": "...", "widgetId": "...", "patch": {...} },
    { "op": "remove_widget", "dashboardId": "...", "widgetId": "..." },
    { "op": "register_command", "id": "...", "description": "...", "argv": ["..."], "params": ["..."] }
  ]
}
```

- `create_dashboard`로 만든 대시보드를 같은 응답의 `add_widget`이 참조할 수 있도록,
  `dashboardId`에 `"$last"` 별칭을 허용한다(직전에 생성된 대시보드 id로 치환).
- **OpApplier**: operations를 순서대로 기존 AI 도구 핸들러(검증 포함)에 매핑해
  적용. op마다 기존과 동일한 `tool` SSE 이벤트(요약 칩) 발생.
  `register_command`는 기존 pending 승인 플로우 그대로(`confirm_request` 이벤트).
- 한 op가 실패하면 해당 op만 에러 이벤트로 표시하고 나머지는 계속 적용한다.
- `claude` CLI 호출 시 도구 실행 권한이 필요 없는 순수 텍스트 생성이므로
  `--output-format json`의 `result` 필드(텍스트)에서 JSON을 추출한다.
  코드펜스(```json ... ```)로 감싸 반환하는 경우도 벗겨서 파싱한다.

### 에러 처리

- `claude` 미설치(ENOENT) → "claude CLI를 찾을 수 없습니다. Claude Code를 설치하세요."
- 비로그인/권한 에러 → CLI stderr를 채팅 에러로 표시.
- JSON 파싱 실패 → 원문 일부를 포함한 파싱 에러를 채팅에 표시.
- 타임아웃(120초) → 타임아웃 에러 표시.

### 세션

CLI 단발 호출이므로 멀티턴 메모리는 서버가 유지하는 **요약 히스토리**(직전
user/reply 텍스트 최대 10쌍)를 프롬프트에 포함하는 방식으로 근사한다.

## 3. 자동 업데이트 (DataMigration UX 재현)

### 동작 (DataMigration `src/core/updater.ts`와 동일한 상태 모델)

```ts
type UpdateCheck =
  | { kind: 'available'; currentVersion: string; update: { version, notes, install } }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };
```

- electron-updater(`autoUpdater`) 사용, 피드는 GitHub Releases
  (electron-builder `publish: github`, `latest-mac.yml` + zip/dmg 아티팩트).
- `install(onProgress)`: `download-progress` 이벤트로 0~99%,
  `update-downloaded`에서 **100%** 콜백 후 `quitAndInstall()` → 재시작.
- 앱 시작 5초 후 자동 체크(조용히) + 메뉴/단축키로 수동 체크.
- IPC: preload가 `window.appUpdater.{check, install, onProgress}` 노출.
  웹(UpdateModal)은 Electron 환경일 때만 동작(브라우저 단독 실행 시 미표시).

### UI (web/src/components/UpdateModal.tsx)

- AntD Modal: 새 버전 번호, 릴리스 노트, Progress 바(0→100%), [업데이트] [나중에]
- 다운로드 완료 시 100% 표시 후 자동 재시작.

### 전제와 우아한 실패

- GitHub 저장소·릴리스 필요 (예: `jehyukkim674/pe-dashboard`). 저장소 미설정/
  릴리스 없음/네트워크 실패 시: 자동 체크는 조용히 무시, 수동 체크는
  "최신 버전입니다" 또는 에러 메시지 표시. 앱 동작에는 영향 없음.
- 코드 서명 없는 로컬 빌드에서 macOS 업데이트 설치가 제한될 수 있음 —
  zip 아티팩트 기반 업데이트로 구성하고, 서명은 추후 과제로 명시.

## 테스트

- `ClaudeCliAdapter`: execFile 모킹 — 정상 JSON / 코드펜스 JSON / 파싱 실패 /
  ENOENT / 타임아웃.
- `OpApplier`: 실제 store로 적용 검증 — $last 치환, 부분 실패 계속 진행,
  register_command pending 큐.
- 기존 47개 테스트 유지 (ApiChatAdapter로 이름만 바뀐 기존 ChatService 테스트 포함).
- Electron 메인/업데이터: 수동 검증 (`npm run app:dev`, 빌드 후 .app 실행).

## 단계 외 (명시적 제외)

- macOS 코드 서명·공증, Windows/Linux 패키징
- 업데이트 단계적 롤아웃(staged rollout)
- CLI 멀티턴 `--resume` 세션
