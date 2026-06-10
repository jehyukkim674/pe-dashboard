# PE Dashboard

AI 채팅(오른쪽 drawer)으로 말하면 CLI 기반 위젯 대시보드를 만들어주는 로컬 전용 도구.

## 시작하기 (데스크톱 앱)

```bash
npm install
npm run app:dev     # 개발: Electron 창 + HMR (server:5174, web:5173)
npm run app:build   # 패키징: electron/release/ 에 .app/.dmg 생성
```

AI 채팅은 로컬 `claude` CLI(Claude Code)를 사용한다 — 별도 API 키 불필요.
Claude Code가 설치·로그인되어 있어야 한다. (API 모드로 쓰려면
`CHAT_ADAPTER=api` + `server/.env`에 `ANTHROPIC_API_KEY` 설정)

## 구조

- `server/` Fastify + TypeScript — 대시보드 JSON CRUD, 화이트리스트 CLI 실행, Claude tool-use 루프
- `web/` React + AntD + TypeScript — 그리드 대시보드(드래그&드롭 수동 편집) + AI 채팅 drawer
- `data/` 대시보드/커스텀 명령 저장 (JSON 파일, gitignore)

## 명령어

```bash
npm run app:dev    # Electron 개발 실행
npm run app:build  # .app/.dmg 빌드
npm run dev        # (웹 전용) server + web 브라우저 모드
npm test           # 서버 단위 테스트
npm run lint       # ESLint
```

## 자동 업데이트

GitHub Releases(`latest-mac.yml` + zip) 기반. 앱 시작 5초 후 자동 확인,
사이드바 '업데이트 확인'으로 수동 확인. 다운로드 진행률 100% 후 자동 재시작.
릴리스 배포: electron/package.json 버전 올리고 `npm run app:build` 후 GitHub
Release에 `electron/release/*.zip`, `*.dmg`, `latest-mac.yml` 업로드.

## 확장 포인트

- 데이터 소스: `server/src/datasources/` 에 `DataSource` 구현 추가 (postgres, http…)
- 위젯 타입: `web/src/components/widgets/` + `server/src/types.ts`의 `WidgetType`
- AI 도구: `server/src/ai/tools.ts`의 definitions/handlers에 쌍 추가

## 보안 메모

등록된 명령 템플릿만 실행된다(셸 미사용, argv spawn, 파라미터 문자 검증).
AI의 신규 명령 등록은 채팅창에서 사용자가 승인해야 반영된다.
