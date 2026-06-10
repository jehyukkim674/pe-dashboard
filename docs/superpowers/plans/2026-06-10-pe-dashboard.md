# PE Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오른쪽 AI 채팅 drawer로 말하면 메인 영역에 CLI 기반 위젯 대시보드가 생성·수정되는 로컬 전용 멀티 대시보드 웹앱.

**Architecture:** npm workspaces 모노레포(`server/` + `web/`). 백엔드는 Fastify+TS로 대시보드 JSON 파일 CRUD, 화이트리스트 CLI 실행, Claude API tool-use 루프(SSE)를 제공. 프론트는 React+AntD+react-grid-layout으로 그리드 편집과 채팅 drawer를 제공.

**Tech Stack:** TypeScript, Fastify, @anthropic-ai/sdk, Vitest / React 18, Vite, Ant Design 5, react-grid-layout, Recharts

**Spec:** `docs/superpowers/specs/2026-06-10-pe-dashboard-design.md`

---

## 파일 구조

```
pe-dashboard/
├── package.json                  # workspaces 루트
├── data/                         # 런타임 데이터 (gitignore)
│   ├── dashboards/*.json
│   └── commands.json
├── server/
│   ├── package.json, tsconfig.json, vitest.config.ts, .env
│   ├── src/
│   │   ├── types.ts              # Dashboard/Widget/CommandTemplate 타입
│   │   ├── dashboardStore.ts     # JSON 파일 CRUD + 위젯 조작 (원자적 쓰기)
│   │   ├── commands/
│   │   │   ├── registry.ts       # 내장+커스텀 템플릿, 파라미터 치환·검증
│   │   │   ├── runner.ts         # execFile 실행, 타임아웃, 친절한 에러
│   │   │   └── pending.ts        # register_command 사용자 확인 대기열
│   │   ├── datasources/
│   │   │   ├── registry.ts       # kind→DataSource 플러그인 레지스트리
│   │   │   └── cliSource.ts      # 'cli' 구현체
│   │   ├── ai/
│   │   │   ├── tools.ts          # Claude tool 정의 + 핸들러 레지스트리
│   │   │   └── chatService.ts    # Claude API tool-use 루프, 세션 히스토리
│   │   ├── routes/
│   │   │   ├── dashboards.ts     # REST CRUD
│   │   │   ├── commands.ts       # 템플릿 조회 + pending confirm
│   │   │   ├── widgetData.ts     # POST /api/widget-data
│   │   │   └── chat.ts           # POST /api/chat (SSE)
│   │   └── index.ts              # Fastify 부트스트랩, 의존성 조립
│   └── test/                     # *.test.ts (Vitest)
└── web/
    ├── package.json, vite.config.ts(프록시), tsconfig.json
    └── src/
        ├── types.ts              # 서버 타입 복사본
        ├── api.ts                # fetch 헬퍼 + SSE 채팅 클라이언트
        ├── App.tsx               # Layout: Sider(대시보드 목록) + Content + FloatButton
        ├── hooks/useWidgetData.ts
        └── components/
            ├── DashboardGrid.tsx # react-grid-layout, 수동 편집 저장
            ├── WidgetCard.tsx    # 카드 + 타입별 렌더러 분기 + 삭제
            ├── ChatDrawer.tsx    # 채팅 UI, 액션 칩, 명령 등록 확인 버튼
            └── widgets/          # Stat/Table/Chart/Log/Text Widget.tsx
```

---

### Task 1: 모노레포 스캐폴딩 + 서버 패키지 설정

**Files:**
- Create: `package.json`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: 루트 package.json 작성**

```json
{
  "name": "pe-dashboard",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "dev": "npm run dev -w server & npm run dev -w web & wait",
    "test": "npm test -w server"
  }
}
```

- [ ] **Step 2: server 패키지 생성**

`server/package.json`:

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@fastify/cors": "^10.0.0",
    "dotenv": "^16.4.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

`server/.env.example`:

```
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-4-6
```

- [ ] **Step 3: .gitignore 갱신**

기존 `.gitignore`를 다음으로 교체:

```
logs/
node_modules/
.env
data/
dist/
```

- [ ] **Step 4: 설치 및 확인**

Run: `npm install` (루트에서)
Expected: 에러 없이 완료, `node_modules` 생성

- [ ] **Step 5: Commit**

```bash
git add package.json server .gitignore
git commit -m "chore: 모노레포 스캐폴딩 및 서버 패키지 설정"
```

---

### Task 2: 도메인 타입 + DashboardStore

**Files:**
- Create: `server/src/types.ts`, `server/src/dashboardStore.ts`
- Test: `server/test/dashboardStore.test.ts`

- [ ] **Step 1: 타입 정의 작성**

`server/src/types.ts`:

```ts
export type WidgetType = 'stat' | 'table' | 'chart' | 'log' | 'text';

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDataSource {
  kind: 'cli'; // 확장: 'postgres' | 'http'
  commandId: string;
  params: Record<string, string>;
  refreshSec?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  layout: WidgetLayout;
  dataSource?: WidgetDataSource; // text 위젯은 없음
  display?: Record<string, unknown>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: Widget[];
}

export interface CommandTemplate {
  id: string;
  description: string;
  argv: string[]; // 예: ["gh","run","list","--repo","{repo}"]
  params: string[]; // 예: ["repo"]
  builtin?: boolean;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json?: unknown; // stdout이 JSON 파싱되면 채움
  error?: string; // 사용자에게 보여줄 친절한 에러
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`server/test/dashboardStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';

describe('DashboardStore', () => {
  let store: DashboardStore;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dash-'));
    store = new DashboardStore(dir);
    await store.init();
  });

  it('creates and lists dashboards', async () => {
    const d = await store.create('배포 현황');
    expect(d.id).toBeTruthy();
    expect(d.widgets).toEqual([]);
    const all = await store.list();
    expect(all.map((x) => x.name)).toEqual(['배포 현황']);
  });

  it('returns undefined for missing dashboard', async () => {
    expect(await store.get('no-such-id')).toBeUndefined();
  });

  it('rejects path-traversal ids', async () => {
    await expect(store.get('../etc/passwd')).rejects.toThrow(/invalid/);
  });

  it('deletes a dashboard', async () => {
    const d = await store.create('temp');
    expect(await store.delete(d.id)).toBe(true);
    expect(await store.delete(d.id)).toBe(false);
  });

  it('adds, updates and removes widgets', async () => {
    const d = await store.create('w');
    const widget = await store.addWidget(d.id, {
      type: 'stat',
      title: '실패 수',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
    });
    expect(widget.id).toBeTruthy();

    const updated = await store.updateWidget(d.id, widget.id, { title: '빌드 실패' });
    expect(updated.title).toBe('빌드 실패');
    expect(updated.type).toBe('stat'); // 패치 외 필드 보존

    await store.removeWidget(d.id, widget.id);
    expect((await store.get(d.id))!.widgets).toEqual([]);
  });

  it('throws when widget target is missing', async () => {
    const d = await store.create('x');
    await expect(store.updateWidget(d.id, 'nope', {})).rejects.toThrow(/widget not found/);
    await expect(store.addWidget('no-dash', {} as never)).rejects.toThrow(/dashboard not found/);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -w server`
Expected: FAIL — `Cannot find module '../src/dashboardStore.js'`

- [ ] **Step 4: DashboardStore 구현**

`server/src/dashboardStore.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Dashboard, Widget } from './types.js';

export class DashboardStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`invalid dashboard id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<Dashboard[]> {
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const dashboards = await Promise.all(
      files.map(async (f) =>
        JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8')) as Dashboard,
      ),
    );
    return dashboards.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Dashboard | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as Dashboard;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async create(name: string): Promise<Dashboard> {
    const dashboard: Dashboard = { id: randomUUID(), name, widgets: [] };
    await this.write(dashboard);
    return dashboard;
  }

  async save(dashboard: Dashboard): Promise<void> {
    await this.write(dashboard);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.filePath(id));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  async addWidget(dashboardId: string, widget: Omit<Widget, 'id'>): Promise<Widget> {
    const dashboard = await this.mustGet(dashboardId);
    const created: Widget = { ...widget, id: randomUUID() };
    dashboard.widgets.push(created);
    await this.write(dashboard);
    return created;
  }

  async updateWidget(
    dashboardId: string,
    widgetId: string,
    patch: Partial<Omit<Widget, 'id'>>,
  ): Promise<Widget> {
    const dashboard = await this.mustGet(dashboardId);
    const index = dashboard.widgets.findIndex((w) => w.id === widgetId);
    if (index < 0) throw new Error(`widget not found: ${widgetId}`);
    dashboard.widgets[index] = { ...dashboard.widgets[index], ...patch, id: widgetId };
    await this.write(dashboard);
    return dashboard.widgets[index];
  }

  async removeWidget(dashboardId: string, widgetId: string): Promise<void> {
    const dashboard = await this.mustGet(dashboardId);
    const before = dashboard.widgets.length;
    dashboard.widgets = dashboard.widgets.filter((w) => w.id !== widgetId);
    if (dashboard.widgets.length === before) throw new Error(`widget not found: ${widgetId}`);
    await this.write(dashboard);
  }

  private async mustGet(id: string): Promise<Dashboard> {
    const dashboard = await this.get(id);
    if (!dashboard) throw new Error(`dashboard not found: ${id}`);
    return dashboard;
  }

  // 원자적 쓰기: temp 파일에 쓴 뒤 rename
  private async write(dashboard: Dashboard): Promise<void> {
    const target = this.filePath(dashboard.id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(dashboard, null, 2));
    await fs.rename(tmp, target);
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -w server`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts server/src/dashboardStore.ts server/test/dashboardStore.test.ts
git commit -m "feat: 도메인 타입 및 DashboardStore 구현 (원자적 JSON 파일 저장)"
```

---

### Task 3: CommandRegistry (템플릿 + 파라미터 치환·검증)

**Files:**
- Create: `server/src/commands/registry.ts`
- Test: `server/test/commandRegistry.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/commandRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandRegistry } from '../src/commands/registry.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cmd-'));
    registry = new CommandRegistry(path.join(dir, 'commands.json'));
    await registry.load();
  });

  it('lists builtin templates', () => {
    const ids = registry.list().map((t) => t.id);
    expect(ids).toContain('gh_run_list');
    expect(ids).toContain('argocd_app_list');
    expect(ids).toContain('port_check');
  });

  it('builds argv with substituted params', () => {
    const argv = registry.buildArgv('gh_run_list', { repo: 'org/repo' });
    expect(argv).toContain('org/repo');
    expect(argv[0]).toBe('gh');
  });

  it('substitutes placeholder inside an argv element', () => {
    const argv = registry.buildArgv('port_check', { port: '8080' });
    expect(argv).toContain(':8080');
  });

  it('rejects missing params', () => {
    expect(() => registry.buildArgv('gh_run_list', {})).toThrow(/missing param/);
  });

  it('rejects unknown command', () => {
    expect(() => registry.buildArgv('rm_rf', {})).toThrow(/unknown command/);
  });

  it('rejects param values with shell metacharacters or leading dash', () => {
    expect(() => registry.buildArgv('gh_run_list', { repo: 'a;rm -rf /' })).toThrow(/invalid/);
    expect(() => registry.buildArgv('gh_run_list', { repo: '--evil' })).toThrow(/invalid/);
  });

  it('registers and persists a custom template', async () => {
    await registry.register({
      id: 'kubectl_pods',
      description: '파드 목록',
      argv: ['kubectl', 'get', 'pods', '-n', '{ns}', '-o', 'json'],
      params: ['ns'],
    });
    expect(registry.buildArgv('kubectl_pods', { ns: 'default' })).toContain('default');

    // 새 인스턴스로 로드해도 유지
    const again = new CommandRegistry(registry.customFile);
    await again.load();
    expect(again.get('kubectl_pods')).toBeDefined();
  });

  it('rejects duplicate or invalid template ids', async () => {
    await expect(
      registry.register({ id: 'gh_run_list', description: 'dup', argv: ['x'], params: [] }),
    ).rejects.toThrow(/already exists/);
    await expect(
      registry.register({ id: 'bad id!', description: '', argv: ['x'], params: [] }),
    ).rejects.toThrow(/invalid/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- commandRegistry`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: CommandRegistry 구현**

`server/src/commands/registry.ts`:

```ts
import { promises as fs } from 'node:fs';
import type { CommandTemplate } from '../types.js';

const BUILTIN: CommandTemplate[] = [
  {
    id: 'gh_run_list',
    description: 'GitHub Actions 워크플로우 실행 목록 (JSON)',
    argv: ['gh', 'run', 'list', '--repo', '{repo}', '--limit', '20', '--json',
      'status,conclusion,name,displayTitle,createdAt,url'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'gh_pr_list',
    description: 'GitHub PR 목록 (JSON)',
    argv: ['gh', 'pr', 'list', '--repo', '{repo}', '--json',
      'number,title,author,state,createdAt,url'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'git_log',
    description: '로컬 저장소 최근 커밋 로그 (텍스트)',
    argv: ['git', '-C', '{repoPath}', 'log', '--oneline', '-n', '20'],
    params: ['repoPath'],
    builtin: true,
  },
  {
    id: 'argocd_app_list',
    description: 'ArgoCD 애플리케이션 목록 (JSON)',
    argv: ['argocd', 'app', 'list', '-o', 'json'],
    params: [],
    builtin: true,
  },
  {
    id: 'argocd_app_get',
    description: 'ArgoCD 단일 앱 상세 (JSON)',
    argv: ['argocd', 'app', 'get', '{app}', '-o', 'json'],
    params: ['app'],
    builtin: true,
  },
  {
    id: 'port_check',
    description: '로컬 포트 사용/포트포워딩 상태 (텍스트, 미사용 시 빈 결과)',
    argv: ['lsof', '-nP', '-i', ':{port}'],
    params: ['port'],
    builtin: true,
  },
];

const PARAM_VALUE_RE = /^[\w@.:/\\,= -]+$/;

export class CommandRegistry {
  private custom: CommandTemplate[] = [];

  constructor(readonly customFile: string) {}

  async load(): Promise<void> {
    try {
      this.custom = JSON.parse(await fs.readFile(this.customFile, 'utf8')) as CommandTemplate[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.custom = [];
    }
  }

  list(): CommandTemplate[] {
    return [...BUILTIN, ...this.custom];
  }

  get(id: string): CommandTemplate | undefined {
    return this.list().find((t) => t.id === id);
  }

  async register(template: CommandTemplate): Promise<void> {
    if (!/^[\w-]+$/.test(template.id)) throw new Error(`invalid template id: ${template.id}`);
    if (!Array.isArray(template.argv) || template.argv.length === 0) {
      throw new Error('argv must be a non-empty array');
    }
    if (this.get(template.id)) throw new Error(`template already exists: ${template.id}`);
    this.custom.push({ ...template, builtin: false });
    const tmp = `${this.customFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.custom, null, 2));
    await fs.rename(tmp, this.customFile);
  }

  // 화이트리스트 검증의 핵심: 등록된 템플릿의 {placeholder} 위치에만 값 치환.
  // 셸을 거치지 않고 argv 배열로 실행하므로 값에 셸 메타문자·선행 대시를 금지한다.
  buildArgv(id: string, params: Record<string, string>): string[] {
    const template = this.get(id);
    if (!template) throw new Error(`unknown command: ${id}`);
    return template.argv.map((part) =>
      part.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = params[name];
        if (value === undefined) throw new Error(`missing param: ${name}`);
        if (value.startsWith('-') || !PARAM_VALUE_RE.test(value)) {
          throw new Error(`invalid param value for ${name}: ${value}`);
        }
        return value;
      }),
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server -- commandRegistry`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/commands/registry.ts server/test/commandRegistry.test.ts
git commit -m "feat: CLI 명령 템플릿 레지스트리 (화이트리스트, 파라미터 검증, 커스텀 등록)"
```

---

### Task 4: CLI Runner (실행 + 타임아웃 + 친절한 에러)

**Files:**
- Create: `server/src/commands/runner.ts`
- Test: `server/test/runner.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runArgv } from '../src/commands/runner.js';

describe('runArgv', () => {
  it('captures stdout and parses JSON output', async () => {
    const result = await runArgv(['node', '-e', 'console.log(JSON.stringify([{a:1}]))']);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual([{ a: 1 }]);
  });

  it('keeps raw stdout when output is not JSON', async () => {
    const result = await runArgv(['node', '-e', 'console.log("hello")']);
    expect(result.ok).toBe(true);
    expect(result.json).toBeUndefined();
    expect(result.stdout.trim()).toBe('hello');
  });

  it('reports friendly error for missing binary', async () => {
    const result = await runArgv(['definitely-not-a-command-xyz']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/찾을 수 없습니다/);
  });

  it('reports failure with stderr message', async () => {
    const result = await runArgv(['node', '-e', 'console.error("auth required"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('auth required');
  });

  it('times out long-running commands', async () => {
    const result = await runArgv(['node', '-e', 'setTimeout(()=>{}, 60000)'], 500);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/초과/);
  }, 10_000);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- runner`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: runner 구현**

`server/src/commands/runner.ts`:

```ts
import { execFile } from 'node:child_process';
import type { CommandResult } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export function runArgv(argv: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        const result: CommandResult = {
          ok: !err,
          exitCode: err ? exitCodeOf(err) : 0,
          stdout,
          stderr,
        };
        if (err) result.error = friendlyError(err, stderr, argv[0], timeoutMs);
        try {
          result.json = JSON.parse(stdout);
        } catch {
          // JSON이 아니면 raw stdout만 사용
        }
        resolve(result);
      },
    );
  });
}

function exitCodeOf(err: Error): number | null {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'number' ? code : null;
}

function friendlyError(err: Error, stderr: string, cmd: string, timeoutMs: number): string {
  const e = err as NodeJS.ErrnoException & { killed?: boolean };
  if (e.code === 'ENOENT') return `'${cmd}' 명령을 찾을 수 없습니다. 설치 및 PATH를 확인하세요.`;
  if (e.killed) return `명령 실행이 ${timeoutMs / 1000}초를 초과해 중단되었습니다.`;
  if (/auth|login|credential/i.test(stderr)) {
    return `로그인이 필요할 수 있습니다: ${stderr.slice(0, 200)}`;
  }
  return stderr.slice(0, 300) || err.message;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server -- runner`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/commands/runner.ts server/test/runner.test.ts
git commit -m "feat: CLI 실행기 (argv spawn, 10초 타임아웃, 친절한 에러 메시지)"
```

---

### Task 5: DataSourceRegistry + CliSource

**Files:**
- Create: `server/src/datasources/registry.ts`, `server/src/datasources/cliSource.ts`
- Test: `server/test/dataSources.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/dataSources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataSourceRegistry } from '../src/datasources/registry.js';
import { CliSource } from '../src/datasources/cliSource.js';
import { CommandRegistry } from '../src/commands/registry.js';

describe('DataSourceRegistry', () => {
  it('resolves registered source by kind and throws for unknown kind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ds-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();

    const registry = new DataSourceRegistry();
    registry.register(new CliSource(commands));

    expect(registry.get('cli').kind).toBe('cli');
    expect(() => registry.get('postgres')).toThrow(/unsupported data source/);
  });

  it('CliSource fetches via command template', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ds-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    await commands.register({
      id: 'echo_json',
      description: 'test',
      argv: ['node', '-e', 'console.log(JSON.stringify({msg:"hi"}))'],
      params: [],
    });

    const source = new CliSource(commands);
    const result = await source.fetch({ kind: 'cli', commandId: 'echo_json', params: {} });
    expect(result.json).toEqual({ msg: 'hi' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- dataSources`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`server/src/datasources/registry.ts`:

```ts
import type { CommandResult, WidgetDataSource } from '../types.js';

export interface DataSource {
  readonly kind: string;
  fetch(dataSource: WidgetDataSource): Promise<CommandResult>;
}

// 확장 포인트: PostgresSource, HttpSource 등을 register()로 추가
export class DataSourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    this.sources.set(source.kind, source);
  }

  get(kind: string): DataSource {
    const source = this.sources.get(kind);
    if (!source) throw new Error(`unsupported data source kind: ${kind}`);
    return source;
  }
}
```

`server/src/datasources/cliSource.ts`:

```ts
import type { CommandResult, WidgetDataSource } from '../types.js';
import type { CommandRegistry } from '../commands/registry.js';
import { runArgv } from '../commands/runner.js';
import type { DataSource } from './registry.js';

export class CliSource implements DataSource {
  readonly kind = 'cli';

  constructor(private readonly commands: CommandRegistry) {}

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const argv = this.commands.buildArgv(dataSource.commandId, dataSource.params);
    return runArgv(argv);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server -- dataSources`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/datasources server/test/dataSources.test.ts
git commit -m "feat: 데이터 소스 플러그인 레지스트리 및 CLI 소스 구현"
```

---

### Task 6: AI 도구 정의/핸들러 + PendingCommands

**Files:**
- Create: `server/src/ai/tools.ts`, `server/src/commands/pending.ts`
- Test: `server/test/tools.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools, type ToolKit } from '../src/ai/tools.js';

describe('AI tools', () => {
  let tools: ToolKit;
  let store: DashboardStore;
  let pending: PendingCommands;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tools-'));
    store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    pending = new PendingCommands();
    tools = buildTools({ store, commands, pending });
  });

  it('exposes definitions matching handlers', () => {
    const names = tools.definitions.map((d) => d.name).sort();
    expect(names).toEqual(Object.keys(tools.handlers).sort());
    expect(names).toContain('create_dashboard');
    expect(names).toContain('run_command_preview');
  });

  it('create_dashboard then add_widget round-trips through the store', async () => {
    const created = (await tools.handlers.create_dashboard({ name: '배포' })) as { id: string };
    const widget = await tools.handlers.add_widget({
      dashboardId: created.id,
      widget: {
        type: 'stat',
        title: '실패 수',
        layout: { x: 0, y: 0, w: 3, h: 2 },
        dataSource: { kind: 'cli', commandId: 'gh_run_list', params: { repo: 'a/b' } },
      },
    });
    expect((widget as { id: string }).id).toBeTruthy();
    expect((await store.get(created.id))!.widgets).toHaveLength(1);
  });

  it('add_widget rejects unknown commandId', async () => {
    const created = (await tools.handlers.create_dashboard({ name: 'x' })) as { id: string };
    await expect(
      tools.handlers.add_widget({
        dashboardId: created.id,
        widget: {
          type: 'stat',
          title: 't',
          layout: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: { kind: 'cli', commandId: 'nope', params: {} },
        },
      }),
    ).rejects.toThrow(/unknown command/);
  });

  it('run_command_preview truncates long output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tools2-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    await commands.register({
      id: 'long_out',
      description: 'test',
      argv: ['node', '-e', 'console.log("x".repeat(10000))'],
      params: [],
    });
    const kit = buildTools({ store, commands, pending });
    const preview = (await kit.handlers.run_command_preview({
      commandId: 'long_out',
      params: {},
    })) as { stdout: string };
    expect(preview.stdout.length).toBeLessThanOrEqual(2000);
  });

  it('register_command queues pending confirmation instead of registering', async () => {
    const result = (await tools.handlers.register_command({
      id: 'kubectl_ctx',
      description: '컨텍스트',
      argv: ['kubectl', 'config', 'current-context'],
      params: [],
    })) as { pendingId: string; status: string };
    expect(result.status).toBe('pending_confirmation');
    expect(pending.peek(result.pendingId)?.id).toBe('kubectl_ctx');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- tools`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: PendingCommands 구현**

`server/src/commands/pending.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { CommandTemplate } from '../types.js';

// register_command는 사용자 확인 버튼을 거쳐야 실제 등록된다 (스펙 보안 요구).
export class PendingCommands {
  private readonly map = new Map<string, CommandTemplate>();

  add(template: CommandTemplate): string {
    const id = randomUUID();
    this.map.set(id, template);
    return id;
  }

  peek(id: string): CommandTemplate | undefined {
    return this.map.get(id);
  }

  take(id: string): CommandTemplate | undefined {
    const template = this.map.get(id);
    this.map.delete(id);
    return template;
  }
}
```

- [ ] **Step 4: tools 구현**

`server/src/ai/tools.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';
import { runArgv } from '../commands/runner.js';
import type { Widget } from '../types.js';

export interface ToolContext {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
}

export type ToolHandler = (input: never) => Promise<unknown>;

export interface ToolKit {
  definitions: Anthropic.Tool[];
  handlers: Record<string, (input: any) => Promise<unknown>>;
}

const layoutSchema = {
  type: 'object' as const,
  properties: {
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' },
  },
  required: ['x', 'y', 'w', 'h'],
};

const dataSourceSchema = {
  type: 'object' as const,
  properties: {
    kind: { type: 'string', enum: ['cli'] },
    commandId: { type: 'string' },
    params: { type: 'object' },
    refreshSec: { type: 'number' },
  },
  required: ['kind', 'commandId', 'params'],
};

const widgetSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: ['stat', 'table', 'chart', 'log', 'text'] },
    title: { type: 'string' },
    layout: layoutSchema,
    dataSource: dataSourceSchema,
    display: { type: 'object' },
  },
  required: ['type', 'title', 'layout'],
};

// 확장 포인트: 이 배열에 정의+핸들러 쌍을 추가하면 AI 능력이 늘어난다.
export function buildTools(ctx: ToolContext): ToolKit {
  const definitions: Anthropic.Tool[] = [
    {
      name: 'list_dashboards',
      description: '모든 대시보드와 위젯 목록을 조회한다.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'create_dashboard',
      description: '새 대시보드를 만든다.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', description: '대시보드 이름' } },
        required: ['name'],
      },
    },
    {
      name: 'delete_dashboard',
      description: '대시보드를 삭제한다.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'add_widget',
      description: '대시보드에 위젯을 추가한다. dataSource.commandId는 list_commands에 있는 것만 사용.',
      input_schema: {
        type: 'object',
        properties: { dashboardId: { type: 'string' }, widget: widgetSchema },
        required: ['dashboardId', 'widget'],
      },
    },
    {
      name: 'update_widget',
      description: '위젯의 일부 필드만 수정한다 (title, layout, dataSource, display).',
      input_schema: {
        type: 'object',
        properties: {
          dashboardId: { type: 'string' },
          widgetId: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['dashboardId', 'widgetId', 'patch'],
      },
    },
    {
      name: 'remove_widget',
      description: '위젯을 삭제한다.',
      input_schema: {
        type: 'object',
        properties: { dashboardId: { type: 'string' }, widgetId: { type: 'string' } },
        required: ['dashboardId', 'widgetId'],
      },
    },
    {
      name: 'list_commands',
      description: '위젯 dataSource로 사용 가능한 CLI 명령 템플릿 목록을 조회한다.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'run_command_preview',
      description: '명령을 1회 실행해 출력 구조를 확인한다. 위젯 구성 전 출력 형태가 불확실할 때 사용.',
      input_schema: {
        type: 'object',
        properties: { commandId: { type: 'string' }, params: { type: 'object' } },
        required: ['commandId', 'params'],
      },
    },
    {
      name: 'register_command',
      description:
        '새 CLI 명령 템플릿 등록을 요청한다. 사용자가 채팅창에서 승인해야 실제 등록된다. ' +
        'argv는 ["gh","run","list","--repo","{repo}"]처럼 인자 배열이며 {param} 자리표시자를 쓴다.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          argv: { type: 'array', items: { type: 'string' } },
          params: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'description', 'argv', 'params'],
      },
    },
  ];

  const handlers: ToolKit['handlers'] = {
    list_dashboards: async () => ctx.store.list(),

    create_dashboard: async (input: { name: string }) => ctx.store.create(input.name),

    delete_dashboard: async (input: { id: string }) => {
      const deleted = await ctx.store.delete(input.id);
      if (!deleted) throw new Error(`dashboard not found: ${input.id}`);
      return { deleted: input.id };
    },

    add_widget: async (input: { dashboardId: string; widget: Omit<Widget, 'id'> }) => {
      validateDataSource(ctx, input.widget);
      return ctx.store.addWidget(input.dashboardId, input.widget);
    },

    update_widget: async (input: {
      dashboardId: string;
      widgetId: string;
      patch: Partial<Widget>;
    }) => {
      validateDataSource(ctx, input.patch);
      return ctx.store.updateWidget(input.dashboardId, input.widgetId, input.patch);
    },

    remove_widget: async (input: { dashboardId: string; widgetId: string }) => {
      await ctx.store.removeWidget(input.dashboardId, input.widgetId);
      return { removed: input.widgetId };
    },

    list_commands: async () => ctx.commands.list(),

    run_command_preview: async (input: { commandId: string; params: Record<string, string> }) => {
      const argv = ctx.commands.buildArgv(input.commandId, input.params);
      const result = await runArgv(argv);
      return {
        ok: result.ok,
        error: result.error,
        stdout: result.stdout.slice(0, 2000),
        isJson: result.json !== undefined,
      };
    },

    register_command: async (input: {
      id: string;
      description: string;
      argv: string[];
      params: string[];
    }) => {
      if (ctx.commands.get(input.id)) throw new Error(`template already exists: ${input.id}`);
      const pendingId = ctx.pending.add({ ...input, builtin: false });
      return { pendingId, status: 'pending_confirmation', command: input };
    },
  };

  return { definitions, handlers };
}

function validateDataSource(ctx: ToolContext, widget: Partial<Widget>): void {
  const ds = widget.dataSource;
  if (!ds) return;
  // buildArgv가 unknown command / 잘못된 파라미터를 즉시 던지게 해 AI 실수를 조기에 잡는다
  ctx.commands.buildArgv(ds.commandId, ds.params);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -w server -- tools`
Expected: PASS (5 tests)

- [ ] **Step 6: 전체 테스트 + 타입체크**

Run: `npm test -w server && npm run typecheck -w server`
Expected: 모두 PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/tools.ts server/src/commands/pending.ts server/test/tools.test.ts
git commit -m "feat: AI 도구 레지스트리 9종 및 명령 등록 확인 대기열 구현"
```

---

### Task 7: ChatService (Claude API tool-use 루프)

**Files:**
- Create: `server/src/ai/chatService.ts`
- Test: `server/test/chatService.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Anthropic 클라이언트는 `messages.create`만 쓰므로 그 모양만 모킹한다.

`server/test/chatService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatService, type ChatEvent } from '../src/ai/chatService.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools } from '../src/ai/tools.js';

async function makeService(responses: unknown[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  const tools = buildTools({ store, commands, pending: new PendingCommands() });

  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  const client = { messages: { create } };
  return {
    service: new ChatService({ client: client as never, tools, store, commands }),
    store,
    create,
  };
}

function collectEvents() {
  const events: ChatEvent[] = [];
  return { events, emit: (e: ChatEvent) => events.push(e) };
}

describe('ChatService', () => {
  it('emits text for a plain response', async () => {
    const { service } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '안녕하세요' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', '안녕', emit);
    expect(events).toEqual([{ type: 'text', text: '안녕하세요' }]);
  });

  it('runs tool_use loop: executes handler, emits tool event, continues', async () => {
    const { service, store } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'create_dashboard', input: { name: '배포' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '만들었습니다' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', '배포 대시보드 만들어줘', emit);

    expect((await store.list()).map((d) => d.name)).toEqual(['배포']);
    expect(events.some((e) => e.type === 'tool' && e.name === 'create_dashboard')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'text', text: '만들었습니다' });
  });

  it('emits confirm_request when register_command tool is used', async () => {
    const command = {
      id: 'k_ctx', description: 'ctx', argv: ['kubectl', 'config', 'current-context'], params: [],
    };
    const { service } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'register_command', input: command }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '승인해주세요' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', 'kubectl 컨텍스트 명령 등록해줘', emit);

    const confirm = events.find((e) => e.type === 'confirm_request');
    expect(confirm).toBeDefined();
    expect((confirm as { pendingId: string }).pendingId).toBeTruthy();
  });

  it('returns tool errors to the model instead of crashing', async () => {
    const { service, create } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'delete_dashboard', input: { id: 'nope' } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '없네요' }] },
    ]);
    const { emit } = collectEvents();
    await service.chat('s1', '삭제해줘', emit);

    const secondCallMessages = create.mock.calls[1][0].messages;
    const toolResult = secondCallMessages.at(-1).content[0];
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.content).toMatch(/ERROR/);
  });

  it('keeps session history across calls', async () => {
    const { service, create } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '1' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '2' }] },
    ]);
    const { emit } = collectEvents();
    await service.chat('s1', '첫번째', emit);
    await service.chat('s1', '두번째', emit);
    expect(create.mock.calls[1][0].messages.length).toBe(4); // user,assistant,user,assistant→4번째 호출 전 user까지
  });
});
```

(마지막 단언: 두 번째 호출 시점 messages = [user1, assistant1, user2] 3개 + 이번 응답 전이므로 3. 구현 후 실제 값으로 맞춘다 — 히스토리가 누적된다는 것만 검증하면 됨.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- chatService`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: ChatService 구현**

`server/src/ai/chatService.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandTemplate } from '../types.js';
import type { ToolKit } from './tools.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate }
  | { type: 'error'; message: string };

interface Deps {
  client: Anthropic;
  tools: ToolKit;
  store: DashboardStore;
  commands: CommandRegistry;
}

const MAX_TURNS = 8;

export class ChatService {
  private readonly sessions = new Map<string, Anthropic.MessageParam[]>();

  constructor(private readonly deps: Deps) {}

  async chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void> {
    const history = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, history);
    history.push({ role: 'user', content: userMessage });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.deps.client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: await this.systemPrompt(),
        tools: this.deps.tools.definitions,
        messages: history,
      });

      history.push({ role: 'assistant', content: response.content });
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) emit({ type: 'text', text: block.text });
      }
      if (response.stop_reason !== 'tool_use') return;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: await this.runTool(block.name, block.input, emit),
        });
      }
      history.push({ role: 'user', content: results });
    }
    emit({ type: 'error', message: `도구 호출이 ${MAX_TURNS}회를 초과해 중단했습니다.` });
  }

  private async runTool(
    name: string,
    input: unknown,
    emit: (e: ChatEvent) => void,
  ): Promise<string> {
    const handler = this.deps.tools.handlers[name];
    if (!handler) return `ERROR: unknown tool ${name}`;
    try {
      const output = await handler(input);
      emit({ type: 'tool', name, summary: summarize(name, input) });
      if (name === 'register_command') {
        const { pendingId, command } = output as { pendingId: string; command: CommandTemplate };
        emit({ type: 'confirm_request', pendingId, command });
      }
      return JSON.stringify(output ?? 'ok');
    } catch (e) {
      return `ERROR: ${(e as Error).message}`;
    }
  }

  private async systemPrompt(): Promise<string> {
    const dashboards = await this.deps.store.list();
    const commands = this.deps.commands.list();
    return [
      '너는 PE Dashboard 어시스턴트다. 사용자의 요청에 따라 도구를 호출해 대시보드와 위젯을 생성·수정·삭제한다.',
      '그리드는 12컬럼, layout {x,y,w,h}의 h 1칸은 60px. 권장 크기: stat w3 h2, table/chart w6 h5, log w6 h5, text w4 h3.',
      '위젯 display 옵션: stat={metric:"count"|"path", path?:"a.b.c", suffix?:string}, ' +
        'table={columns?:string[]}, chart={xKey:string, yKey:string, chartType?:"line"|"bar"}, ' +
        'text={content:string}.',
      'dataSource.commandId는 반드시 list_commands 결과에 있는 것만 사용한다. ' +
        '출력 구조가 불확실하면 먼저 run_command_preview로 확인한 뒤 위젯을 구성한다.',
      '요청에 맞는 명령 템플릿이 없으면 register_command로 등록을 요청하라 (사용자 승인이 필요하다).',
      '응답은 한국어로 간결하게.',
      `현재 대시보드 상태: ${JSON.stringify(dashboards)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
    ].join('\n');
  }
}

function summarize(name: string, input: unknown): string {
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

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server -- chatService`
Expected: PASS (5 tests). 히스토리 길이 단언이 어긋나면 실제 누적 동작(두 번째 호출의 messages가 첫 대화를 포함)을 검증하도록 수치만 수정.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/chatService.ts server/test/chatService.test.ts
git commit -m "feat: Claude tool-use 채팅 루프 구현 (세션 히스토리, 도구 에러 회수)"
```

---

### Task 8: Fastify 서버 + REST/SSE 라우트

**Files:**
- Create: `server/src/routes/dashboards.ts`, `server/src/routes/commands.ts`, `server/src/routes/widgetData.ts`, `server/src/routes/chat.ts`, `server/src/index.ts`, `server/src/app.ts`
- Test: `server/test/routes.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type AppDeps } from '../src/app.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { DataSourceRegistry } from '../src/datasources/registry.js';
import { CliSource } from '../src/datasources/cliSource.js';

describe('routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let deps: AppDeps;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'app-'));
    const store = new DashboardStore(path.join(dir, 'dashboards'));
    await store.init();
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    const dataSources = new DataSourceRegistry();
    dataSources.register(new CliSource(commands));
    deps = {
      store, commands, dataSources,
      pending: new PendingCommands(),
      chatService: { chat: async () => {} } as never, // chat 라우트는 수동 검증
    };
    app = await buildApp(deps);
  });

  it('dashboard CRUD via REST', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/dashboards', payload: { name: '배포' },
    });
    expect(created.statusCode).toBe(200);
    const dashboard = created.json();

    const list = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(list.json()).toHaveLength(1);

    dashboard.widgets = [{
      id: 'w1', type: 'text', title: '메모',
      layout: { x: 0, y: 0, w: 4, h: 3 }, display: { content: 'hi' },
    }];
    const saved = await app.inject({
      method: 'PUT', url: `/api/dashboards/${dashboard.id}`, payload: dashboard,
    });
    expect(saved.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/dashboards/${dashboard.id}` });
    expect(got.json().widgets).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/dashboards/${dashboard.id}` });
    expect(deleted.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/dashboards/${dashboard.id}` })).statusCode).toBe(404);
  });

  it('GET /api/commands returns templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commands' });
    expect(res.json().map((t: { id: string }) => t.id)).toContain('gh_run_list');
  });

  it('POST /api/widget-data runs a registered command', async () => {
    await deps.commands.register({
      id: 'echo_hi', description: 't',
      argv: ['node', '-e', 'console.log(JSON.stringify({hi:1}))'], params: [],
    });
    const res = await app.inject({
      method: 'POST', url: '/api/widget-data',
      payload: { kind: 'cli', commandId: 'echo_hi', params: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().json).toEqual({ hi: 1 });
  });

  it('POST /api/widget-data rejects unknown command with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/widget-data',
      payload: { kind: 'cli', commandId: 'nope', params: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('pending command confirm registers template; reject discards', async () => {
    const template = { id: 'c1', description: 'd', argv: ['echo', 'x'], params: [] };
    const p1 = deps.pending.add(template);
    const ok = await app.inject({ method: 'POST', url: `/api/commands/pending/${p1}/confirm` });
    expect(ok.statusCode).toBe(200);
    expect(deps.commands.get('c1')).toBeDefined();

    const p2 = deps.pending.add({ ...template, id: 'c2' });
    await app.inject({ method: 'POST', url: `/api/commands/pending/${p2}/reject` });
    expect(deps.commands.get('c2')).toBeUndefined();

    const gone = await app.inject({ method: 'POST', url: `/api/commands/pending/${p2}/confirm` });
    expect(gone.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -w server -- routes`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 라우트 구현**

`server/src/routes/dashboards.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { DashboardStore } from '../dashboardStore.js';
import type { Dashboard } from '../types.js';

export function dashboardRoutes(app: FastifyInstance, store: DashboardStore): void {
  app.get('/api/dashboards', async () => store.list());

  app.post('/api/dashboards', async (req) => {
    const { name } = req.body as { name: string };
    return store.create(name);
  });

  app.get('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dashboard = await store.get(id);
    if (!dashboard) return reply.code(404).send({ error: 'not found' });
    return dashboard;
  });

  // 수동 편집(레이아웃 드래그 등)은 대시보드 전체를 저장
  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.get(id))) return reply.code(404).send({ error: 'not found' });
    const dashboard = req.body as Dashboard;
    await store.save({ ...dashboard, id });
    return { ok: true };
  });

  app.delete('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.delete(id))) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
```

`server/src/routes/commands.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';

export function commandRoutes(
  app: FastifyInstance,
  commands: CommandRegistry,
  pending: PendingCommands,
): void {
  app.get('/api/commands', async () => commands.list());

  app.post('/api/commands/pending/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = pending.take(id);
    if (!template) return reply.code(404).send({ error: 'pending command not found' });
    await commands.register(template);
    return { registered: template.id };
  });

  app.post('/api/commands/pending/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!pending.take(id)) return reply.code(404).send({ error: 'pending command not found' });
    return { rejected: true };
  });
}
```

`server/src/routes/widgetData.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { DataSourceRegistry } from '../datasources/registry.js';
import type { WidgetDataSource } from '../types.js';

export function widgetDataRoutes(app: FastifyInstance, dataSources: DataSourceRegistry): void {
  app.post('/api/widget-data', async (req, reply) => {
    const ds = req.body as WidgetDataSource;
    try {
      return await dataSources.get(ds.kind).fetch(ds);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
```

`server/src/routes/chat.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ChatService, ChatEvent } from '../ai/chatService.js';

export function chatRoutes(app: FastifyInstance, chatService: ChatService): void {
  app.post('/api/chat', async (req, reply) => {
    const { sessionId, message } = req.body as { sessionId: string; message: string };
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const emit = (e: ChatEvent | { type: 'done' }) =>
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

    try {
      await chatService.chat(sessionId, message, emit);
    } catch (e) {
      emit({ type: 'error', message: (e as Error).message } as ChatEvent);
    } finally {
      emit({ type: 'done' });
      reply.raw.end();
    }
  });
}
```

`server/src/app.ts` (조립 — 테스트에서 inject로 사용):

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DashboardStore } from './dashboardStore.js';
import type { CommandRegistry } from './commands/registry.js';
import type { PendingCommands } from './commands/pending.js';
import type { DataSourceRegistry } from './datasources/registry.js';
import type { ChatService } from './ai/chatService.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { commandRoutes } from './routes/commands.js';
import { widgetDataRoutes } from './routes/widgetData.js';
import { chatRoutes } from './routes/chat.js';

export interface AppDeps {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
  dataSources: DataSourceRegistry;
  chatService: ChatService;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors, { origin: true }); // 로컬 전용
  dashboardRoutes(app, deps.store);
  commandRoutes(app, deps.commands, deps.pending);
  widgetDataRoutes(app, deps.dataSources);
  chatRoutes(app, deps.chatService);
  return app;
}
```

`server/src/index.ts`:

```ts
import 'dotenv/config';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { buildApp } from './app.js';
import { DashboardStore } from './dashboardStore.js';
import { CommandRegistry } from './commands/registry.js';
import { PendingCommands } from './commands/pending.js';
import { DataSourceRegistry } from './datasources/registry.js';
import { CliSource } from './datasources/cliSource.js';
import { buildTools } from './ai/tools.js';
import { ChatService } from './ai/chatService.js';

const DATA_DIR = path.resolve(process.cwd(), '../data');
const PORT = 5174;

async function main(): Promise<void> {
  const store = new DashboardStore(path.join(DATA_DIR, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(DATA_DIR, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();

  const dataSources = new DataSourceRegistry();
  dataSources.register(new CliSource(commands));

  const tools = buildTools({ store, commands, pending });
  const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용
  const chatService = new ChatService({ client, tools, store, commands });

  const app = await buildApp({ store, commands, pending, dataSources, chatService });
  await app.listen({ port: PORT });
  console.log(`PE Dashboard server: http://localhost:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -w server && npm run typecheck -w server`
Expected: 전체 PASS

- [ ] **Step 5: 서버 기동 스모크 테스트**

Run: `cp server/.env.example server/.env` 후 API 키 기입(없으면 채팅 외 기능만 동작), `npm run dev -w server` 별도 실행 후:
`curl -s localhost:5174/api/commands | head -c 200`
Expected: 내장 템플릿 JSON 출력. 확인 후 서버 중지.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes server/src/app.ts server/src/index.ts server/test/routes.test.ts
git commit -m "feat: Fastify REST/SSE 라우트 및 서버 부트스트랩"
```

---

### Task 9: 웹 스캐폴딩 (Vite + AntD) + 타입/API 클라이언트

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/types.ts`, `web/src/api.ts`

- [ ] **Step 1: web 패키지 생성**

`web/package.json`:

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ant-design/icons": "^5.5.0",
    "antd": "^5.21.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-grid-layout": "^1.5.0",
    "recharts": "^2.13.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-grid-layout": "^1.3.5",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5174' },
  },
});
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`web/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PE Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 타입 + API 클라이언트 작성**

`web/src/types.ts` — **서버 `server/src/types.ts`의 복사본** (Dashboard, Widget, WidgetType, WidgetLayout, WidgetDataSource, CommandTemplate, CommandResult 동일 정의) + 채팅 이벤트:

```ts
// --- server/src/types.ts 와 동일하게 유지 (수동 동기화) ---
export type WidgetType = 'stat' | 'table' | 'chart' | 'log' | 'text';

export interface WidgetLayout { x: number; y: number; w: number; h: number; }

export interface WidgetDataSource {
  kind: 'cli';
  commandId: string;
  params: Record<string, string>;
  refreshSec?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  layout: WidgetLayout;
  dataSource?: WidgetDataSource;
  display?: Record<string, unknown>;
}

export interface Dashboard { id: string; name: string; widgets: Widget[]; }

export interface CommandTemplate {
  id: string;
  description: string;
  argv: string[];
  params: string[];
  builtin?: boolean;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json?: unknown;
  error?: string;
}
// --- 여기까지 서버와 동일 ---

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate }
  | { type: 'error'; message: string }
  | { type: 'done' };
```

`web/src/api.ts`:

```ts
import type { ChatEvent, CommandResult, Dashboard, WidgetDataSource } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listDashboards: () => fetch('/api/dashboards').then((r) => json<Dashboard[]>(r)),
  getDashboard: (id: string) => fetch(`/api/dashboards/${id}`).then((r) => json<Dashboard>(r)),
  createDashboard: (name: string) =>
    fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => json<Dashboard>(r)),
  saveDashboard: (dashboard: Dashboard) =>
    fetch(`/api/dashboards/${dashboard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dashboard),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteDashboard: (id: string) =>
    fetch(`/api/dashboards/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  widgetData: (ds: WidgetDataSource) =>
    fetch('/api/widget-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ds),
    }).then((r) => json<CommandResult>(r)),

  confirmCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/confirm`, { method: 'POST' }).then((r) => json(r)),
  rejectCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/reject`, { method: 'POST' }).then((r) => json(r)),
};

// POST 기반 SSE: fetch 스트림에서 'data: {...}\n\n' 청크를 파싱해 이벤트 콜백
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as ChatEvent);
    }
  }
}
```

`web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import App from './App';
import 'antd/dist/reset.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={koKR}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
```

(이 시점엔 `App.tsx`가 없으므로 빌드는 Task 10에서 확인)

- [ ] **Step 3: 의존성 설치**

Run: `npm install` (루트)
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat: 웹 스캐폴딩 (Vite+AntD), 타입 및 API/SSE 클라이언트"
```

---

### Task 10: 대시보드 UI (레이아웃, 사이드바, 그리드, 수동 편집)

**Files:**
- Create: `web/src/App.tsx`, `web/src/components/DashboardGrid.tsx`

- [ ] **Step 1: App 레이아웃 작성**

`web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Layout, Menu, Modal, Typography, FloatButton } from 'antd';
import { CommentOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from './api';
import type { Dashboard } from './types';
import DashboardGrid from './components/DashboardGrid';
import ChatDrawer from './components/ChatDrawer';

export default function App() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (selectId?: string) => {
    const list = await api.listDashboards();
    setDashboards(list);
    setSelectedId((prev) => {
      const target = selectId ?? prev;
      return list.some((d) => d.id === target) ? target : list[0]?.id;
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = dashboards.find((d) => d.id === selectedId);

  const createDashboard = async () => {
    if (!newName.trim()) return;
    const d = await api.createDashboard(newName.trim());
    setCreating(false);
    setNewName('');
    await refresh(d.id);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" width={220}>
        <Typography.Title level={4} style={{ padding: '16px 16px 0' }}>
          PE Dashboard
        </Typography.Title>
        <Menu
          mode="inline"
          selectedKeys={selectedId ? [selectedId] : []}
          items={dashboards.map((d) => ({ key: d.id, label: d.name }))}
          onClick={(e) => setSelectedId(e.key)}
        />
        <Button
          type="dashed" icon={<PlusOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: 16 }}
          onClick={() => setCreating(true)}
        >
          새 대시보드
        </Button>
      </Layout.Sider>

      <Layout.Content style={{ padding: 16, background: '#f5f5f5' }}>
        {selected ? (
          <DashboardGrid dashboard={selected} onChanged={() => refresh()} />
        ) : (
          <Empty description="대시보드가 없습니다. 채팅으로 '배포 대시보드 만들어줘'라고 말해보세요." />
        )}
      </Layout.Content>

      <FloatButton
        icon={<CommentOutlined />} type="primary"
        tooltip="AI 채팅" onClick={() => setChatOpen(true)}
      />
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} onDashboardsChanged={refresh} />

      <Modal
        title="새 대시보드" open={creating} onOk={createDashboard}
        onCancel={() => setCreating(false)} okText="만들기" cancelText="취소"
      >
        <Input
          placeholder="이름 (예: 배포 현황)" value={newName} autoFocus
          onChange={(e) => setNewName(e.target.value)} onPressEnter={createDashboard}
        />
      </Modal>
    </Layout>
  );
}
```

- [ ] **Step 2: DashboardGrid 작성**

`web/src/components/DashboardGrid.tsx`:

```tsx
import { useMemo } from 'react';
import GridLayout, { WidthProvider, type Layout as RglItem } from 'react-grid-layout';
import { api } from '../api';
import type { Dashboard } from '../types';
import WidgetCard from './WidgetCard';

const Grid = WidthProvider(GridLayout);

interface Props {
  dashboard: Dashboard;
  onChanged: () => void;
}

export default function DashboardGrid({ dashboard, onChanged }: Props) {
  const layout = useMemo<RglItem[]>(
    () => dashboard.widgets.map((w) => ({ i: w.id, ...w.layout })),
    [dashboard],
  );

  // 드래그/리사이즈 종료 시 대시보드 전체 저장 (수동 편집)
  const handleLayoutChange = async (next: RglItem[]) => {
    const moved = next.some((item) => {
      const w = dashboard.widgets.find((x) => x.id === item.i);
      return w && (w.layout.x !== item.x || w.layout.y !== item.y ||
        w.layout.w !== item.w || w.layout.h !== item.h);
    });
    if (!moved) return;
    const widgets = dashboard.widgets.map((w) => {
      const item = next.find((x) => x.i === w.id);
      return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
    });
    await api.saveDashboard({ ...dashboard, widgets });
    onChanged();
  };

  const removeWidget = async (widgetId: string) => {
    await api.saveDashboard({
      ...dashboard,
      widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
    });
    onChanged();
  };

  return (
    <Grid
      layout={layout} cols={12} rowHeight={60} margin={[12, 12]}
      onDragStop={handleLayoutChange} onResizeStop={handleLayoutChange}
      draggableCancel=".widget-body"
    >
      {dashboard.widgets.map((widget) => (
        <div key={widget.id}>
          <WidgetCard widget={widget} onRemove={() => removeWidget(widget.id)} />
        </div>
      ))}
    </Grid>
  );
}
```

- [ ] **Step 3: 임시 스텁으로 기동 확인**

Task 11 전이므로 `WidgetCard.tsx`/`ChatDrawer.tsx` 최소 스텁 작성:

`web/src/components/WidgetCard.tsx` (Task 11에서 교체):

```tsx
import { Card } from 'antd';
import type { Widget } from '../types';

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  void onRemove;
  return <Card size="small" title={widget.title} style={{ height: '100%' }} />;
}
```

`web/src/components/ChatDrawer.tsx` (Task 12에서 교체):

```tsx
import { Drawer } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
  onDashboardsChanged: () => void;
}

export default function ChatDrawer({ open, onClose }: Props) {
  return <Drawer title="AI 채팅" open={open} onClose={onClose} width={420} />;
}
```

- [ ] **Step 4: 수동 검증**

Run: 터미널1 `npm run dev -w server`, 터미널2 `npm run dev -w web` → 브라우저 `http://localhost:5173`
Expected:
- 사이드바에 "새 대시보드" 버튼, 모달로 생성 가능
- 생성한 대시보드가 메뉴에 보이고 선택됨
- `npm run typecheck -w web` PASS

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: 대시보드 레이아웃 UI (사이드바, 그리드, 수동 편집 저장)"
```

---

### Task 11: 위젯 렌더러 5종 + 데이터 폴링

**Files:**
- Create: `web/src/hooks/useWidgetData.ts`, `web/src/components/widgets/StatWidget.tsx`, `TableWidget.tsx`, `ChartWidget.tsx`, `LogWidget.tsx`, `TextWidget.tsx`
- Modify: `web/src/components/WidgetCard.tsx` (스텁 교체)

- [ ] **Step 1: 데이터 폴링 훅 작성**

`web/src/hooks/useWidgetData.ts`:

```ts
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CommandResult, WidgetDataSource } from '../types';

export function useWidgetData(dataSource?: WidgetDataSource) {
  const [result, setResult] = useState<CommandResult>();
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(dataSource ?? null);

  useEffect(() => {
    if (!dataSource) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = await api.widgetData(dataSource);
        if (alive) setResult(r);
      } catch (e) {
        if (alive) {
          setResult({
            ok: false, exitCode: null, stdout: '', stderr: '', error: (e as Error).message,
          });
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = dataSource.refreshSec
      ? setInterval(load, dataSource.refreshSec * 1000)
      : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result, loading };
}
```

- [ ] **Step 2: 위젯 렌더러 작성**

`web/src/components/widgets/StatWidget.tsx`:

```tsx
import { Statistic } from 'antd';
import type { CommandResult } from '../../types';

interface Display { metric?: 'count' | 'path'; path?: string; suffix?: string; }

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export default function StatWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as Display;
  let value: unknown = '—';
  if (result?.json !== undefined) {
    if (d.metric === 'path' && d.path) value = resolvePath(result.json, d.path);
    else if (Array.isArray(result.json)) value = result.json.length;
    else value = JSON.stringify(result.json).slice(0, 30);
  } else if (result) {
    value = result.stdout.trim().split('\n')[0] || '—';
  }
  return <Statistic value={String(value ?? '—')} suffix={d.suffix} />;
}
```

`web/src/components/widgets/TableWidget.tsx`:

```tsx
import { Table } from 'antd';
import type { CommandResult } from '../../types';

export default function TableWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const rows = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  const columns = (display?.columns as string[] | undefined) ?? Object.keys(rows[0] ?? {});
  return (
    <Table
      size="small" pagination={false} scroll={{ y: '100%' }}
      rowKey={(_, i) => String(i)}
      dataSource={rows}
      columns={columns.map((key) => ({
        title: key, dataIndex: key, key,
        render: (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')),
      }))}
    />
  );
}
```

`web/src/components/widgets/ChartWidget.tsx`:

```tsx
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CommandResult } from '../../types';

interface Display { xKey?: string; yKey?: string; chartType?: 'line' | 'bar'; }

export default function ChartWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as Display;
  const data = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  if (!d.xKey || !d.yKey) return <div>차트 설정(xKey/yKey)이 필요합니다</div>;

  const chart = d.chartType === 'bar' ? (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={d.xKey} /><YAxis /><Tooltip />
      <Bar dataKey={d.yKey} fill="#1677ff" />
    </BarChart>
  ) : (
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={d.xKey} /><YAxis /><Tooltip />
      <Line dataKey={d.yKey} stroke="#1677ff" dot={false} />
    </LineChart>
  );
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}
```

`web/src/components/widgets/LogWidget.tsx`:

```tsx
import type { CommandResult } from '../../types';

export default function LogWidget({ result }: { result?: CommandResult }) {
  const text = result
    ? result.stdout || result.stderr || '(출력 없음)'
    : '';
  return (
    <pre style={{
      margin: 0, height: '100%', overflow: 'auto', fontSize: 12,
      background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 4,
    }}>
      {text}
    </pre>
  );
}
```

`web/src/components/widgets/TextWidget.tsx`:

```tsx
export default function TextWidget({ display }: { display?: Record<string, unknown> }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>{String(display?.content ?? '')}</div>
  );
}
```

- [ ] **Step 3: WidgetCard 스텁 교체**

`web/src/components/WidgetCard.tsx` 전체 교체:

```tsx
import { Alert, Card, Popconfirm, Spin } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Widget } from '../types';
import { useWidgetData } from '../hooks/useWidgetData';
import StatWidget from './widgets/StatWidget';
import TableWidget from './widgets/TableWidget';
import ChartWidget from './widgets/ChartWidget';
import LogWidget from './widgets/LogWidget';
import TextWidget from './widgets/TextWidget';

export default function WidgetCard({ widget, onRemove }: {
  widget: Widget;
  onRemove: () => void;
}) {
  const { result, loading } = useWidgetData(widget.dataSource);

  const body = (() => {
    if (widget.type === 'text') return <TextWidget display={widget.display} />;
    if (result?.error) {
      return <Alert type="warning" showIcon message={result.error} style={{ fontSize: 12 }} />;
    }
    switch (widget.type) {
      case 'stat': return <StatWidget result={result} display={widget.display} />;
      case 'table': return <TableWidget result={result} display={widget.display} />;
      case 'chart': return <ChartWidget result={result} display={widget.display} />;
      case 'log': return <LogWidget result={result} />;
    }
  })();

  return (
    <Card
      size="small" title={widget.title}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { flex: 1, overflow: 'hidden' } }}
      extra={
        <span>
          {loading && <Spin size="small" style={{ marginRight: 8 }} />}
          {!loading && widget.dataSource && <ReloadOutlined style={{ marginRight: 8, opacity: 0.4 }} />}
          <Popconfirm title="위젯을 삭제할까요?" onConfirm={onRemove} okText="삭제" cancelText="취소">
            <DeleteOutlined />
          </Popconfirm>
        </span>
      }
    >
      <div className="widget-body" style={{ height: '100%', overflow: 'auto' }}>{body}</div>
    </Card>
  );
}
```

- [ ] **Step 4: 수동 검증**

서버·웹 dev 실행 상태에서, 대시보드 JSON을 직접 만들어 렌더링 확인:

```bash
curl -s -X POST localhost:5174/api/dashboards -H 'Content-Type: application/json' -d '{"name":"렌더 테스트"}'
# 응답의 id로:
curl -s -X PUT localhost:5174/api/dashboards/<id> -H 'Content-Type: application/json' -d '{
  "id":"<id>","name":"렌더 테스트","widgets":[
    {"id":"w1","type":"log","title":"git log","layout":{"x":0,"y":0,"w":6,"h":5},
     "dataSource":{"kind":"cli","commandId":"git_log","params":{"repoPath":"."},"refreshSec":60}},
    {"id":"w2","type":"text","title":"메모","layout":{"x":6,"y":0,"w":4,"h":3},
     "display":{"content":"PE 대시보드 테스트"}}]}'
```

Expected: 브라우저에서 log 위젯에 커밋 로그, text 위젯에 메모 표시. 드래그 이동 후 새로고침해도 위치 유지(파일 저장 확인). 위젯 삭제 동작. `npm run typecheck -w web` PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: 위젯 렌더러 5종 및 주기 폴링 데이터 훅 구현"
```

---

### Task 12: AI 채팅 Drawer (SSE, 액션 칩, 명령 등록 확인)

**Files:**
- Modify: `web/src/components/ChatDrawer.tsx` (스텁 교체)

- [ ] **Step 1: ChatDrawer 구현**

`web/src/components/ChatDrawer.tsx` 전체 교체:

```tsx
import { useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Space, Tag, Typography, message as antdMessage } from 'antd';
import { CheckOutlined, CloseOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons';
import { api, streamChat } from '../api';
import type { ChatEvent, CommandTemplate } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onDashboardsChanged: () => void;
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; summary: string }
  | { kind: 'confirm'; pendingId: string; command: CommandTemplate; resolved?: 'ok' | 'no' }
  | { kind: 'error'; text: string };

const SESSION_ID = `s-${Date.now()}`;

export default function ChatDrawer({ open, onClose, onDashboardsChanged }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const push = (item: Item) =>
    setItems((prev) => {
      const next = [...prev, item];
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      return next;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push({ kind: 'user', text });
    setBusy(true);
    try {
      await streamChat(SESSION_ID, text, (e: ChatEvent) => {
        if (e.type === 'text') push({ kind: 'assistant', text: e.text });
        if (e.type === 'tool') {
          push({ kind: 'tool', summary: e.summary });
          onDashboardsChanged(); // 도구 실행마다 메인 대시보드 실시간 갱신
        }
        if (e.type === 'confirm_request') {
          push({ kind: 'confirm', pendingId: e.pendingId, command: e.command });
        }
        if (e.type === 'error') push({ kind: 'error', text: e.message });
      });
    } catch (e) {
      push({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const resolveConfirm = async (pendingId: string, accept: boolean) => {
    try {
      if (accept) await api.confirmCommand(pendingId);
      else await api.rejectCommand(pendingId);
      setItems((prev) =>
        prev.map((it) =>
          it.kind === 'confirm' && it.pendingId === pendingId
            ? { ...it, resolved: accept ? 'ok' : 'no' }
            : it,
        ),
      );
      antdMessage.success(accept ? '명령이 등록되었습니다' : '등록을 거절했습니다');
    } catch (e) {
      antdMessage.error((e as Error).message);
    }
  };

  return (
    <Drawer title="AI 채팅" placement="right" width={420} open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 12 }}>
          {items.length === 0 && (
            <Typography.Paragraph type="secondary">
              예: "배포 현황 대시보드 만들고 argocd 앱 목록 테이블 넣어줘"
            </Typography.Paragraph>
          )}
          {items.map((item, i) => {
            switch (item.kind) {
              case 'user':
                return (
                  <p key={i} style={{ textAlign: 'right' }}>
                    <Tag color="blue" style={{ whiteSpace: 'pre-wrap' }}>{item.text}</Tag>
                  </p>
                );
              case 'assistant':
                return (
                  <Typography.Paragraph key={i} style={{ whiteSpace: 'pre-wrap' }}>
                    {item.text}
                  </Typography.Paragraph>
                );
              case 'tool':
                return (
                  <p key={i}>
                    <Tag icon={<ToolOutlined />} color="green">{item.summary}</Tag>
                  </p>
                );
              case 'confirm':
                return (
                  <Alert
                    key={i} type="info" showIcon
                    message={`명령 등록 요청: ${item.command.id}`}
                    description={
                      <>
                        <code>{item.command.argv.join(' ')}</code>
                        <div style={{ marginTop: 8 }}>
                          {item.resolved ? (
                            <Tag>{item.resolved === 'ok' ? '등록됨' : '거절됨'}</Tag>
                          ) : (
                            <Space>
                              <Button
                                size="small" type="primary" icon={<CheckOutlined />}
                                onClick={() => resolveConfirm(item.pendingId, true)}
                              >
                                승인
                              </Button>
                              <Button
                                size="small" icon={<CloseOutlined />}
                                onClick={() => resolveConfirm(item.pendingId, false)}
                              >
                                거절
                              </Button>
                            </Space>
                          )}
                        </div>
                      </>
                    }
                    style={{ marginBottom: 8 }}
                  />
                );
              case 'error':
                return <Alert key={i} type="error" message={item.text} style={{ marginBottom: 8 }} />;
            }
          })}
          <div ref={bottomRef} />
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={busy ? 'AI 작업 중…' : '말로 대시보드를 만들어보세요'}
            value={input} disabled={busy}
            onChange={(e) => setInput(e.target.value)} onPressEnter={send}
          />
          <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={send} />
        </Space.Compact>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck -w web`
Expected: PASS

- [ ] **Step 3: E2E 수동 검증 (실제 Claude API)**

`server/.env`에 `ANTHROPIC_API_KEY` 설정 후 서버·웹 dev 실행:

1. 채팅: "배포 현황 대시보드 만들어줘" → 사이드바에 새 대시보드, 채팅에 초록 액션 칩
2. "거기에 이 저장소 git log 위젯 추가해줘. 경로는 /Users/.../pe-dashboard" → log 위젯 등장
3. "kubectl config current-context 보여주는 명령 등록해줘" → 승인 버튼 표시 → 승인 → "그걸로 stat 위젯 추가해줘"
4. 위젯 드래그로 옮긴 뒤 "위젯 제목을 'XX'로 바꿔줘" → 위치 유지된 채 제목만 변경(수동 편집 보존 확인)

Expected: 4가지 모두 동작. 문제 발생 시 superpowers:systematic-debugging 스킬로 원인 규명 후 수정.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatDrawer.tsx
git commit -m "feat: AI 채팅 drawer (SSE 스트림, 도구 액션 칩, 명령 등록 승인 플로우)"
```

---

### Task 13: README + 최종 검증

**Files:**
- Create: `README.md`

- [ ] **Step 1: README 작성**

`README.md`:

```markdown
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

- `server/` Fastify + TS — 대시보드 JSON CRUD, 화이트리스트 CLI 실행, Claude tool-use 루프
- `web/` React + AntD — 그리드 대시보드(수동 편집 가능) + AI 채팅 drawer
- `data/` 대시보드/커스텀 명령 저장 (JSON 파일)

## 확장 포인트

- 데이터 소스: `server/src/datasources/` 에 `DataSource` 구현 추가 (postgres, http…)
- 위젯 타입: `web/src/components/widgets/` + `server/src/types.ts`의 `WidgetType`
- AI 도구: `server/src/ai/tools.ts`의 definitions/handlers에 쌍 추가

## 보안 메모

등록된 명령 템플릿만 실행된다(셸 미사용, argv spawn, 파라미터 문자 검증).
AI의 신규 명령 등록은 채팅창에서 사용자가 승인해야 반영된다.
```

- [ ] **Step 2: 전체 테스트·타입체크 최종 실행**

Run: `npm test -w server && npm run typecheck -w server && npm run typecheck -w web`
Expected: 전체 PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README 및 빠른 시작 가이드"
```

---

## Self-Review 결과

- **스펙 커버리지**: 멀티 대시보드(T2,T8,T10) / AI 채팅 drawer·tool-use(T6,T7,T12) / CLI 화이트리스트·argv spawn·10초 타임아웃(T3,T4) / 5종 위젯·폴링(T11) / 수동 편집 보존(T10) / register_command 승인(T6,T8,T12) / 원자적 쓰기(T2,T3) / 친절한 에러(T4,T11) — 모두 매핑됨.
- **스펙과 차이**: text 위젯은 1단계에서 마크다운 렌더링 대신 plain text(`display.content`)로 단순화 (마크다운 라이브러리는 추후). 스펙의 "마크다운 메모"는 메모 기능 자체가 본질이므로 허용 범위로 판단.
- **타입 일관성**: `CommandResult`/`Widget`/`ChatEvent`가 서버·웹에서 동일 형태로 사용됨을 확인. `ToolKit.handlers` 시그니처와 ChatService 호출 일치.
```
