# PE Dashboard — 설계 문서

날짜: 2026-06-10
상태: 승인됨

## 개요

로컬 전용 Platform Engineering 대시보드. 오른쪽 drawer 형태의 AI 채팅으로 말하면
메인 영역에 대시보드가 동적으로 생성·수정된다. 대시보드는 여러 개를 만들 수 있고,
위젯 데이터는 CLI 명령(gh, argocd, git 등) 실행 결과를 기반으로 한다.

## 확정 요구사항

- **실행 환경**: 사용자 개인 맥, localhost 전용. 사용자의 셸 환경(gh 로그인, kubeconfig 등)을 그대로 사용. 별도 인증 없음.
- **AI 조작 방식**: Claude API tool-use 기반 조작형(A안). AI가 `add_widget` 등 도구를 호출해 필요한 부분만 정밀 변경. 수동 편집 내용 보존.
- **데이터 소스**: 1단계는 CLI 명령 템플릿. 확장 포인트로 Postgres/HTTP/SQL 생성 지원 예정.
- **편집**: AI 채팅 + 수동 편집(드래그&드롭 이동·리사이즈·삭제, react-grid-layout) 병행.
- **스택**: React + Ant Design 프론트, Node.js(Fastify) + TypeScript 백엔드, Claude API.
- **멀티 대시보드**: 탭/사이드바로 여러 대시보드 전환.

## 아키텍처

```
┌─────────────────────────────────────────────┐
│  브라우저 (React + AntD + react-grid-layout) │
│  ┌────────────────────────┐  ┌────────────┐  │
│  │  메인: 대시보드 그리드   │  │ AI 채팅     │  │
│  │  (위젯 렌더러)          │  │ Drawer     │  │
│  │  탭/사이드바로 전환      │  │ (오른쪽)    │  │
│  └────────────────────────┘  └────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ REST + SSE(스트리밍)
┌──────────────────┴──────────────────────────┐
│  Node.js 백엔드 (Fastify + TypeScript)       │
│  ├─ ChatService: Claude API + tool-use 루프  │
│  ├─ DashboardStore: 대시보드 CRUD (JSON 파일) │
│  ├─ DataSourceRegistry: 데이터 소스 플러그인  │
│  │   ├─ CliSource: 화이트리스트 기반 CLI 실행 │
│  │   └─ (확장: PostgresSource, HttpSource)   │
│  └─ WidgetCatalog: 위젯 타입 정의            │
└─────────────────────────────────────────────┘
```

### 확장 포인트 (3개)

1. **데이터 소스 플러그인**(`DataSourceRegistry`): `kind` 문자열로 구현체 등록.
   1단계는 `cli`만, 이후 `postgres`, `http` 추가.
2. **위젯 타입 카탈로그**(`WidgetCatalog`): 타입별 렌더러·옵션 스키마 등록형.
3. **AI 도구 레지스트리**: Claude tool 정의를 핸들러와 함께 등록.
   도구 추가만으로 AI 능력 확장.

### 저장

- 대시보드 정의: `data/dashboards/<id>.json` (파일 1개 = 대시보드 1개)
- 커스텀 명령 템플릿: `data/commands.json`
- DB 불필요. git으로 버전 관리 가능, 깨져도 복구 쉬움.
- 쓰기는 원자적(temp 파일 → rename).

## 데이터 모델

```typescript
interface Dashboard {
  id: string;
  name: string;          // 예: "배포 현황"
  widgets: Widget[];
}

interface Widget {
  id: string;
  type: 'stat' | 'table' | 'chart' | 'log' | 'text';
  title: string;
  layout: { x: number; y: number; w: number; h: number };
  dataSource: {
    kind: 'cli';                    // 확장: 'postgres' | 'http'
    commandId: string;              // 등록된 명령 템플릿 ID
    params: Record<string, string>; // 예: { repo: "org/repo" }
    refreshSec?: number;            // 주기 폴링 간격
  };
  display?: Record<string, unknown>; // 컬럼 매핑, 차트 축 등 타입별 옵션
}
```

## AI 채팅 흐름

1. 사용자가 drawer 채팅 입력 → `POST /api/chat` (SSE 스트리밍 응답)
2. 백엔드가 Claude API 호출. 시스템 프롬프트에 현재 대시보드 상태 요약 +
   사용 가능한 명령 템플릿 목록 포함.
3. Claude가 tool-use로 도구 호출 → 백엔드 실행 → 결과 반환 → 루프(최대 횟수 제한).
4. 도구 실행마다 SSE 이벤트를 프론트에 푸시 → 메인 대시보드 실시간 갱신 +
   채팅창에 "○○ 위젯 추가됨" 액션 칩 표시.
5. 대화 히스토리는 세션 단위 메모리 유지(새로고침 시 초기화).

### AI 도구 목록 (1단계)

| 도구 | 역할 |
|------|------|
| `list_dashboards` | 대시보드 목록 조회 |
| `create_dashboard` / `delete_dashboard` | 대시보드 생성/삭제 |
| `add_widget` / `update_widget` / `remove_widget` | 위젯 조작 |
| `list_commands` | 사용 가능한 CLI 템플릿 조회 |
| `run_command_preview` | 명령 1회 실행해 출력 구조 확인 (에이전트형 확장의 씨앗) |
| `register_command` | 커스텀 명령 템플릿 등록 — **사용자 확인 버튼 필수** |

## 위젯 카탈로그 (초기 5종)

| 타입 | 용도 | 예시 |
|------|------|------|
| `stat` | 숫자/상태 카드 | 실패한 GitHub Action 수, ArgoCD Degraded 앱 수 |
| `table` | 목록 | gh run list, argocd app list |
| `chart` | 추이 (Recharts) | 일별 빌드 성공/실패 |
| `log` | 텍스트 스트림 | git log, 명령 raw 출력 |
| `text` | 마크다운 메모 | 대시보드 설명 |

## CLI 명령 실행 (보안 모델)

- **임의 명령 실행 금지.** 등록된 명령 템플릿만 실행 가능.
- 템플릿 예: `gh run list --repo {repo} --json status,conclusion,name,createdAt`
- 파라미터는 템플릿의 `{placeholder}` 위치에만 치환되며, 셸 메타문자 검증
  (셸 해석 없이 argv 배열로 spawn).
- 초기 내장 템플릿: `gh run list`, `gh pr list`, `git log`,
  `argocd app list`, `argocd app get {app}`, `lsof -i :{port}`(포트포워딩 상태).
- 커스텀 템플릿은 사용자가 `data/commands.json`에 직접 추가하거나,
  AI의 `register_command` 도구 호출 시 채팅창 확인 버튼을 거쳐 추가.
- 실행 타임아웃 10초.

## 에러 처리

- CLI 실패(비로그인, 타임아웃, 명령 없음) → 위젯에 에러 상태 + 원인 메시지
  (예: "gh 로그인이 필요합니다").
- 출력 파싱: JSON 출력 우선(`--json` 플래그 활용), 비JSON은 raw 텍스트로 처리.
- Claude API 에러/한도 → 채팅창에 에러 표시, 대시보드는 영향 없음.
- 파일 저장 실패 방지: 원자적 쓰기.

## 테스트

- 백엔드 핵심 로직 Vitest 단위 테스트:
  - DashboardStore CRUD
  - CLI 템플릿 파라미터 치환·화이트리스트 검증
  - AI 도구 핸들러 (Claude 응답은 모킹)
- 프론트는 1단계에서 수동 확인 위주.

## 단계 로드맵

- **1단계 (이번 구현)**: 위 전체 — CLI 위젯 + AI tool-use 조작 + 멀티 대시보드 + 수동 편집
- **2단계 (이후)**: PostgresSource·HttpSource 추가, AI SQL 생성(검토 승인 플로우 포함)
- **3단계 (이후)**: 에이전트형 — AI가 출력을 보고 파서/위젯 자동 제안 고도화
