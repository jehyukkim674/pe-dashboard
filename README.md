# PE Dashboard

AI 채팅(오른쪽 drawer)으로 말하면 CLI 기반 위젯 대시보드를 만들어주는 로컬 전용 도구.
수동 편집(위젯 추가/편집 모달, 드래그·리사이즈)도 지원한다.

## 시작하기 (데스크톱 앱)

```bash
npm install
npm run app:dev     # 개발: Electron 창 + HMR (server:15174, web:5173)
npm run app:build   # 패키징: electron/release/ 에 .app/.zip 생성
```

AI 채팅은 로컬 `claude` CLI(Claude Code)를 사용한다 — 별도 API 키 불필요.
Claude Code가 설치·로그인되어 있어야 한다. (API 모드로 쓰려면
`CHAT_ADAPTER=api` + `server/.env`에 `ANTHROPIC_API_KEY` 설정)

## 주요 기능

- **AI 채팅**: 현재 보고 있는 대시보드의 위젯 데이터를 근거로 답변하고,
  대시보드를 지정하지 않은 위젯 요청은 현재 화면에 적용. 드로어 상단에서
  응답 모델(기본/haiku/sonnet/opus) 선택 가능
- **수동 편집**: 위젯 추가/편집 모달(타입·CLI/HTTP 소스·표시 옵션), 드래그·리사이즈,
  갱신 주기 select(수동~5분), 사이드바에서 대시보드 이름 변경·삭제
- **조건 알림**: 명령 실패 시/출력에 문자열 포함 시 macOS 알림
- **내보내기/가져오기**: 대시보드·커스텀 명령을 JSON 파일로 백업·이동
- **TV 모드·다크 모드**, 위젯별 마지막 갱신 시각(HH:MM:SS)·정상/실패 표시

## 구조

- `server/` Fastify + TypeScript — 대시보드 JSON CRUD, 화이트리스트 CLI 실행(10초 캐시 공유),
  명령 감사 로그, Claude 어댑터
- `web/` React 19 + AntD 6 + TypeScript — 그리드 대시보드 + AI 채팅 drawer
- `electron/` 데스크톱 셸 (자동 업데이트, 창 크기 기억)
- `data/` 대시보드/커스텀 명령/감사 로그 저장 (dev 전용, gitignore).
  패키징 앱은 `~/Library/Application Support/PE Dashboard/data` 사용

## 명령어

```bash
npm run app:dev    # Electron 개발 실행
npm run app:build  # .app/.zip 빌드
npm run dev        # (웹 전용) server + web 브라우저 모드
npm run stop       # dev 관련 프로세스 일괄 정리 (고아 프로세스 방지)
npm test           # 서버 + 웹 단위 테스트
npm run lint       # ESLint
```

dev 서버는 **15174**, 패키징 앱은 **5174** — 포트가 분리되어 있어
설치된 앱과 브라우저 dev 모드를 동시에 띄워도 데이터가 섞이지 않는다.

## 환경변수 (server)

- `AI_READONLY=true` — AI를 조회 전용으로 (대시보드 변경·명령 등록 차단)
- `CHAT_ADAPTER=api` — claude CLI 대신 Anthropic API 사용

## 자동 업데이트

GitHub Releases(`latest-mac.yml` + zip) 기반. 앱 시작 5초 후 자동 확인,
사이드바 '업데이트 확인'으로 수동 확인. 릴리스 배포: electron/package.json
버전 올리고 `npm run app:build` 후 `electron/release/`의 zip·blockmap·latest-mac.yml을
GitHub Release에 업로드 (`gh release create vX.Y.Z ...`).

## 확장 포인트

- 데이터 소스: `server/src/datasources/` 에 `DataSource` 구현 추가 (postgres…)
- 위젯 타입: `web/src/components/widgets/` + `server/src/types.ts`의 `WidgetType`
- AI 도구: `server/src/ai/tools.ts`의 definitions/handlers에 쌍 추가

## 보안 메모

- 등록된 명령 템플릿만 실행 (셸 미사용, argv spawn, 파라미터 문자 검증)
- 2단계 안전장치: 파괴적 명령(rm·sudo·dd 등)은 차단, 변경성 명령(delete·push 등)은
  등록 시 ⚠️ 경고와 함께 사용자 승인 필요 (`server/src/commands/safety.ts`)
- AI의 claude CLI 실행은 읽기 전용 도구만 허용 (--allowedTools Read,Glob,Grep)
- 모든 명령 실행은 `data/logs/commands.jsonl`에 감사 기록 (GET /api/command-log)
