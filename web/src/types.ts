// --- server/src/types.ts 와 동일하게 유지 (수동 동기화) ---
export type WidgetType = 'stat' | 'table' | 'chart' | 'log' | 'text';

export interface WidgetLayout { x: number; y: number; w: number; h: number; }

export interface WidgetDataSource {
  kind: 'cli' | 'http';
  commandId: string; // http일 때는 빈 문자열
  params: Record<string, string>;
  url?: string; // kind=http 전용
  refreshSec?: number;
}

// 위젯 조건 알림: fail=명령 실패 시, contains=출력에 pattern 포함 시
export interface WidgetAlert {
  on: 'fail' | 'contains';
  pattern?: string;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  layout: WidgetLayout;
  dataSource?: WidgetDataSource;
  display?: Record<string, unknown>;
  alert?: WidgetAlert;
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

// ChatEvent는 server/src/ai/chatService.ts 기준 ('done' 이벤트는 chat.ts 라우트가 추가)
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; stage: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate; warning?: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
