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
