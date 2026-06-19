# 명령 실패 진단 (Command Failure Diagnosis)

작성일: 2026-06-19
상태: 구현 완료 (브랜치 feat/command-failure-diagnosis)

## 배경 / 문제

패키징 앱 감사 로그(`commands.jsonl`) 3464건 중 **227건(6.5%)이 실패**이며 원인이 한쪽에
쏠려 있다.

| 바이너리 | 실패 | 비고 |
|---|---|---|
| `kubectl` | 183 (80%) | 대부분 exitCode 1 |
| `sh -c …kubectl` | 34 | 셸로 감싼 kubectl |
| `gh` | 5 | |
| `claude` | 3 | AI 어댑터 자체 |
| `argocd` | 2 | |

exitCode: `1` 172건 / `None` 55건(ENOENT·타임아웃·시그널). 즉 거의 전부 **kubectl이
exitCode 1로 죽는 것** — 인증 토큰 만료, context 없음, 클러스터 미연결(VPN), 네임스페이스
권한 등.

**구조적 발견**: 감사 로그에 stderr/에러가 저장되지 않아(`argv·ok·exitCode·durationMs`만)
"왜 실패했는지"를 로그만으로 알 수 없다. 반면 `CommandResult`는 이미 `stderr`·`error`를
웹까지 전달하지만(라이브 위젯은 손에 쥐고 있음) **에러 분류(category)가 어디에도 없어**
배지·그룹핑·AI 설명의 공통 언어가 없다.

## 목표

command 실패의 **원인 진단**. 세 표면에서 "왜 실패했고 어떻게 고치는지"를 보여준다:
위젯 인라인 · 전용 진단 패널 · AI 채팅. 세 표면이 **서버 한 곳에서 만든 단일 분류**를
공유한다(단일 진실원, 드리프트 없음).

비목표(YAGNI): 자동 재시도/복구, 사전 환경 점검, 원클릭 재로그인. 이번 범위는 진단까지.

## 접근법 (승인: A)

`commands/diagnose.ts`에 `diagnose(argv, result) → Diagnosis` 순수 함수 하나를 둔다.
- `runArgv`가 실패 시 `CommandResult.diagnosis`에 부착 (위젯 인라인·AI가 소비)
- `auditLog`가 `stderr`(절단·마스킹)+`category` 영속화 (전용 패널이 소비)
- 웹·AI·패널은 분류하지 않고 결과만 소비

## 섹션 1 — 에러 분류 체계

`diagnose`는 `(err.code, exitCode, stderr, bin)`를 **우선순위 순서로** 매칭해 카테고리
하나를 반환한다.

| category | 라벨(badge) | 매칭 신호 | hint(조치 안내) |
|---|---|---|---|
| `not_installed` | 미설치 | `err.code===ENOENT` | `'{bin}' 설치/PATH 확인. (GUI 실행 시 PATH 누락 가능)` |
| `timeout` | 시간초과 | `err.killed` (우리 10초) | 명령이 10초 초과 — 네트워크·VPN 또는 큰 출력 확인 |
| `auth_expired` | 인증만료 | stderr `unauthorized\|401\|token.*expir\|login required\|auth` | 재로그인 필요: `gh auth login` / `argocd login` / kubeconfig 토큰 갱신 |
| `unreachable` | 미연결 | stderr `connection refused\|dial tcp\|i/o timeout\|no route\|EOF\|TLS\|x509\|couldn't connect` | 클러스터/서버 미도달 — VPN 연결·엔드포인트 확인 |
| `context_missing` | 컨텍스트없음 | stderr `context .* not found\|current-context\|no configuration\|kubeconfig` | kubeconfig context 누락 — context 이름·파일 경로 확인 |
| `permission_denied` | 권한없음 | stderr `forbidden\|403\|not allowed\|cannot .* in .* namespace\|RBAC` | 해당 리소스/네임스페이스 권한 없음 — 계정·역할 확인 |
| `not_found` | 리소스없음 | stderr `not found\|404\|NotFound\|no such` (위 미해당) | 대상 리소스가 없음 — 이름·네임스페이스 오타 확인 |
| `bad_usage` | 잘못된사용 | `exitCode===2` 또는 stderr `unknown flag\|invalid argument\|usage:` | 명령 인자 오류 — 템플릿 argv 점검 |
| `unknown` | 실패 | fallback | stderr 원문 참고 |

설계 포인트:
- **순서 중요**: `auth_expired`를 `unreachable`보다 먼저(만료 토큰이 TLS류 메시지를 동반),
  `permission_denied`를 `not_found`보다 먼저(403 vs 404).
- 반환값 `{ category, label, hint }` — `label`=배지, `hint`=조치, `category`=그룹핑·AI 키.
- 기존 `runner.friendlyError`는 이 분류기 위에서 `hint`를 쓰도록 통합(중복 제거).

## 섹션 2 — 데이터 모델 & 흐름

타입 (`server/src/types.ts` ↔ `web/src/types.ts` 수동 동기화):

```ts
export type DiagnosisCategory =
  | 'not_installed' | 'timeout' | 'auth_expired' | 'unreachable'
  | 'context_missing' | 'permission_denied' | 'not_found' | 'bad_usage' | 'unknown';

export interface Diagnosis {
  category: DiagnosisCategory;
  label: string;   // 배지 문구
  hint: string;    // 조치 안내
}

export interface CommandResult {
  // ...기존 필드
  diagnosis?: Diagnosis;   // 실패(ok:false) 시에만 채움
}
```

- **`commands/diagnose.ts` (신규)**: 순수 함수, 외부 의존 없음.
  `diagnose(argv, { exitCode, stderr, errCode, killed }) → Diagnosis`
- **`runner.ts`**: `friendlyError`를 `diagnose()` 호출로 교체. 실패 시
  `result.diagnosis = diagnose(...)`, `result.error = diagnosis.hint`(하위호환).
  `logCommand`에 `stderr`·`category` 전달.
- **`auditLog.ts`**: `AuditEntry`에 옵션 필드 추가 —
  `stderr?: string`(실패 시에만, 500자 절단 + `Bearer …`·`token=…`·`password=…` 마스킹),
  `category?: DiagnosisCategory`. 성공 엔트리는 그대로(로그 비대화 방지).
- **라우트**: `/api/command-log`는 그대로 `AuditEntry[]` 반환(필드만 증가). 분류·집계는
  클라이언트에서. 별도 집계 API는 YAGNI.

흐름:
```
runArgv 실패 → diagnose() → CommandResult.diagnosis  ─┬─→ 위젯 인라인 (라이브)
                                                      └─→ AI 채팅 컨텍스트
            → logCommand(stderr,category) → commands.jsonl ─→ 전용 진단 패널 (이력)
```

결정 확정:
- (a) stderr는 500자 절단 + 토큰류 패턴 마스킹 후 저장(로컬 앱이나 stderr에 토큰이 찍힐 수 있음).
- (b) `error = hint`로 채워 기존 소비자 하위호환 유지.

## 섹션 3 — 세 표면 UX

**1) 위젯 인라인 (`WidgetCard` / 위젯 컴포넌트)**
- 상단: `label` 배지(예: `🔒 인증만료`) + 명령 id
- 본문: `hint` 한 줄
- 접기: "원문 보기" → `stderr` 펼침(antd `Collapse` 또는 `<details>`)
- 기존 `lastGood` fallback 유지(마지막 정상 N분 전 데이터). 카테고리 표시는 추가만.

**2) 전용 진단 패널 (`CommandLogModal` 확장)**
- 상단 요약: 카테고리별 실패 건수 칩(예: `미연결 38 · 인증만료 12 · 권한없음 9`),
  클릭 시 필터
- 행: `시각 · 명령 · 배지 · durationMs · stderr 펼침`
- "실패만 보기" 토글. 최신순 정렬(기존 유지)
- 집계는 클라이언트에서 `category`로 그룹핑(별도 API 없음)

**3) AI 채팅 (`ChatDrawer` → 서버 프롬프트)**
화면 컨텍스트 구성 시 실패 위젯이 있으면 프롬프트에 포함:
```
[위젯: cmdb-pods] 실패(category=auth_expired)
  hint: 재로그인 필요…
  stderr(절단): error: You must be logged in to the server (Unauthorized)
```
분류는 서버가 이미 했으니 AI는 해석만. stderr는 실패 위젯만·절단(프롬프트 다이어트 유지).

세 표면 모두 섹션 1의 같은 `label`/`hint`/`category`를 소비한다.

## 섹션 4 — 테스트 & 검증

서버 (`server/test/`, vitest):
- `diagnose.test.ts` (핵심): 카테고리별 대표 stderr 샘플 → 기대 category.
  **실제 로그의 진짜 stderr 샘플**을 픽스처로(kubectl Unauthorized, connection refused,
  context not found, forbidden 등). 우선순위 경계(auth vs unreachable, permission vs
  not_found) 케이스 명시.
- `runner`: 실패 시 `result.diagnosis` 채움 + `error===hint`. ENOENT·타임아웃 경로.
- `auditLog`: 실패 엔트리에 `stderr`(절단·마스킹)·`category` 기록, 성공 엔트리엔 없음.

웹 (`web/test/`, vitest):
- 분류 칩 집계/필터 로직(순수 함수로 분리해 테스트)
- 위젯 에러 블록: `diagnosis` 있으면 배지+hint 렌더, stderr 펼침

수동 검증:
- `npm run app:dev`로 위젯이 의도적으로 실패하게(잘못된 context) 세 표면 확인
- `npm test` + `npm run lint` + 워크스페이스별 `tsc --noEmit` 통과

하위호환: `AuditEntry`/`CommandResult`의 새 필드는 모두 옵션 → 기존 `commands.jsonl`·기존
위젯 무영향.
