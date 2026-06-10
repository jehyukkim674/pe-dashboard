# PE Dashboard

AI 채팅(오른쪽 drawer)으로 말하면 CLI 기반 위젯 대시보드를 만들어주는 로컬 전용 도구.

## 시작하기

```bash
npm install
cp server/.env.example server/.env   # ANTHROPIC_API_KEY 기입
npm run dev                           # server:5174 + web:5173
```

브라우저에서 http://localhost:5173 → 우하단 채팅 버튼 →
"배포 현황 대시보드 만들고 argocd 앱 목록 테이블 넣어줘"

## 구조

- `server/` Fastify + TypeScript — 대시보드 JSON CRUD, 화이트리스트 CLI 실행, Claude tool-use 루프
- `web/` React + AntD + TypeScript — 그리드 대시보드(드래그&드롭 수동 편집) + AI 채팅 drawer
- `data/` 대시보드/커스텀 명령 저장 (JSON 파일, gitignore)

## 명령어

```bash
npm run dev        # 서버 + 웹 동시 실행
npm test           # 서버 단위 테스트 (Vitest)
npm run lint       # ESLint (server + web)
npm run typecheck -w server && npm run typecheck -w web
```

## 확장 포인트

- 데이터 소스: `server/src/datasources/` 에 `DataSource` 구현 추가 (postgres, http…)
- 위젯 타입: `web/src/components/widgets/` + `server/src/types.ts`의 `WidgetType`
- AI 도구: `server/src/ai/tools.ts`의 definitions/handlers에 쌍 추가

## 보안 메모

등록된 명령 템플릿만 실행된다(셸 미사용, argv spawn, 파라미터 문자 검증).
AI의 신규 명령 등록은 채팅창에서 사용자가 승인해야 반영된다.
