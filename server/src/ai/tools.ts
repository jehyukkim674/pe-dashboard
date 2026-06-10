import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import { type CommandRegistry, validateTemplate } from '../commands/registry.js';
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
    params: { type: 'object', additionalProperties: { type: 'string' } },
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
      validateTemplate({ ...input, builtin: false });
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
