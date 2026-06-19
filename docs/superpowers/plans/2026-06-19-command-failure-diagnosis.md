# 명령 실패 진단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** command 실패를 서버 한 곳에서 9개 카테고리로 분류하고, 그 결과를 위젯 인라인·전용 진단 패널·AI 채팅 세 표면에서 보여준다.

**Architecture:** `commands/diagnose.ts`의 순수 함수 `diagnose()`가 실패 신호(errCode·exitCode·stderr·killed)를 카테고리로 매핑한다. `runArgv`가 결과(`CommandResult.diagnosis`)와 감사 로그(`stderr`+`category`)에 부착하고, 웹·AI·패널은 분류하지 않고 소비만 한다(단일 진실원).

**Tech Stack:** TypeScript, Node `execFile`, Fastify, vitest(서버·웹), React 19 + antd 6.

설계 문서: `docs/superpowers/specs/2026-06-19-command-failure-diagnosis-design.md`

---

## File Structure

- **Create** `server/src/commands/diagnose.ts` — 분류기 + 카테고리 메타(label/hint). 외부 의존 없는 순수 함수.
- **Create** `server/test/diagnose.test.ts` — 실제 stderr 픽스처로 카테고리 매칭 검증.
- **Create** `web/src/components/commandLog.ts` — 감사 로그 실패 집계 순수 함수 + 카테고리→라벨 맵(웹 표시용).
- **Create** `web/test/commandLog.test.ts` — 집계 함수 검증.
- **Modify** `server/src/types.ts` — `DiagnosisCategory`·`Diagnosis`·`CommandResult.diagnosis` 추가.
- **Modify** `web/src/types.ts` — 위 타입 수동 동기화.
- **Modify** `server/src/commands/runner.ts` — `friendlyError` 제거, `diagnose()` 사용, `logCommand`에 stderr/category 전달.
- **Modify** `server/src/commands/auditLog.ts` — `AuditEntry`에 `stderr?`·`category?`, `redactStderr()`(절단+마스킹), `logCommand` 시그니처 확장.
- **Modify** `server/test/runner.test.ts` — `error===hint`로 바뀐 단언 갱신 + diagnosis 검증.
- **Modify** `server/test/auditLog.test.ts` — stderr/category 기록·마스킹 검증.
- **Modify** `server/src/ai/claudeCliAdapter.ts` — `recentFailures()`·`screenContext()`에 category/hint 포함.
- **Modify** `web/src/components/WidgetCard.tsx` — 에러 배너/Alert에 label 배지 + hint + stderr 펼침.
- **Modify** `web/src/components/CommandLogModal.tsx` — category 컬럼·요약 칩·"실패만" 토글·stderr 펼침.
- **Modify** `web/test/widgetCard.test.tsx` — diagnosis 렌더 검증.

---

## Task 1: 타입 추가 (서버 + 웹 동기화)

**Files:**
- Modify: `server/src/types.ts:51` (`CommandResult` 바로 위/안)
- Modify: `web/src/types.ts:43-50` (`CommandResult` — "여기까지 서버와 동일" 주석 위)

- [ ] **Step 1: 서버 타입 추가**

`server/src/types.ts`의 `CommandResult` 인터페이스 정의 바로 앞에 추가하고, `CommandResult`에 `diagnosis` 필드를 더한다.

```ts
export type DiagnosisCategory =
  | 'not_installed' | 'timeout' | 'auth_expired' | 'unreachable'
  | 'context_missing' | 'permission_denied' | 'not_found' | 'bad_usage' | 'unknown';

export interface Diagnosis {
  category: DiagnosisCategory;
  label: string; // 위젯/패널 배지 문구
  hint: string;  // 사용자 조치 안내
}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json?: unknown;
  error?: string;
  diagnosis?: Diagnosis; // 실패(ok:false) 시에만 채움
}
```

- [ ] **Step 2: 웹 타입 동기화**

`web/src/types.ts`의 `CommandResult`(43-50줄)와 그 앞에 동일하게 추가한다(서버와 자구까지 일치). "여기까지 서버와 동일(51줄)" 경계 위에 둔다.

```ts
export type DiagnosisCategory =
  | 'not_installed' | 'timeout' | 'auth_expired' | 'unreachable'
  | 'context_missing' | 'permission_denied' | 'not_found' | 'bad_usage' | 'unknown';

export interface Diagnosis {
  category: DiagnosisCategory;
  label: string;
  hint: string;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json?: unknown;
  error?: string;
  diagnosis?: Diagnosis;
}
```

- [ ] **Step 3: 타입 체크**

Run: `cd server && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: 두 워크스페이스 모두 에러 없음(아직 사용처 없으니 통과).

- [ ] **Step 4: Commit**

```bash
git add server/src/types.ts web/src/types.ts
git commit -m "기능: 명령 진단 타입(Diagnosis/DiagnosisCategory) 추가"
```

---

## Task 2: diagnose 분류기

**Files:**
- Create: `server/src/commands/diagnose.ts`
- Test: `server/test/diagnose.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`server/test/diagnose.test.ts` 생성. 실제 로그에서 나온 stderr 패턴을 픽스처로 쓴다.

```ts
import { describe, it, expect } from 'vitest';
import { diagnose } from '../src/commands/diagnose.js';

const kubectl = ['/opt/homebrew/bin/kubectl', 'get', 'pods'];

describe('diagnose', () => {
  it('ENOENT → not_installed (bin 이름 포함)', () => {
    const d = diagnose(['some-missing-bin'], { exitCode: null, stderr: '', errCode: 'ENOENT' });
    expect(d.category).toBe('not_installed');
    expect(d.hint).toContain('some-missing-bin');
  });

  it('killed → timeout', () => {
    expect(diagnose(kubectl, { exitCode: null, stderr: '', killed: true }).category).toBe('timeout');
  });

  it('Unauthorized → auth_expired', () => {
    const d = diagnose(kubectl, { exitCode: 1, stderr: 'error: You must be logged in to the server (Unauthorized)' });
    expect(d.category).toBe('auth_expired');
    expect(d.label).toBe('인증만료');
  });

  it('connection refused → unreachable', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'dial tcp 10.0.0.1:6443: connect: connection refused' }).category).toBe('unreachable');
  });

  it('x509 (만료 인증서) → unreachable', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'x509: certificate has expired' }).category).toBe('unreachable');
  });

  it('context not found → context_missing', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'error: context "ns-oss-cmdb" not found' }).category).toBe('context_missing');
  });

  it('forbidden → permission_denied (not_found보다 우선)', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'Error from server (Forbidden): pods is forbidden' }).category).toBe('permission_denied');
  });

  it('resource NotFound → not_found', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'Error from server (NotFound): deployments.apps "x" not found' }).category).toBe('not_found');
  });

  it('exit 2 → bad_usage', () => {
    expect(diagnose(kubectl, { exitCode: 2, stderr: 'unknown flag: --bogus' }).category).toBe('bad_usage');
  });

  it('정체불명 stderr → unknown', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'something weird happened' }).category).toBe('unknown');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run test/diagnose.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/diagnose.js'`

- [ ] **Step 3: diagnose.ts 구현**

`server/src/commands/diagnose.ts` 생성.

```ts
import type { Diagnosis, DiagnosisCategory } from '../types.js';

export interface DiagnoseSignals {
  exitCode: number | null;
  stderr: string;
  errCode?: string; // err.code (ENOENT 등)
  killed?: boolean; // 우리 타임아웃에 의해 종료됨
}

// 카테고리별 라벨·조치 안내. 위젯/AI가 쓰는 문구의 단일 출처.
const META: Record<DiagnosisCategory, { label: string; hint: (bin: string) => string }> = {
  not_installed: { label: '미설치', hint: (b) => `'${b}' 명령을 찾을 수 없습니다 — 설치/PATH 확인 (GUI 실행 시 PATH 누락 가능)` },
  timeout: { label: '시간초과', hint: () => '명령이 제한 시간을 초과했습니다 — 네트워크·VPN 또는 큰 출력 확인' },
  auth_expired: { label: '인증만료', hint: () => '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신' },
  unreachable: { label: '미연결', hint: () => '서버/클러스터에 도달할 수 없습니다 — VPN 연결·엔드포인트 확인' },
  context_missing: { label: '컨텍스트없음', hint: () => 'kubeconfig context를 찾을 수 없습니다 — context 이름·파일 경로 확인' },
  permission_denied: { label: '권한없음', hint: () => '해당 리소스/네임스페이스 권한이 없습니다 — 계정·역할 확인' },
  not_found: { label: '리소스없음', hint: () => '대상 리소스가 없습니다 — 이름·네임스페이스 확인' },
  bad_usage: { label: '잘못된사용', hint: () => '명령 인자가 올바르지 않습니다 — 템플릿 argv 점검' },
  unknown: { label: '실패', hint: () => '명령이 실패했습니다 — stderr 원문을 확인하세요' },
};

// 우선순위 순서대로 매칭한다. auth를 unreachable보다(만료 토큰이 TLS류 메시지 동반),
// permission을 not_found보다(403 vs 404) 먼저 본다.
function classify(s: DiagnoseSignals): DiagnosisCategory {
  if (s.errCode === 'ENOENT') return 'not_installed';
  if (s.killed) return 'timeout';
  const e = s.stderr.toLowerCase();
  if (/unauthorized|\b401\b|token.*expir|login required|must be logged in|\bauth\b/.test(e)) return 'auth_expired';
  if (/connection refused|dial tcp|i\/o timeout|no route to host|\beof\b|x509|\btls\b|couldn'?t connect|could not connect|unable to connect/.test(e)) return 'unreachable';
  if (/context .* not found|current-context|no configuration has been provided|kubeconfig/.test(e)) return 'context_missing';
  if (/forbidden|\b403\b|not allowed|cannot .* in .* namespace|\brbac\b/.test(e)) return 'permission_denied';
  if (/not found|\b404\b|notfound|no such/.test(e)) return 'not_found';
  if (s.exitCode === 2 || /unknown flag|invalid argument|usage:/.test(e)) return 'bad_usage';
  return 'unknown';
}

export function diagnose(argv: string[], s: DiagnoseSignals): Diagnosis {
  const bin = (argv[0] ?? '').split('/').pop() ?? '';
  const category = classify(s);
  return { category, label: META[category].label, hint: META[category].hint(bin) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run test/diagnose.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/commands/diagnose.ts server/test/diagnose.test.ts
git commit -m "기능: 명령 실패 원인 분류기 diagnose() (9개 카테고리)"
```

---

## Task 3: runner 통합

**Files:**
- Modify: `server/src/commands/runner.ts:1-57`
- Test: `server/test/runner.test.ts:19-48`

- [ ] **Step 1: 기존 테스트를 새 동작에 맞게 수정**

`error`가 이제 stderr 원문이 아니라 `diagnosis.hint`이므로, raw stderr를 단언하던 테스트를 갱신한다. `server/test/runner.test.ts`의 해당 테스트들을 아래로 교체한다.

```ts
  it('reports friendly error for missing binary', async () => {
    const result = await runArgv(['definitely-not-a-command-xyz']);
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.category).toBe('not_installed');
    expect(result.error).toMatch(/찾을 수 없습니다/);
  });

  it('classifies auth failure from stderr', async () => {
    const result = await runArgv(['node', '-e', 'console.error("error: You must be logged in (Unauthorized)"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.category).toBe('auth_expired');
    expect(result.error).toBe(result.diagnosis?.hint);
    expect(result.stderr).toContain('Unauthorized'); // 원문은 stderr에 보존
  });

  it('times out long-running commands', async () => {
    const result = await runArgv(['node', '-e', 'setTimeout(()=>{}, 60000)'], 500);
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.category).toBe('timeout');
    expect(result.error).toMatch(/초과/);
  }, 10_000);

  it('extracts non-zero exit code with unknown diagnosis', async () => {
    const result = await runArgv(['node', '-e', 'console.error("boom"); process.exit(5)']);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.diagnosis?.category).toBe('unknown');
    expect(result.stderr).toContain('boom');
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run test/runner.test.ts`
Expected: FAIL — `result.diagnosis` undefined (아직 미구현)

- [ ] **Step 3: runner.ts 구현**

`server/src/commands/runner.ts` 전체를 아래로 교체한다(`friendlyError` 제거, `diagnose` 사용, `logCommand`에 stderr/category 전달).

```ts
import { execFile } from 'node:child_process';
import type { CommandResult } from '../types.js';
import { logCommand } from './auditLog.js';
import { diagnose } from './diagnose.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export function runArgv(
  argv: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false, exitCode: null, stdout: '', stderr: '', error: 'argv가 비어 있습니다.',
    });
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, signal },
      (err, stdout, stderr) => {
        const result: CommandResult = {
          ok: !err,
          exitCode: err ? exitCodeOf(err) : 0,
          stdout,
          stderr,
        };
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          result.diagnosis = diagnose(argv, {
            exitCode: result.exitCode,
            stderr,
            errCode: e.code,
            killed: e.killed,
          });
          result.error = result.diagnosis.hint; // 하위호환: error = hint
        }
        try {
          result.json = JSON.parse(stdout);
        } catch {
          // JSON이 아니면 raw stdout만 사용
        }
        logCommand({
          argv,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
          stderr: err ? stderr : undefined,
          category: result.diagnosis?.category,
        });
        resolve(result);
      },
    );
  });
}

function exitCodeOf(err: Error): number | null {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'number' ? code : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run test/runner.test.ts`
Expected: PASS. (참고: `logCommand`의 새 인자는 Task 4에서 타입이 확정되므로, 이 시점엔 `auditLog.ts`가 새 필드를 무시해도 런타임은 통과한다. 만약 tsc가 막으면 Task 4를 먼저 진행한 뒤 이 단계로 돌아온다.)

- [ ] **Step 5: Commit**

```bash
git add server/src/commands/runner.ts server/test/runner.test.ts
git commit -m "기능: runArgv가 실패 시 diagnosis 부착 (friendlyError 대체)"
```

---

## Task 4: 감사 로그에 stderr·category 영속화

**Files:**
- Modify: `server/src/commands/auditLog.ts:1-46`
- Test: `server/test/auditLog.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`server/test/auditLog.test.ts`에 테스트 추가(파일 끝 `describe` 안).

```ts
  it('실패 엔트리에 stderr(마스킹·절단)와 category를 기록한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-'));
    configureAuditLog(path.join(dir, 'commands.jsonl'));
    logCommand({
      argv: ['kubectl', 'get', 'pods'], ok: false, exitCode: 1, durationMs: 5,
      stderr: 'Authorization: Bearer abc123def token=secret9 ' + 'x'.repeat(800),
      category: 'auth_expired',
    });
    logCommand({ argv: ['git', 'log'], ok: true, exitCode: 0, durationMs: 3 });
    await new Promise((r) => setTimeout(r, 50));

    const [fail, ok] = await readAuditLog();
    expect(fail.category).toBe('auth_expired');
    expect(fail.stderr!.length).toBeLessThanOrEqual(500);
    expect(fail.stderr).toContain('Bearer ***');
    expect(fail.stderr).toContain('token=***');
    expect(fail.stderr).not.toContain('secret9');
    expect(ok.stderr).toBeUndefined(); // 성공 엔트리엔 stderr 없음
    expect(ok.category).toBeUndefined();
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run test/auditLog.test.ts`
Expected: FAIL — `fail.category`/`fail.stderr` undefined

- [ ] **Step 3: auditLog.ts 구현**

`server/src/commands/auditLog.ts`에서 import·인터페이스·`logCommand`를 아래처럼 수정한다.

import 줄 위에 타입 import 추가:

```ts
import type { DiagnosisCategory } from '../types.js';
```

`AuditEntry`에 두 필드 추가:

```ts
export interface AuditEntry {
  ts: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stderr?: string;            // 실패 시에만, 마스킹·절단됨
  category?: DiagnosisCategory;
}
```

상수와 마스킹 함수 추가(`MAX_ARG_CHARS` 옆):

```ts
const MAX_STDERR_CHARS = 500;

// 토큰류 비밀값을 가리고 길이를 제한한다(로컬 앱이지만 stderr에 자격증명이 찍힐 수 있음).
export function redactStderr(stderr: string): string {
  return stderr
    .replace(/(bearer\s+)[\w.\-]+/gi, '$1***')
    .replace(/(token[=:]\s*)[\w.\-]+/gi, '$1***')
    .replace(/(password[=:]\s*)\S+/gi, '$1***')
    .slice(0, MAX_STDERR_CHARS);
}
```

`logCommand` 시그니처와 record 구성 교체:

```ts
export function logCommand(
  entry: Omit<AuditEntry, 'ts' | 'argv' | 'stderr'> & { argv: string[]; stderr?: string },
): void {
  if (!logFile) return;
  const record: AuditEntry = {
    ts: new Date().toISOString(),
    ...entry,
    argv: entry.argv.map((a) => (a.length > MAX_ARG_CHARS ? `${a.slice(0, MAX_ARG_CHARS)}…` : a)),
    stderr: entry.stderr ? redactStderr(entry.stderr) : undefined,
  };
  const file = logFile;
  writeQueue = writeQueue
    .then(() => fs.mkdir(path.dirname(file), { recursive: true }))
    .then(() => fs.appendFile(file, JSON.stringify(record) + '\n'))
    .catch(() => {});
}
```

(주: `JSON.stringify`는 `undefined` 필드를 생략하므로 성공 엔트리엔 `stderr`/`category` 키가 아예 안 들어간다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run test/auditLog.test.ts test/runner.test.ts`
Expected: PASS (양쪽 모두)

- [ ] **Step 5: 서버 전체 타입·테스트 확인**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 전체 테스트 PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/commands/auditLog.ts server/test/auditLog.test.ts
git commit -m "기능: 감사 로그에 실패 stderr(마스킹)·category 영속화"
```

---

## Task 5: AI 채팅 컨텍스트 강화

**Files:**
- Modify: `server/src/ai/claudeCliAdapter.ts:299-309` (`recentFailures`), `:323-326` (`screenContext` 내 raw 구성)
- Test: 수동(아래) — 이 두 메서드는 private이고 통합 경로가 무거워 단위 테스트 대신 타입·수동 검증.

- [ ] **Step 1: recentFailures에 category 포함**

`recentFailures()`의 `.map(...)` 줄을 교체해 카테고리를 함께 노출한다.

```ts
      const failures = (await readAuditLog(80))
        .filter((e) => !e.ok && e.argv[0] !== 'claude')
        .slice(-8)
        .map((e) => {
          const cat = e.category ? ` [${e.category}]` : '';
          return `- ${e.argv.join(' ').slice(0, 160)} (exit ${e.exitCode ?? '?'})${cat}`;
        });
```

- [ ] **Step 2: screenContext에 실패 분류 포함**

`screenContext()`에서 실패 위젯 raw를 만드는 부분(323-326줄 부근)을 교체한다.

```ts
          const raw = result.ok
            ? result.stdout || (result.json !== undefined ? JSON.stringify(result.json) : '')
            : `(조회 실패: category=${result.diagnosis?.category ?? 'unknown'} — ${result.error ?? '알 수 없는 오류'}` +
              (result.stderr ? `\n  stderr: ${result.stderr.slice(0, 300)}` : '') + ')';
          return `[위젯 "${w.title}"]\n${raw.slice(0, WIDGET_DATA_MAX_CHARS)}`;
```

- [ ] **Step 3: 타입·테스트 확인**

Run: `cd server && npx tsc --noEmit && npx vitest run test/claudeCliAdapter.test.ts`
Expected: 타입 에러 없음, 기존 테스트 PASS(시그니처 비변경).

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/claudeCliAdapter.ts
git commit -m "기능: AI 채팅 프롬프트에 실패 category·stderr 단서 포함"
```

---

## Task 6: 웹 위젯 인라인 진단 표시

**Files:**
- Modify: `web/src/components/WidgetCard.tsx:92-110`
- Test: `web/test/widgetCard.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`web/test/widgetCard.test.tsx`에 테스트 추가(기존 import/render 헬퍼 재사용). 기존 파일의 렌더 패턴을 따르되, `diagnosis`가 있는 결과에서 label 배지와 hint가 보이는지 검증한다.

```ts
  it('shows diagnosis label badge and hint when command fails with diagnosis', async () => {
    server.use(
      http.post('/api/widget-data', () =>
        HttpResponse.json({
          ok: false, exitCode: 1, stdout: '', stderr: 'Unauthorized',
          error: '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신',
          diagnosis: { category: 'auth_expired', label: '인증만료', hint: '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신' },
        }),
      ),
    );
    renderWidget({ type: 'stat' }); // 기존 헬퍼 — 파일의 기존 사용법에 맞춤
    expect(await screen.findByText('인증만료')).toBeInTheDocument();
    expect(screen.getByText(/재로그인이 필요합니다/)).toBeInTheDocument();
  });
```

> 참고: `renderWidget`/`server`(msw)/`http`/`HttpResponse` 심볼은 이 파일에 이미 존재하는 것을 사용한다. 실제 헬퍼 이름이 다르면 파일 상단의 기존 테스트와 동일한 호출로 맞춘다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run test/widgetCard.test.tsx`
Expected: FAIL — '인증만료' 텍스트를 못 찾음

- [ ] **Step 3: WidgetCard 에러 표시 구현**

`web/src/components/WidgetCard.tsx`에서 `errorBanner`(92줄)와 Alert 분기(108-110줄)를 교체한다.

`errorBanner`를 label 접두 배지 포함으로:

```tsx
  const errorBanner = result?.error && (
    <div
      title={result.stderr || result.error}
      style={{
        flexShrink: 0, fontSize: 11, color: '#fff', background: '#ff4d4f',
        borderRadius: 4, padding: '2px 8px', marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {result.diagnosis ? `${result.diagnosis.label} · ${result.error}` : result.error}
    </div>
  );
```

Alert 분기(lastGood 없을 때)를 배지+hint+stderr 펼침으로:

```tsx
    if (shown?.error && !lastGood) {
      return (
        <Alert
          type="warning"
          showIcon
          message={shown.diagnosis?.label ?? '실패'}
          description={
            <div style={{ fontSize: 12 }}>
              <div>{shown.error}</div>
              {shown.stderr && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>원문 보기</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 0', fontSize: 11 }}>
                    {shown.stderr.slice(0, 1000)}
                  </pre>
                </details>
              )}
            </div>
          }
        />
      );
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run test/widgetCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/WidgetCard.tsx web/test/widgetCard.test.tsx
git commit -m "기능: 위젯 실패 시 진단 배지·조치 안내·stderr 펼침 표시"
```

---

## Task 7: 진단 패널 집계 함수

**Files:**
- Create: `web/src/components/commandLog.ts`
- Test: `web/test/commandLog.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`web/test/commandLog.test.ts` 생성.

```ts
import { describe, it, expect } from 'vitest';
import { summarizeFailures, CATEGORY_LABELS } from '../src/components/commandLog';
import type { LogEntry } from '../src/components/commandLog';

const mk = (ok: boolean, category?: string): LogEntry => ({
  ts: '2026-06-19T00:00:00Z', argv: ['kubectl', 'get'], ok, exitCode: ok ? 0 : 1,
  durationMs: 1, category: category as LogEntry['category'],
});

describe('summarizeFailures', () => {
  it('실패 엔트리를 category별로 집계하고 건수 내림차순 정렬', () => {
    const rows = summarizeFailures([
      mk(true), mk(false, 'auth_expired'), mk(false, 'auth_expired'),
      mk(false, 'unreachable'), mk(true),
    ]);
    expect(rows).toEqual([
      { category: 'auth_expired', label: '인증만료', count: 2 },
      { category: 'unreachable', label: '미연결', count: 1 },
    ]);
  });

  it('category 없는 실패는 unknown으로 묶는다', () => {
    const rows = summarizeFailures([mk(false, undefined)]);
    expect(rows).toEqual([{ category: 'unknown', label: CATEGORY_LABELS.unknown, count: 1 }]);
  });

  it('실패가 없으면 빈 배열', () => {
    expect(summarizeFailures([mk(true), mk(true)])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run test/commandLog.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: commandLog.ts 구현**

`web/src/components/commandLog.ts` 생성.

```ts
import type { DiagnosisCategory } from '../types';

export interface LogEntry {
  ts: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stderr?: string;
  category?: DiagnosisCategory;
}

// 패널 표시용 카테고리→라벨 맵. 서버 diagnose.ts의 META.label과 수동 동기화한다.
export const CATEGORY_LABELS: Record<DiagnosisCategory, string> = {
  not_installed: '미설치',
  timeout: '시간초과',
  auth_expired: '인증만료',
  unreachable: '미연결',
  context_missing: '컨텍스트없음',
  permission_denied: '권한없음',
  not_found: '리소스없음',
  bad_usage: '잘못된사용',
  unknown: '실패',
};

export interface FailureSummary {
  category: DiagnosisCategory;
  label: string;
  count: number;
}

// 실패 엔트리를 category별로 집계해 건수 내림차순으로 반환한다.
export function summarizeFailures(entries: LogEntry[]): FailureSummary[] {
  const counts = new Map<DiagnosisCategory, number>();
  for (const e of entries) {
    if (e.ok) continue;
    const cat: DiagnosisCategory = e.category ?? 'unknown';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: CATEGORY_LABELS[category], count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run test/commandLog.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/commandLog.ts web/test/commandLog.test.ts
git commit -m "기능: 감사 로그 실패 category 집계 함수"
```

---

## Task 8: CommandLogModal 진단 패널 확장

**Files:**
- Modify: `web/src/components/CommandLogModal.tsx:1-54`

- [ ] **Step 1: CommandLogModal 교체 구현**

`web/src/components/CommandLogModal.tsx` 전체를 아래로 교체한다(로컬 `LogEntry`는 Task 7의 공용 타입을 import, category 컬럼·요약 칩·"실패만" 토글·stderr 펼침 추가).

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Modal, Table, Tag, Space, Switch, message } from 'antd';
import { api } from '../api';
import { CATEGORY_LABELS, summarizeFailures, type LogEntry } from './commandLog';

// 서버 감사 로그(commands.jsonl) 뷰어 — 어떤 명령이 언제 실행됐고 왜 실패했는지 확인용
export default function CommandLogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failOnly, setFailOnly] = useState(false);
  const [catFilter, setCatFilter] = useState<string | undefined>();

  useEffect(() => {
    api.commandLog()
      .then((rows) => setEntries((rows as LogEntry[]).reverse())) // 최신이 위로
      .catch((e) => void message.error(`실행 기록 조회 실패: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  const summary = useMemo(() => summarizeFailures(entries), [entries]);
  const shown = useMemo(
    () => entries.filter((e) =>
      (!failOnly || !e.ok) && (!catFilter || (e.category ?? 'unknown') === catFilter)),
    [entries, failOnly, catFilter],
  );

  return (
    <Modal title="명령 실행 기록 (최근 200개)" open onCancel={onClose} footer={null} width={820}>
      <Space style={{ marginBottom: 8 }} wrap>
        <span>
          <Switch size="small" checked={failOnly} onChange={setFailOnly} /> 실패만
        </span>
        {summary.map((s) => (
          <Tag
            key={s.category}
            color={catFilter === s.category ? 'red' : 'default'}
            style={{ cursor: 'pointer' }}
            onClick={() => setCatFilter(catFilter === s.category ? undefined : s.category)}
          >
            {s.label} {s.count}
          </Tag>
        ))}
      </Space>
      <Table<LogEntry>
        size="small" rowKey={(r) => r.ts + r.argv.join(' ')}
        dataSource={shown} loading={loading}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        expandable={{
          rowExpandable: (r) => !!r.stderr,
          expandedRowRender: (r) => (
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: 11 }}>
              {r.stderr}
            </pre>
          ),
        }}
        columns={[
          {
            title: '시각', dataIndex: 'ts', width: 90,
            render: (ts: string) => new Date(ts).toTimeString().slice(0, 8),
          },
          {
            title: '명령', dataIndex: 'argv',
            render: (argv: string[]) => (
              <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{argv.join(' ').slice(0, 120)}</code>
            ),
          },
          {
            title: '결과', dataIndex: 'ok', width: 110,
            render: (ok: boolean, r) =>
              ok
                ? <Tag color="green">성공</Tag>
                : <Tag color="red">{r.category ? CATEGORY_LABELS[r.category] : '실패'}</Tag>,
          },
          {
            title: '소요', dataIndex: 'durationMs', width: 80,
            render: (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`),
          },
        ]}
      />
    </Modal>
  );
}
```

- [ ] **Step 2: 타입·빌드 확인**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 없음, 웹 전체 테스트 PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CommandLogModal.tsx
git commit -m "기능: 진단 패널 — category 칩 필터·실패만 토글·stderr 펼침"
```

---

## Task 9: 전체 검증

- [ ] **Step 1: 루트 테스트·린트**

Run: `npm test && npm run lint`
Expected: 서버·웹 테스트 전부 PASS, ESLint 에러 없음

- [ ] **Step 2: 워크스페이스 타입체크**

Run: `cd server && npx tsc --noEmit && cd ../web && npx tsc --noEmit && cd ../electron && npx tsc --noEmit`
Expected: 세 워크스페이스 모두 에러 없음

- [ ] **Step 3: 수동 검증 (`npm run app:dev`)**

- 잘못된 kubeconfig context를 쓰는 위젯을 하나 두고:
  - 위젯에 `인증만료`/`미연결` 등 배지 + 조치 안내 + "원문 보기" 펼침이 보이는지
  - 명령 기록 모달에서 category 칩 집계·"실패만" 토글·행 펼침 stderr가 보이는지
  - 채팅에 "이 위젯 왜 비어 있어?" 물었을 때 AI가 category 근거로 답하는지
- 정상 위젯/명령은 기존과 동일하게 동작하는지(성공 엔트리에 stderr 없음).

- [ ] **Step 4: 설계 문서 상태 갱신 후 커밋**

`docs/superpowers/specs/2026-06-19-command-failure-diagnosis-design.md`의 상태를 "구현 완료"로 바꾸고:

```bash
git add docs/superpowers/specs/2026-06-19-command-failure-diagnosis-design.md
git commit -m "문서: 명령 실패 진단 구현 완료 표시"
```

---

## Self-Review 메모

- **Spec 커버리지**: 섹션1(분류체계)→Task 2 / 섹션2(데이터모델·흐름)→Task 1·3·4 / 섹션3(3표면: 위젯·패널·AI)→Task 6·8·5 / 섹션4(테스트)→각 Task의 TDD + Task 9. 누락 없음.
- **타입 일관성**: `Diagnosis{category,label,hint}`·`DiagnosisCategory` 9종이 server/web 양쪽 동일. `LogEntry`는 web 공용(Task 7) → CommandLogModal(Task 8) 재사용. `logCommand` 새 인자(`stderr?`,`category?`)는 runner(Task 3) 호출과 auditLog(Task 4) 정의 일치.
- **하위호환**: 새 필드 전부 옵션. 기존 `commands.jsonl`·기존 위젯 무영향.
- **드리프트 주의**: 카테고리 라벨이 server `diagnose.ts`(META.label)와 web `commandLog.ts`(CATEGORY_LABELS) 두 곳 — types.ts와 같은 "수동 동기화" 대상. 카테고리 추가 시 양쪽 + 두 types.ts 모두 갱신.
