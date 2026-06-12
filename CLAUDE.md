# PE Dashboard — Claude 작업 가이드

AI 채팅으로 CLI 기반 모니터링 위젯 대시보드를 만드는 로컬 Electron 앱.
npm workspaces: `server/`(Fastify+TS) · `web/`(React 19 + antd 6 + Vite 8) · `electron/`(워크스페이스명 "desktop").

## 자주 쓰는 명령

```bash
npm run app:dev    # Electron 개발 (server 15174 + vite 5173 + electron)
npm run dev        # 브라우저 모드 (Electron 없이)
npm run stop       # dev 프로세스 일괄 정리 — 종료가 꼬이면 반드시 이걸로
npm test           # 서버 + 웹 테스트 전부
npm run lint       # ESLint (루트에서)
npm run app:build  # 패키징 (electron/release/)
```

- 워크스페이스별 typecheck: `cd web && npx tsc --noEmit` (server/electron 동일)
- 테스트 러너는 vitest. 서버 테스트는 `server/test/`, 웹은 `web/test/`

## 포트·데이터 (중요)

- **dev 서버 15174 / 패키징 앱 5174** — vite proxy는 15174 고정
- 데이터 디렉터리 이원화: dev는 repo `data/`, 패키징 앱은
  `~/Library/Application Support/PE Dashboard/data`
- 패키징 앱과 dev Electron은 단일 인스턴스 잠금으로 동시 실행 불가
  (브라우저 dev 모드는 패키징 앱과 동시 실행 가능)

## 아키텍처 핵심

- **AI 흐름**: web ChatDrawer → POST /api/chat(SSE) → `ClaudeCliAdapter`가
  `claude -p … --output-format json` 실행(읽기 전용 --allowedTools) →
  응답 JSON의 operations[]를 `applyOperations`(ai/operations.ts)가 toolkit 핸들러로 적용
- **명령 실행 안전**: `commands/safety.ts` 2단계 — block(파괴적, 즉시 거부) /
  warn(변경성, 등록 승인 UI에 ⚠️). 등록(validateTemplate)과 실행(buildArgv) 양쪽 검사
- **register_command 승인 흐름**: AI 등록 요청 → PendingCommands 대기(같은 응답의
  의존 위젯 작업은 deferred로 보류) → 사용자 승인 시 등록 + 보류 작업 적용
- **ResultCache**: 같은 argv 명령 실행을 TTL 10초 공유 (위젯 N개 + AI 컨텍스트)
- **감사 로그**: runner.runArgv가 모든 실행을 `data/logs/commands.jsonl`에 기록
- **화면 컨텍스트**: 채팅에 dashboardId가 오면 그 위젯 명령들을 실행해 프롬프트에 포함,
  나머지 대시보드는 요약만 (프롬프트 다이어트)

## 컨벤션

- 커밋: 한글 Conventional (`기능:`/`버그수정:`/`빌드:`/`보안수정:` …), 기능 단위 분리
- 주석은 한글, "왜"를 설명
- web과 server의 `types.ts`는 수동 동기화 — 한쪽 바꾸면 반드시 양쪽
- react-grid-layout은 v2의 `/legacy` 진입점 사용 (draggableCancel 필요)
- electron 버전은 **고정값**(범위 금지 — electron-builder 26 요구)

## 릴리스 절차

1. `electron/package.json` 버전 업 → 커밋
2. `npm run app:build`
3. `gh release create vX.Y.Z electron/release/PE-Dashboard-X.Y.Z-arm64-mac.zip{,.blockmap} electron/release/latest-mac.yml --title vX.Y.Z --notes "..."`
4. 설치: `ditto -x -k <zip> ~/Applications/`
