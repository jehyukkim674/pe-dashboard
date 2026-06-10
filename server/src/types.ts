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
