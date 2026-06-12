import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import { type CommandRegistry, validateTemplate } from '../commands/registry.js';
import { assessArgv } from '../commands/safety.js';
import type { PendingCommands } from '../commands/pending.js';
import { runArgv } from '../commands/runner.js';
import type { Widget } from '../types.js';

export interface ToolContext {
  store: DashboardStore;
  commands: CommandRegistry;
  pending: PendingCommands;
}

export interface ToolKit {
  definitions: Anthropic.Tool[];
  // 입력은 모델이 생성한 JSON이라 핸들러마다 형태가 다르다 — 의도된 any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    kind: { type: 'string', enum: ['cli', 'http', 'postgres'] },
    commandId: { type: 'string' },
    params: { type: 'object', additionalProperties: { type: 'string' } },
    url: { type: 'string' },
    profile: { type: 'string' },
    query: { type: 'string' },
    refreshSec: { type: 'number' },
  },
  required: ['kind', 'commandId', 'params'],
};

const widgetSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: ['stat', 'table', 'chart', 'log', 'text', 'status'] },
    title: { type: 'string' },
    layout: layoutSchema,
    dataSource: dataSourceSchema,
    display: { type: 'object' },
  },
  required: ['type', 'title', 'layout'],
};

// 조회 전용 모드에서 차단되는 변경성 도구. 새 변경성 도구를 추가하면 여기에도 등록한다.
const MUTATING_TOOLS = new Set([
  'create_dashboard', 'delete_dashboard', 'add_widget', 'update_widget',
  'remove_widget', 'register_command',
]);

// 확장 포인트: 이 배열에 정의+핸들러 쌍을 추가하면 AI 능력이 늘어난다.
export function buildTools(ctx: ToolContext, opts: { readOnly?: boolean } = {}): ToolKit {
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
        properties: {
          commandId: { type: 'string' },
          params: { type: 'object', additionalProperties: { type: 'string' } },
        },
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

    create_dashboard: async (input: { name: string }) => {
      if (!input.name || typeof input.name !== 'string') throw new Error('name is required');
      return ctx.store.create(input.name);
    },

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
      validateTemplate({ ...input, builtin: false }); // 파괴적 명령(block)은 여기서 거부됨
      const pendingId = ctx.pending.add({ ...input, builtin: false });
      // warn 레벨이면 승인 UI에 경고를 띄워 사용자가 판단하게 한다
      const safety = assessArgv(input.argv);
      return {
        pendingId,
        status: 'pending_confirmation',
        command: input,
        warning: safety.level === 'warn' ? safety.reason : undefined,
      };
    },
  };

  if (opts.readOnly) {
    // 정의에서 변경성 도구를 숨기고, 핸들러는 차단 메시지를 던지도록 교체한다
    // (모델이 그래도 변경을 시도하는 경우의 이중 방어).
    const blocked = async () => {
      throw new Error('조회 전용 모드: 변경 작업이 비활성화되어 있습니다 (서버 환경변수 AI_READONLY=false로 해제 가능)');
    };
    return {
      definitions: definitions.filter((d) => !MUTATING_TOOLS.has(d.name)),
      handlers: Object.fromEntries(
        Object.entries(handlers).map(([name, h]) => [name, MUTATING_TOOLS.has(name) ? blocked : h]),
      ),
    };
  }
  return { definitions, handlers };
}

function validateDataSource(ctx: ToolContext, widget: Partial<Widget>): void {
  const ds = widget.dataSource;
  if (!ds) return;
  // cli 소스만 명령 검증 — http/postgres는 각 소스가 실행 시 검증한다
  if (ds.kind === 'cli') ctx.commands.buildArgv(ds.commandId, ds.params);
}
