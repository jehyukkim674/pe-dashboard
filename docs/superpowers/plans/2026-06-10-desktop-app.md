# PE Dashboard 데스크톱 앱 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PE Dashboard를 Electron 데스크톱 앱(웹뷰 내장)으로 실행하고, AI 백엔드를 Claude CLI 단발 호출(작업 JSON 포맷)로 교체하며, DataMigration UX와 동일한 자동 업데이트(진행률 0→100% 후 재시작)를 추가한다.

**Architecture:** 서버 부트를 `startServer()` 모듈로 분리해 Electron 메인 프로세스가 같은 프로세스에서 Fastify를 기동(프로덕션은 web/dist 정적 서빙). AI는 `ChatAdapter` 인터페이스 뒤로 분리 — 기본 `ClaudeCliAdapter`(claude -p --output-format json → 작업 JSON 파싱 → 기존 도구 핸들러로 적용), 기존 API 방식은 `CHAT_ADAPTER=api`로 보존. 업데이트는 electron-updater + GitHub Releases, IPC로 웹 UpdateModal에 진행률 전달.

**Tech Stack:** Electron 33, electron-updater, electron-builder, esbuild(번들), @fastify/static / 기존: Fastify, Vitest, React+AntD

**Spec:** `docs/superpowers/specs/2026-06-10-desktop-app-design.md`

---

## 파일 구조

```
pe-dashboard/
├── electron/                      # 새 워크스페이스 "desktop"
│   ├── package.json               # electron/updater/builder/esbuild
│   ├── tsconfig.json              # typecheck 전용 (빌드는 esbuild)
│   ├── build.mjs                  # esbuild: main.ts+preload.ts → dist/*.cjs (서버 코드 포함 번들)
│   ├── electron-builder.yml       # mac zip+dmg, extraResources(web/dist), GitHub publish
│   └── src/
│       ├── main.ts                # BrowserWindow + 내장 서버 기동 + updater IPC
│       ├── preload.ts             # contextBridge: window.appUpdater
│       └── updater.ts             # electron-updater 래퍼 (DataMigration 상태 모델)
├── server/src/
│   ├── ai/
│   │   ├── adapter.ts             # ChatAdapter 인터페이스 + ChatEvent (이동)
│   │   ├── describe.ts            # describeToolCall (chatService에서 이동)
│   │   ├── operations.ts          # Operation 타입 + applyOperations ($last, 부분실패 허용)
│   │   ├── claudeCliAdapter.ts    # claude CLI 단발 호출 + extractJson
│   │   ├── chatService.ts         # (수정) ChatAdapter 구현, describe/adapter import
│   │   └── tools.ts               # 변경 없음
│   ├── start.ts                   # startServer(): DI 조립 + 정적 서빙 + 포트 폴백
│   ├── index.ts                   # (수정) startServer 호출로 단순화
│   ├── app.ts                     # (수정) AppDeps.chatService: ChatAdapter
│   └── routes/chat.ts             # (수정) adapter import
└── web/src/
    ├── electron.d.ts              # window.appUpdater 타입
    ├── components/UpdateModal.tsx # 업데이트 모달 (진행률 0→100%)
    └── App.tsx                    # (수정) UpdateModal 마운트 + 업데이트 확인 버튼
```

---

### Task 1: Operation 타입 + OpApplier (TDD)

**Files:**
- Create: `server/src/ai/operations.ts`, `server/src/ai/describe.ts`
- Modify: `server/src/ai/chatService.ts` (describeToolCall 이동분 제거·import)
- Test: `server/test/operations.test.ts`

- [ ] **Step 1: describeToolCall를 별도 모듈로 이동**

`server/src/ai/describe.ts` 생성 — 기존 `chatService.ts` 하단의 `describeToolCall` 함수를 그대로 옮긴다:

```ts
// 도구 호출을 채팅 액션 칩에 표시할 한국어 한 줄 요약으로 변환한다.
export function describeToolCall(name: string, input: unknown): string {
  const i = input as Record<string, any>;
  switch (name) {
    case 'create_dashboard': return `대시보드 '${i.name}' 생성`;
    case 'delete_dashboard': return `대시보드 삭제 (${i.id})`;
    case 'add_widget': return `위젯 '${i.widget?.title}' 추가`;
    case 'update_widget': return `위젯 수정 (${i.widgetId})`;
    case 'remove_widget': return `위젯 삭제 (${i.widgetId})`;
    case 'register_command': return `명령 '${i.id}' 등록 요청`;
    case 'run_command_preview': return `명령 미리 실행 (${i.commandId})`;
    default: return name;
  }
}
```

(현재 chatService.ts의 함수 본문이 다르면 — 예: 타입이 `Record<string, unknown>` — 현재 본문을 그대로 옮긴다. 이동 후 chatService.ts에서 함수 정의를 지우고 `import { describeToolCall } from './describe.js';` 추가. 호출부 이름이 `describeToolCall`인지 확인.)

Run: `npm test -w server` — 기존 49개 전후 테스트 전부 PASS 유지 확인 (개수가 다르면 전부 PASS인지만 확인).

- [ ] **Step 2: 실패하는 테스트 작성**

`server/test/operations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools, type ToolKit } from '../src/ai/tools.js';
import { applyOperations, type Operation } from '../src/ai/operations.js';
import type { ChatEvent } from '../src/ai/adapter.js';

describe('applyOperations', () => {
  let toolkit: ToolKit;
  let store: DashboardStore;
  let pending: PendingCommands;
  let events: ChatEvent[];
  const emit = (e: ChatEvent) => events.push(e);

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ops-'));
    store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    pending = new PendingCommands();
    toolkit = buildTools({ store, commands, pending });
    events = [];
  });

  it('applies create_dashboard then add_widget with $last alias', async () => {
    const ops: Operation[] = [
      { op: 'create_dashboard', name: '배포' },
      {
        op: 'add_widget',
        dashboardId: '$last',
        widget: {
          type: 'stat', title: '실패 수', layout: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
        },
      },
    ];
    await applyOperations(ops, toolkit, emit);

    const dashboards = await store.list();
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].widgets).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
  });

  it('continues after a failing operation', async () => {
    const ops: Operation[] = [
      { op: 'delete_dashboard', id: 'no-such' },
      { op: 'create_dashboard', name: '생존' },
    ];
    await applyOperations(ops, toolkit, emit);

    expect((await store.list()).map((d) => d.name)).toEqual(['생존']);
    expect(events.some((e) => e.type === 'error' && e.message.includes('delete_dashboard'))).toBe(true);
    expect(events.some((e) => e.type === 'tool')).toBe(true);
  });

  it('register_command queues pending and emits confirm_request', async () => {
    const ops: Operation[] = [
      { op: 'register_command', id: 'k_ctx', description: 'ctx', argv: ['kubectl', 'config', 'current-context'], params: [] },
    ];
    await applyOperations(ops, toolkit, emit);

    const confirm = events.find((e) => e.type === 'confirm_request');
    expect(confirm).toBeDefined();
    expect(pending.peek((confirm as { pendingId: string }).pendingId)?.id).toBe('k_ctx');
  });

  it('emits error for unknown op without crashing', async () => {
    await applyOperations([{ op: 'format_disk' } as never], toolkit, emit);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
```

이 시점엔 `adapter.ts`가 없으므로 import 에러가 난다 — Step 3에서 함께 만든다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -w server -- operations`
Expected: FAIL — 모듈 없음 (`operations.js` / `adapter.js`)

- [ ] **Step 4: adapter.ts + operations.ts 구현**

`server/src/ai/adapter.ts` — ChatEvent를 chatService에서 이곳으로 이동:

```ts
import type { CommandTemplate } from '../types.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate }
  | { type: 'error'; message: string };

// AI 백엔드 추상화: CLI 어댑터(기본)와 API 어댑터(ChatService)가 구현한다.
export interface ChatAdapter {
  chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void>;
}
```

`server/src/ai/chatService.ts` 수정:
- 기존 `export type ChatEvent = ...` 정의 삭제 → `import type { ChatAdapter, ChatEvent } from './adapter.js';` 와 `export type { ChatEvent } from './adapter.js';` (기존 테스트/라우트 호환 재수출)
- `export class ChatService` → `export class ChatService implements ChatAdapter`

`server/src/ai/operations.ts`:

```ts
import type { ToolKit } from './tools.js';
import type { ChatEvent } from './adapter.js';
import type { CommandTemplate, Widget } from '../types.js';
import { describeToolCall } from './describe.js';

export type Operation =
  | { op: 'create_dashboard'; name: string }
  | { op: 'delete_dashboard'; id: string }
  | { op: 'add_widget'; dashboardId: string; widget: Omit<Widget, 'id'> }
  | { op: 'update_widget'; dashboardId: string; widgetId: string; patch: Partial<Widget> }
  | { op: 'remove_widget'; dashboardId: string; widgetId: string }
  | { op: 'register_command'; id: string; description: string; argv: string[]; params: string[] };

// 같은 응답 안에서 '방금 만든 대시보드'를 참조하는 별칭
const LAST_DASHBOARD = '$last';

// 작업 목록을 기존 AI 도구 핸들러로 순차 적용한다. 한 작업이 실패해도 나머지는 계속.
export async function applyOperations(
  operations: Operation[],
  toolkit: ToolKit,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  let lastDashboardId: string | undefined;

  for (const operation of operations) {
    const call = toToolCall(operation, lastDashboardId);
    const handler = call && toolkit.handlers[call.name];
    if (!call || !handler) {
      emit({ type: 'error', message: `알 수 없는 작업: ${String((operation as { op?: string }).op)}` });
      continue;
    }
    try {
      const output = await handler(call.input);
      emit({ type: 'tool', name: call.name, summary: describeToolCall(call.name, call.input) });
      if (operation.op === 'create_dashboard') {
        lastDashboardId = (output as { id: string }).id;
      }
      if (operation.op === 'register_command') {
        const { pendingId, command } = output as { pendingId: string; command: CommandTemplate };
        emit({ type: 'confirm_request', pendingId, command });
      }
    } catch (e) {
      emit({ type: 'error', message: `작업 실패 (${operation.op}): ${(e as Error).message}` });
    }
  }
}

function toToolCall(
  operation: Operation,
  lastDashboardId?: string,
): { name: string; input: unknown } | undefined {
  const resolve = (id: string): string =>
    id === LAST_DASHBOARD && lastDashboardId ? lastDashboardId : id;

  switch (operation.op) {
    case 'create_dashboard':
      return { name: 'create_dashboard', input: { name: operation.name } };
    case 'delete_dashboard':
      return { name: 'delete_dashboard', input: { id: resolve(operation.id) } };
    case 'add_widget':
      return {
        name: 'add_widget',
        input: { dashboardId: resolve(operation.dashboardId), widget: operation.widget },
      };
    case 'update_widget':
      return {
        name: 'update_widget',
        input: {
          dashboardId: resolve(operation.dashboardId),
          widgetId: operation.widgetId,
          patch: operation.patch,
        },
      };
    case 'remove_widget':
      return {
        name: 'remove_widget',
        input: { dashboardId: resolve(operation.dashboardId), widgetId: operation.widgetId },
      };
    case 'register_command': {
      const { op: _op, ...template } = operation;
      return { name: 'register_command', input: template };
    }
    default:
      return undefined;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -w server && npm run typecheck -w server && npm run lint`
Expected: 전체 PASS (기존 + 신규 4), lint 0 errors. `routes/chat.ts`가 ChatEvent를 chatService에서 import 중이면 재수출로 그대로 동작.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai server/test/operations.test.ts
git commit -m "feat: 작업 JSON 적용기 및 ChatAdapter 인터페이스 분리"
```

---

### Task 2: ClaudeCliAdapter (TDD)

**Files:**
- Create: `server/src/ai/claudeCliAdapter.ts`
- Test: `server/test/claudeCliAdapter.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/claudeCliAdapter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools } from '../src/ai/tools.js';
import { ClaudeCliAdapter, extractJson } from '../src/ai/claudeCliAdapter.js';
import type { ChatEvent } from '../src/ai/adapter.js';
import type { CommandResult } from '../src/types.js';

function cliResult(over: Partial<CommandResult>): CommandResult {
  return { ok: true, exitCode: 0, stdout: '', stderr: '', ...over };
}

// claude -p --output-format json 의 정상 출력 형태: {"result":"<텍스트>", ...}
function envelope(text: string): CommandResult {
  const stdout = JSON.stringify({ type: 'result', result: text });
  return cliResult({ stdout, json: JSON.parse(stdout) });
}

async function makeAdapter(results: CommandResult[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  const toolkit = buildTools({ store, commands, pending: new PendingCommands() });
  const calls: string[][] = [];
  const exec = async (argv: string[]) => {
    calls.push(argv);
    return results.shift() ?? cliResult({});
  };
  return { adapter: new ClaudeCliAdapter({ store, commands, toolkit, exec }), store, calls };
}

function collect() {
  const events: ChatEvent[] = [];
  return { events, emit: (e: ChatEvent) => events.push(e) };
}

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"reply":"안녕","operations":[]}').reply).toBe('안녕');
  });
  it('parses fenced JSON', () => {
    expect(extractJson('설명\n```json\n{"reply":"ok","operations":[]}\n```').reply).toBe('ok');
  });
  it('throws when no JSON object found', () => {
    expect(() => extractJson('그냥 텍스트')).toThrow(/JSON/);
  });
});

describe('ClaudeCliAdapter', () => {
  it('invokes claude CLI with -p and --output-format json', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"네","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '안녕', emit);
    expect(calls[0][0]).toBe('claude');
    expect(calls[0]).toContain('-p');
    expect(calls[0]).toContain('--output-format');
    expect(calls[0]).toContain('json');
  });

  it('emits reply text and applies operations', async () => {
    const { adapter, store } = await makeAdapter([
      envelope('{"reply":"만들었습니다","operations":[{"op":"create_dashboard","name":"배포"}]}'),
    ]);
    const { events, emit } = collect();
    await adapter.chat('s1', '배포 대시보드 만들어줘', emit);

    expect(events[0]).toEqual({ type: 'text', text: '만들었습니다' });
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    expect((await store.list()).map((d) => d.name)).toEqual(['배포']);
  });

  it('emits friendly error when claude binary is missing', async () => {
    const { adapter } = await makeAdapter([
      cliResult({ ok: false, exitCode: null, error: "'claude' 명령을 찾을 수 없습니다. 설치 및 PATH를 확인하세요." }),
    ]);
    const { events, emit } = collect();
    await adapter.chat('s1', '테스트', emit);
    const error = events.find((e) => e.type === 'error');
    expect(error && error.message).toMatch(/Claude Code/);
  });

  it('emits parse error with original snippet for non-JSON reply', async () => {
    const { adapter } = await makeAdapter([envelope('미안하지만 JSON이 아니야')]);
    const { events, emit } = collect();
    await adapter.chat('s1', '테스트', emit);
    const error = events.find((e) => e.type === 'error');
    expect(error && error.message).toMatch(/파싱 실패/);
  });

  it('includes recent history in the next prompt', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"첫 답","operations":[]}'),
      envelope('{"reply":"둘째 답","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '첫 질문', emit);
    await adapter.chat('s1', '둘째 질문', emit);

    const secondPrompt = calls[1][calls[1].indexOf('-p') + 1];
    expect(secondPrompt).toContain('첫 질문');
    expect(secondPrompt).toContain('첫 답');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- claudeCliAdapter`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: ClaudeCliAdapter 구현**

`server/src/ai/claudeCliAdapter.ts`:

```ts
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandResult } from '../types.js';
import { runArgv } from '../commands/runner.js';
import type { ToolKit } from './tools.js';
import type { ChatAdapter, ChatEvent } from './adapter.js';
import { applyOperations, type Operation } from './operations.js';

const CLI_TIMEOUT_MS = 120_000;
const MAX_HISTORY_TURNS = 10;

type Exec = (argv: string[], timeoutMs?: number) => Promise<CommandResult>;

interface Deps {
  store: DashboardStore;
  commands: CommandRegistry;
  toolkit: ToolKit;
  exec?: Exec; // 테스트 주입용. 기본 runArgv
}

interface Turn {
  user: string;
  reply: string;
}

// Claude를 API 대신 로컬 claude CLI(Claude Code 로그인 사용)로 호출하는 어댑터.
// 채팅 1회 = `claude -p <프롬프트> --output-format json` 1회. 멀티턴은 요약 히스토리로 근사.
export class ClaudeCliAdapter implements ChatAdapter {
  private readonly history = new Map<string, Turn[]>();
  private readonly exec: Exec;

  constructor(private readonly deps: Deps) {
    this.exec = deps.exec ?? runArgv;
  }

  async chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void> {
    const prompt = await this.buildPrompt(sessionId, userMessage);
    const result = await this.exec(['claude', '-p', prompt, '--output-format', 'json'], CLI_TIMEOUT_MS);

    if (!result.ok) {
      const base = result.error ?? 'claude CLI 실행에 실패했습니다';
      const hint = base.includes('찾을 수 없습니다')
        ? ' Claude Code CLI 설치가 필요합니다 (https://claude.com/claude-code).'
        : '';
      emit({ type: 'error', message: base + hint });
      return;
    }

    const envelopeText = (result.json as { result?: string } | undefined)?.result ?? result.stdout;
    let parsed: { reply?: string; operations?: Operation[] };
    try {
      parsed = extractJson(envelopeText);
    } catch (e) {
      emit({
        type: 'error',
        message: `응답 파싱 실패: ${(e as Error).message} — 원문: ${envelopeText.slice(0, 200)}`,
      });
      return;
    }

    if (parsed.reply) emit({ type: 'text', text: parsed.reply });
    await applyOperations(parsed.operations ?? [], this.deps.toolkit, emit);
    this.remember(sessionId, userMessage, parsed.reply ?? '');
  }

  private remember(sessionId: string, user: string, reply: string): void {
    const turns = this.history.get(sessionId) ?? [];
    turns.push({ user, reply });
    while (turns.length > MAX_HISTORY_TURNS) turns.shift();
    this.history.set(sessionId, turns);
  }

  private async buildPrompt(sessionId: string, userMessage: string): Promise<string> {
    const dashboards = await this.deps.store.list();
    const commands = this.deps.commands.list();
    const turns = this.history.get(sessionId) ?? [];
    const historyText = turns
      .map((t) => `사용자: ${t.user}\n어시스턴트: ${t.reply}`)
      .join('\n');

    return [
      '너는 PE Dashboard 어시스턴트다. 아래 작업 JSON 포맷 "하나만" 출력한다. 설명이나 다른 텍스트를 덧붙이지 마라.',
      '',
      '출력 포맷:',
      '{"reply":"사용자에게 보여줄 한국어 답변","operations":[',
      '  {"op":"create_dashboard","name":"이름"},',
      '  {"op":"delete_dashboard","id":"대시보드ID"},',
      '  {"op":"add_widget","dashboardId":"대시보드ID 또는 $last","widget":{"type":"stat|table|chart|log|text","title":"제목","layout":{"x":0,"y":0,"w":3,"h":2},"dataSource":{"kind":"cli","commandId":"명령ID","params":{},"refreshSec":30},"display":{}}},',
      '  {"op":"update_widget","dashboardId":"...","widgetId":"...","patch":{}},',
      '  {"op":"remove_widget","dashboardId":"...","widgetId":"..."},',
      '  {"op":"register_command","id":"...","description":"...","argv":["cmd","{param}"],"params":["param"]}',
      ']}',
      '',
      '규칙:',
      '- 그리드는 12컬럼, layout h 1칸 = 60px. 권장: stat w3 h2, table/chart w6 h5, log w6 h5, text w4 h3.',
      '- display 옵션: stat={"metric":"count"|"path","path":"a.b.c","suffix":""}, table={"columns":[...]}, chart={"xKey":"","yKey":"","chartType":"line"|"bar"}, text={"content":""}.',
      '- dataSource.commandId는 아래 "사용 가능한 명령 템플릿"에 있는 것만 쓴다.',
      '- 같은 응답에서 방금 만든 대시보드에 위젯을 추가할 때 dashboardId에 "$last"를 쓴다.',
      '- 필요한 명령 템플릿이 없으면 register_command를 사용한다 (사용자 승인이 필요함을 reply에 언급).',
      '- 조회/질문만 있고 변경이 필요 없으면 operations를 빈 배열로 두고 reply로만 답한다.',
      '',
      `현재 대시보드 상태: ${JSON.stringify(dashboards)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
      historyText ? `이전 대화:\n${historyText}` : '',
      `사용자 요청: ${userMessage}`,
    ].filter((line) => line !== '').join('\n');
  }
}

// 코드펜스(```json ... ```)나 앞뒤 잡설이 섞여 있어도 첫 '{'~마지막 '}' 구간을 파싱한다.
export function extractJson(text: string): { reply?: string; operations?: Operation[] } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON 객체를 찾지 못했습니다');
  return JSON.parse(candidate.slice(start, end + 1)) as { reply?: string; operations?: Operation[] };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server && npm run typecheck -w server && npm run lint`
Expected: 전체 PASS (신규 8), 0 lint errors

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/claudeCliAdapter.ts server/test/claudeCliAdapter.test.ts
git commit -m "feat: Claude CLI 어댑터 (작업 JSON 포맷, 히스토리 근사, 친절한 에러)"
```

---

### Task 3: startServer 모듈 + 어댑터 배선 (TDD)

**Files:**
- Create: `server/src/start.ts`
- Modify: `server/src/app.ts`, `server/src/routes/chat.ts`, `server/src/index.ts`, `server/package.json` (@fastify/static 추가)
- Test: `server/test/start.test.ts`

- [ ] **Step 1: @fastify/static 설치**

Run: `npm install -w server @fastify/static`

- [ ] **Step 2: 실패하는 테스트 작성**

`server/test/start.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startServer } from '../src/start.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'start-'));
}

describe('startServer', () => {
  it('serves the API on the chosen port', async () => {
    const { app, port } = await startServer({ dataDir: await tmp(), preferredPort: 0 });
    apps.push(app);
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/commands`);
    expect(res.status).toBe(200);
  });

  it('falls back to a free port when preferred port is taken', async () => {
    const first = await startServer({ dataDir: await tmp(), preferredPort: 0 });
    apps.push(first.app);
    const second = await startServer({ dataDir: await tmp(), preferredPort: first.port });
    apps.push(second.app);
    expect(second.port).not.toBe(first.port);
  });

  it('serves static SPA with index.html fallback when staticDir given', async () => {
    const staticDir = await tmp();
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<html><body>PE</body></html>');

    const { app, port } = await startServer({ dataDir: await tmp(), preferredPort: 0, staticDir });
    apps.push(app);

    const root = await fetch(`http://127.0.0.1:${port}/`);
    expect(await root.text()).toContain('PE');
    const deep = await fetch(`http://127.0.0.1:${port}/some/spa/route`);
    expect(await deep.text()).toContain('PE'); // SPA 폴백
    const api = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(api.status).toBe(404); // API는 폴백 제외
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -w server -- start`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: start.ts 구현 + 배선 수정**

`server/src/start.ts`:

```ts
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { DashboardStore } from './dashboardStore.js';
import { CommandRegistry } from './commands/registry.js';
import { PendingCommands } from './commands/pending.js';
import { DataSourceRegistry } from './datasources/registry.js';
import { CliSource } from './datasources/cliSource.js';
import { buildTools } from './ai/tools.js';
import { ChatService } from './ai/chatService.js';
import { ClaudeCliAdapter } from './ai/claudeCliAdapter.js';
import type { ChatAdapter } from './ai/adapter.js';

export interface StartOptions {
  dataDir: string;
  preferredPort?: number; // 기본 5174. 사용 중이면 빈 포트로 폴백. 0이면 임의 포트
  staticDir?: string;     // 지정 시 web/dist 정적 서빙 (Electron 프로덕션)
}

// CLI(index.ts)와 Electron 메인 프로세스가 공유하는 서버 부트스트랩.
export async function startServer(
  opts: StartOptions,
): Promise<{ app: FastifyInstance; port: number }> {
  const store = new DashboardStore(path.join(opts.dataDir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(opts.dataDir, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();

  const dataSources = new DataSourceRegistry();
  dataSources.register(new CliSource(commands));

  const tools = buildTools({ store, commands, pending });

  // 기본은 claude CLI. CHAT_ADAPTER=api + ANTHROPIC_API_KEY 설정 시 기존 API 모드.
  const chatService: ChatAdapter =
    process.env.CHAT_ADAPTER === 'api'
      ? new ChatService({ client: new Anthropic(), tools, store, commands })
      : new ClaudeCliAdapter({ store, commands, toolkit: tools });

  const app = await buildApp({ store, commands, pending, dataSources, chatService });

  if (opts.staticDir) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html'); // SPA 폴백
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  const port = await listenWithFallback(app, opts.preferredPort ?? 5174);
  return { app, port };
}

async function listenWithFallback(app: FastifyInstance, preferred: number): Promise<number> {
  const actualPort = (): number => {
    const address = app.server.address();
    return typeof address === 'object' && address ? address.port : preferred;
  };
  try {
    await app.listen({ port: preferred, host: '127.0.0.1' });
    return actualPort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    await app.listen({ port: 0, host: '127.0.0.1' });
    return actualPort();
  }
}
```

`server/src/app.ts` 수정 — chatService 타입을 인터페이스로:

```ts
// import 교체
import type { ChatAdapter } from './ai/adapter.js';
// (기존 `import type { ChatService } from './ai/chatService.js';` 삭제)

export interface AppDeps {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
  dataSources: DataSourceRegistry;
  chatService: ChatAdapter;
}
```

`server/src/routes/chat.ts` 수정 — import만 교체:

```ts
import type { ChatAdapter, ChatEvent } from '../ai/adapter.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatAdapter): void {
  // ... 본문 변경 없음
}
```

`server/src/index.ts` 전체 교체:

```ts
import 'dotenv/config';
import path from 'node:path';
import { startServer } from './start.js';

const DATA_DIR = path.resolve(process.cwd(), '../data');

async function main(): Promise<void> {
  const { app, port } = await startServer({ dataDir: DATA_DIR, preferredPort: 5174 });
  console.log(`PE Dashboard server: http://localhost:${port}`);
  console.log(`Data directory: ${DATA_DIR}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app.close().finally(() => process.exit(0));
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

만약 listen 실패 후 같은 인스턴스 재-listen이 Fastify에서 거부되면(에러 "already listening" 등), `listenWithFallback`를 "net 모듈로 선점검 후 listen" 방식으로 바꾼다:

```ts
import net from 'node:net';

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}
// preferred가 사용 중이면 0으로 listen
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -w server && npm run typecheck -w server && npm run lint`
Expected: 전체 PASS (신규 3 포함), 0 errors. 기존 routes/chatService 테스트도 그대로 통과.

- [ ] **Step 6: 수동 스모크**

`cd server && npx tsx src/index.ts` (백그라운드) → `curl -s localhost:5174/api/commands | head -c 100` 정상 → 종료.

- [ ] **Step 7: Commit**

```bash
git add server/src server/package.json package-lock.json server/test/start.test.ts
git commit -m "feat: startServer 부트스트랩 분리 (정적 서빙, 포트 폴백, CLI 어댑터 기본)"
```

---

### Task 4: Electron 워크스페이스 (메인/프리로드/빌드)

**Files:**
- Create: `electron/package.json`, `electron/tsconfig.json`, `electron/build.mjs`, `electron/src/main.ts`, `electron/src/preload.ts`, `electron/electron-builder.yml`
- Modify: 루트 `package.json` (workspaces·scripts), `eslint.config.js`, `.gitignore`

- [ ] **Step 1: electron 패키지 생성**

`electron/package.json`:

```json
{
  "name": "desktop",
  "private": true,
  "version": "0.1.0",
  "description": "PE Dashboard desktop app",
  "main": "dist/main.cjs",
  "scripts": {
    "dev": "node build.mjs && ELECTRON_START_URL=http://localhost:5173 electron .",
    "build:bundle": "node build.mjs",
    "dist": "node build.mjs && electron-builder",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.0",
    "electron-updater": "^6.3.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0"
  }
}
```

`electron/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`electron/build.mjs` — 서버 코드까지 한 덩어리로 번들(외부 의존성은 electron만):

```js
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
```

- [ ] **Step 2: main.ts / preload.ts 작성**

`electron/src/main.ts`:

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { startServer } from '../../server/src/start.js';
import { checkUpdateStatus, startInstall } from './updater.js';

let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 720,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    // 개발 모드: 서버·Vite는 별도 프로세스(npm run app:dev)로 이미 떠 있다
    await win.loadURL(devUrl);
    return;
  }

  // 프로덕션: 같은 프로세스에서 Fastify 기동, web/dist는 extraResources로 동봉
  const { port } = await startServer({
    dataDir: path.join(app.getPath('userData'), 'data'),
    staticDir: path.join(process.resourcesPath, 'web'),
    preferredPort: 5174,
  });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  ipcMain.handle('updater:check', () => checkUpdateStatus());
  ipcMain.handle('updater:install', () => (win ? startInstall(win) : undefined));
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
```

(이 시점엔 `updater.ts`가 없으므로 임시 스텁 `electron/src/updater.ts`를 만든다 — Task 5에서 본 구현으로 교체:)

```ts
import type { BrowserWindow } from 'electron';

export type UpdateCheck =
  | { kind: 'available'; currentVersion: string; version: string; notes: string }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

export async function checkUpdateStatus(): Promise<UpdateCheck> {
  return { kind: 'error', message: '업데이터 미구현 (Task 5)' };
}

export async function startInstall(_win: BrowserWindow): Promise<void> {}
```

`electron/src/preload.ts`:

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('appUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  onProgress: (cb: (percent: number) => void) => {
    const listener = (_e: IpcRendererEvent, percent: number) => cb(percent);
    ipcRenderer.on('updater:progress', listener);
    return () => ipcRenderer.removeListener('updater:progress', listener);
  },
});
```

- [ ] **Step 3: electron-builder.yml 작성**

`electron/electron-builder.yml`:

```yaml
appId: com.gimjaehyeog.pe-dashboard
productName: PE Dashboard
directories:
  output: release
files:
  - dist/**
  - package.json
extraResources:
  - from: ../web/dist
    to: web
mac:
  category: public.app-category.developer-tools
  target:
    - target: zip      # 자동 업데이트용 (필수)
      arch: [arm64]
    - target: dmg
      arch: [arm64]
publish:
  provider: github
  owner: jehyukkim674
  repo: pe-dashboard
```

- [ ] **Step 4: 루트 설정 갱신**

루트 `package.json`: workspaces에 `"electron"` 추가, scripts에 추가:

```json
"scripts": {
  "dev": "npm run dev -w server & npm run dev -w web & wait",
  "app:dev": "concurrently -k \"npm run dev -w server\" \"npm run dev -w web\" \"wait-on tcp:127.0.0.1:5173 && npm run dev -w desktop\"",
  "app:build": "npm run build -w web && npm run dist -w desktop",
  "test": "npm test -w server",
  "lint": "eslint ."
}
```

Run: `npm install -D concurrently wait-on` (루트), 그 후 `npm install` (electron 워크스페이스 의존성 설치 — electron 바이너리 다운로드로 1~2분 소요).

`eslint.config.js`: server 블록의 `files`를 `['server/**/*.ts', 'electron/**/*.ts']`로 확장, ignores에 `'electron/dist/**', 'electron/release/**'` 추가.

`.gitignore`에 추가:

```
electron/dist/
electron/release/
```

- [ ] **Step 5: 번들·타입체크 확인**

Run: `npm run build:bundle -w desktop`
Expected: `electron/dist/main.cjs`, `dist/preload.cjs` 생성, esbuild 에러 없음 (서버 코드 + fastify + @anthropic-ai/sdk가 번들에 포함됨)

Run: `npm run typecheck -w desktop && npm run lint`
Expected: PASS / 0 errors

esbuild가 `../../server/src/start.js` (실제 파일 start.ts) 해석에 실패하면: esbuild는 TS 스타일 `.js`→`.ts` 해석을 지원하므라 보통 통과한다. 실패 시 import를 `'../../server/src/start.ts'`로 바꾸고 tsconfig에 `"allowImportingTsExtensions": true`를 추가한다.

- [ ] **Step 6: app:dev 수동 검증**

Run: `npm run app:dev` (백그라운드, 30초 대기)
Expected: Electron 창이 뜨고 PE Dashboard UI 표시 (5173 로드). 확인 방법: `osascript -e 'tell application "System Events" to get name of every process whose name contains "Electron"'` 또는 스크린샷. 사이드바·대시보드가 보이면 성공. 종료(프로세스 kill).

- [ ] **Step 7: Commit**

```bash
git add electron package.json package-lock.json eslint.config.js .gitignore
git commit -m "feat: Electron 데스크톱 셸 (내장 서버, 개발 모드, esbuild 번들)"
```

---

### Task 5: 자동 업데이터 (메인 프로세스)

**Files:**
- Modify: `electron/src/updater.ts` (스텁 → 본 구현)

- [ ] **Step 1: updater.ts 본 구현**

전체 교체 — DataMigration `src/core/updater.ts`의 상태 모델·진행률 UX를 electron-updater로 재현:

```ts
import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
autoUpdater.autoDownload = false; // 사용자가 [업데이트]를 눌러야 다운로드

export type UpdateCheck =
  | { kind: 'available'; currentVersion: string; version: string; notes: string }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

// 수동/자동 체크 공용. 피드(GitHub Releases) 미설정·네트워크 오류는 kind:'error'로 수렴.
export async function checkUpdateStatus(): Promise<UpdateCheck> {
  const currentVersion = app.getVersion();
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (!info || info.version === currentVersion) {
      return { kind: 'latest', currentVersion };
    }
    return { kind: 'available', currentVersion, version: info.version, notes: flattenNotes(info.releaseNotes) };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}

// 다운로드 진행률 0~99% 송출, 완료 시 100% 표시 후 재시작 (DataMigration UX 동일)
export async function startInstall(win: BrowserWindow): Promise<void> {
  const send = (percent: number) => win.webContents.send('updater:progress', percent);
  autoUpdater.on('download-progress', (p) => send(Math.min(99, Math.round(p.percent))));
  autoUpdater.once('update-downloaded', () => {
    send(100);
    setTimeout(() => autoUpdater.quitAndInstall(), 500); // 100% 표시할 시간
  });
  send(0);
  await autoUpdater.downloadUpdate();
}

function flattenNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? '')))
      .join('\n');
  }
  return '';
}
```

- [ ] **Step 2: 번들·타입체크**

Run: `npm run build:bundle -w desktop && npm run typecheck -w desktop && npm run lint`
Expected: PASS. (electron-updater가 esbuild CJS 번들에 포함된다. 번들 에러 발생 시 `external`에 `electron-updater`를 추가하고 electron/package.json의 devDependencies에서 dependencies로 옮긴 뒤 electron-builder.yml `files`에 `node_modules/**` 포함이 필요해지므로, 우선 번들을 시도하고 안 되면 이 대안을 적용·보고한다.)

- [ ] **Step 3: Commit**

```bash
git add electron/src/updater.ts
git commit -m "feat: electron-updater 래퍼 (가용성 체크, 진행률 0→100%, 재시작)"
```

---

### Task 6: UpdateModal (웹) + 수동 체크 버튼

**Files:**
- Create: `web/src/electron.d.ts`, `web/src/components/UpdateModal.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 타입 선언**

`web/src/electron.d.ts`:

```ts
// Electron preload(contextBridge)가 노출하는 API. 브라우저 단독 실행 시 undefined.
export interface UpdateCheckPayload {
  kind: 'available' | 'latest' | 'error';
  currentVersion?: string;
  version?: string;
  notes?: string;
  message?: string;
}

declare global {
  interface Window {
    appUpdater?: {
      check: () => Promise<UpdateCheckPayload>;
      install: () => Promise<void>;
      onProgress: (cb: (percent: number) => void) => () => void;
    };
  }
}

export {};
```

- [ ] **Step 2: UpdateModal 구현**

`web/src/components/UpdateModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button, Modal, Progress, Typography, message } from 'antd';
import type { UpdateCheckPayload } from '../electron';

interface Props {
  manualCheckCount: number; // App의 '업데이트 확인' 버튼 클릭마다 증가
}

export default function UpdateModal({ manualCheckCount }: Props) {
  const [update, setUpdate] = useState<UpdateCheckPayload>();
  const [percent, setPercent] = useState<number>();

  const check = async (manual: boolean) => {
    const updater = window.appUpdater;
    if (!updater) {
      if (manual) void message.info('데스크톱 앱에서만 업데이트를 지원합니다');
      return;
    }
    const result = await updater.check();
    if (result.kind === 'available') setUpdate(result);
    else if (manual && result.kind === 'latest') {
      void message.success(`최신 버전입니다 (v${result.currentVersion})`);
    } else if (manual && result.kind === 'error') {
      void message.error(`업데이트 확인 실패: ${result.message}`);
    }
    // 자동 체크의 latest/error는 조용히 무시 (스펙)
  };

  useEffect(() => {
    const timer = setTimeout(() => void check(false), 5000); // 시작 5초 후 자동 체크
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (manualCheckCount > 0) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualCheckCount]);

  const install = async () => {
    const updater = window.appUpdater;
    if (!updater) return;
    setPercent(0);
    const off = updater.onProgress(setPercent);
    try {
      await updater.install(); // 100% 도달 후 앱이 스스로 재시작
    } catch (e) {
      off();
      setPercent(undefined);
      void message.error(`업데이트 실패: ${(e as Error).message}`);
    }
  };

  const downloading = percent !== undefined;
  return (
    <Modal
      title={`새 버전 v${update?.version ?? ''} (현재 v${update?.currentVersion ?? ''})`}
      open={update !== undefined}
      onCancel={() => !downloading && setUpdate(undefined)}
      closable={!downloading}
      maskClosable={false}
      footer={
        downloading ? null : [
          <Button key="later" onClick={() => setUpdate(undefined)}>나중에</Button>,
          <Button key="go" type="primary" onClick={() => void install()}>업데이트</Button>,
        ]
      }
    >
      {update?.notes && (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{update.notes}</Typography.Paragraph>
      )}
      {downloading && (
        <Progress percent={percent} status={percent !== undefined && percent < 100 ? 'active' : 'success'} />
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: App.tsx에 마운트**

`web/src/App.tsx` 수정 — import 추가:

```tsx
import { SyncOutlined } from '@ant-design/icons';
import UpdateModal from './components/UpdateModal';
```

state 추가 (기존 useState들 옆):

```tsx
const [updateCheckCount, setUpdateCheckCount] = useState(0);
```

사이드바의 "새 대시보드" Button 바로 아래에 추가:

```tsx
<Button
  type="text" icon={<SyncOutlined />} block
  style={{ width: 'calc(100% - 32px)', margin: '0 16px' }}
  onClick={() => setUpdateCheckCount((c) => c + 1)}
>
  업데이트 확인
</Button>
```

`<ChatDrawer ... />` 다음 줄에 추가:

```tsx
<UpdateModal manualCheckCount={updateCheckCount} />
```

- [ ] **Step 4: 검증**

Run: `npm run typecheck -w web && npm run lint && npm run build -w web`
Expected: 전부 PASS. 브라우저 단독 실행에선 `window.appUpdater`가 없으므로 수동 체크 시 "데스크톱 앱에서만…" 안내 — `npm run dev -w web` + 서버 띄우고 버튼 클릭으로 확인.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: 업데이트 모달 및 수동 업데이트 확인 버튼 (진행률 0→100%)"
```

---

### Task 7: 패키징(.app) + E2E 수동 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 프로덕션 빌드**

Run: `npm run app:build`
Expected: `web/dist` 생성 → `electron/release/` 아래 `PE Dashboard-0.1.0-arm64.dmg`, `*.zip`, `latest-mac.yml` 생성. 코드 서명 경고(identity null)는 허용.

- [ ] **Step 2: .app 실행 검증**

Run: `open "electron/release/mac-arm64/PE Dashboard.app"` (경로는 빌드 출력 기준으로 확인)
Expected:
1. 자체 창으로 PE Dashboard UI 표시 (크롬 아님)
2. 대시보드 목록 표시 — 데이터 디렉토리가 `~/Library/Application Support/PE Dashboard/data`로 새로 시작됨(빈 목록 정상)
3. 새 대시보드 생성 동작
4. 채팅에 "ArgoCD 앱 목록 보여주는 대시보드 만들어줘" 입력 → **claude CLI 경유** 응답으로 대시보드/위젯 생성 (claude CLI가 로그인돼 있어야 함. 미로그인 시 채팅에 에러 표시되는지 확인 — 이것도 유효한 검증)
5. "업데이트 확인" 버튼 → GitHub 저장소 미설정 상태이므로 에러 메시지 또는 "최신 버전" — 앱이 죽지 않으면 성공
검증 후 앱 종료.

- [ ] **Step 3: app:dev 회귀 확인**

`npm run app:dev` → Electron 창에서 HMR 동작(웹 코드 수정 시 반영) 확인 → 종료.

- [ ] **Step 4: README 갱신**

`README.md`의 "시작하기"와 "명령어" 섹션을 다음으로 교체:

```markdown
## 시작하기 (데스크톱 앱)

```bash
npm install
npm run app:dev     # 개발: Electron 창 + HMR (server:5174, web:5173)
npm run app:build   # 패키징: electron/release/ 에 .app/.dmg 생성
```

AI 채팅은 로컬 `claude` CLI(Claude Code)를 사용한다 — 별도 API 키 불필요.
Claude Code가 설치·로그인되어 있어야 한다. (API 모드로 쓰려면
`CHAT_ADAPTER=api` + `server/.env`에 `ANTHROPIC_API_KEY` 설정)

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
릴리스 배포: 버전 올리고 `npm run app:build` 후 GitHub Release에
`release/*.zip`, `*.dmg`, `latest-mac.yml` 업로드.
```

- [ ] **Step 5: 최종 검증 + Commit**

Run: `npm test -w server && npm run typecheck -w server && npm run typecheck -w web && npm run typecheck -w desktop && npm run lint && npm run build -w web`
Expected: 전부 PASS

```bash
git add README.md
git commit -m "docs: 데스크톱 앱 실행·빌드·업데이트 가이드"
```

---

## Self-Review 결과

- **스펙 커버리지**: Electron 셸·내장 서버·정적 서빙·포트 폴백(T3,T4) / userData 데이터 디렉토리(T4 main.ts) / Claude CLI 어댑터·작업 JSON·$last·부분실패·히스토리 근사·친절한 에러(T1,T2) / API 어댑터 보존+CHAT_ADAPTER(T3) / 업데이터 상태모델·0→99→100%·재시작·우아한 실패(T5,T6) / 수동 체크(T6 버튼) / .app·zip·latest-mac.yml(T7) — 모두 매핑.
- **스펙과 차이**: 수동 체크를 앱 메뉴 대신 사이드바 버튼으로 구현(웹 코드만으로 처리, 동일 기능). 코드 서명 없음은 스펙의 "추후 과제" 그대로.
- **타입 일관성**: `UpdateCheck`(electron) ↔ `UpdateCheckPayload`(web)는 IPC 직렬화 호환 형태. `ChatAdapter.chat` 시그니처가 ChatService·ClaudeCliAdapter 동일. `Operation` ↔ tools 핸들러 입력 매핑 toToolCall에서 일원화.
