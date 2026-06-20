import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import { type CommandRegistry, validateTemplate } from '../commands/registry.js';
import { assessArgv } from '../commands/safety.js';
import type { PendingCommands } from '../commands/pending.js';
import { runArgv } from '../commands/runner.js';
import { maskSecrets } from '../commands/auditLog.js';
import type { Widget } from '../types.js';
import { CAPABILITIES, MUTATING_CAPABILITIES } from './capabilities.js';

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

// 능력의 외부 계약(정의·변경성·요약)은 capabilities.ts가 단일 출처로 갖고,
// 여기서는 실행(handler)만 정의한 뒤 이름으로 맞춰 조립한다.
// 확장: 능력을 추가하려면 capabilities.ts 엔트리 + 아래 handler를 함께 추가한다(이름 1:1).
export function buildTools(ctx: ToolContext, opts: { readOnly?: boolean } = {}): ToolKit {
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

    set_alert: async (input: { dashboardId: string; widgetId: string; alert: Widget['alert'] | null }) => {
      // null이면 해제 → undefined로 저장 시 제거
      return ctx.store.updateWidget(input.dashboardId, input.widgetId, { alert: input.alert ?? undefined });
    },

    list_commands: async () => ctx.commands.list(),

    run_command_preview: async (input: { commandId: string; params: Record<string, string> }) => {
      const argv = ctx.commands.buildArgv(input.commandId, input.params);
      const result = await runArgv(argv);
      return {
        ok: result.ok,
        error: result.error,
        // stdout은 AI(프롬프트)로 가므로 비밀값을 가린다 (stderr는 runner가 이미 마스킹)
        stdout: maskSecrets(result.stdout).slice(0, 2000),
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

  // 카탈로그(외부 계약)와 핸들러(구현)가 정확히 1:1인지 보장 — 한쪽만 추가하면 즉시 드러난다.
  const catalogNames = CAPABILITIES.map((c) => c.name).sort().join(',');
  const handlerNames = Object.keys(handlers).sort().join(',');
  if (catalogNames !== handlerNames) {
    throw new Error(`capability/handler 불일치: catalog=[${catalogNames}] handlers=[${handlerNames}]`);
  }

  const definitions = CAPABILITIES.map((c) => c.definition);

  if (opts.readOnly) {
    // 정의에서 변경성 도구를 숨기고, 핸들러는 차단 메시지를 던지도록 교체한다
    // (모델이 그래도 변경을 시도하는 경우의 이중 방어).
    const blocked = async () => {
      throw new Error('조회 전용 모드: 변경 작업이 비활성화되어 있습니다 (서버 환경변수 AI_READONLY=false로 해제 가능)');
    };
    return {
      definitions: definitions.filter((d) => !MUTATING_CAPABILITIES.has(d.name)),
      handlers: Object.fromEntries(
        Object.entries(handlers).map(([name, h]) => [name, MUTATING_CAPABILITIES.has(name) ? blocked : h]),
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
