export type WidgetType = 'stat' | 'table' | 'chart' | 'log' | 'text' | 'status';

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDataSource {
  kind: 'cli' | 'http' | 'postgres';
  commandId: string; // http일 때는 빈 문자열
  params: Record<string, string>;
  url?: string; // kind=http 전용
  httpProfile?: string; // kind=http: 인증 헤더 프로필 이름 (헤더 값은 서버에만 저장)
  profile?: string; // kind=postgres: 연결 프로필 이름 (연결 문자열은 서버에만 저장)
  query?: string; // kind=postgres: SELECT 쿼리
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
  dataSource?: WidgetDataSource; // text 위젯은 없음
  display?: Record<string, unknown>;
  alert?: WidgetAlert;
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
