import type { ToolKit } from './tools.js';
import type { ChatEvent } from './adapter.js';
import type { PendingCommands } from '../commands/pending.js';
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

// 작업에서 참조하는 명령 템플릿 id (위젯 데이터소스 기준)
function commandIdOf(operation: Operation): string | undefined {
  if (operation.op === 'add_widget') return operation.widget.dataSource?.commandId;
  if (operation.op === 'update_widget') return operation.patch.dataSource?.commandId;
  return undefined;
}

// 작업 목록을 기존 AI 도구 핸들러로 순차 적용한다. 한 작업이 실패해도 나머지는 계속.
// 같은 응답에서 register_command로 등록 요청한 명령을 쓰는 위젯 작업은 즉시 실행하면
// "unknown command"로 실패하므로, 승인 대기(pending)에 붙여 승인 시 함께 적용한다.
export async function applyOperations(
  operations: Operation[],
  toolkit: ToolKit,
  emit: (e: ChatEvent) => void,
  pending?: PendingCommands,
): Promise<void> {
  let lastDashboardId: string | undefined;
  const requestedCommands = new Set(
    operations.filter((op) => op.op === 'register_command').map((op) => op.id),
  );
  const pendingIdByCommand = new Map<string, string>();

  for (const operation of operations) {
    // 이번 응답에서 등록 요청된 명령에 의존하는 작업 → 승인 후 적용으로 보류
    const dependsOn = commandIdOf(operation);
    if (dependsOn && requestedCommands.has(dependsOn) && pending) {
      const pendingId = pendingIdByCommand.get(dependsOn);
      // 보류 후 적용 시점에는 $last를 알 수 없으므로 지금 해석해 둔다
      const resolved =
        'dashboardId' in operation && operation.dashboardId === LAST_DASHBOARD && lastDashboardId
          ? { ...operation, dashboardId: lastDashboardId }
          : operation;
      if (pendingId && pending.attach(pendingId, [resolved])) {
        emit({
          type: 'tool',
          name: 'deferred',
          summary: `'${dependsOn}' 명령 승인 시 위젯이 자동 적용됩니다`,
        });
        continue;
      }
    }

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
        const { pendingId, command, warning } = output as {
          pendingId: string;
          command: CommandTemplate;
          warning?: string;
        };
        pendingIdByCommand.set(operation.id, pendingId);
        emit({ type: 'confirm_request', pendingId, command, warning });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message: `작업 실패 (${operation.op}): ${message}` });
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
    case 'register_command':
      return {
        name: 'register_command',
        input: {
          id: operation.id,
          description: operation.description,
          argv: operation.argv,
          params: operation.params,
        },
      };
    default:
      return undefined;
  }
}
