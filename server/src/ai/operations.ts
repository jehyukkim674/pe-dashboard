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
