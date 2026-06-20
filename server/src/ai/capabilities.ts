import type Anthropic from '@anthropic-ai/sdk';

// AI 능력(capability)의 단일 출처. 한 능력의 외부 계약 — 이름·변경성(mutating)·도구 schema·
// 채팅 칩 요약 — 을 한 엔트리에 모은다. 실행 로직(handler)은 tools.ts가 갖고, buildTools가
// 이 카탈로그와 핸들러를 이름으로 맞춰 조립한다(불일치 시 즉시 실패).
//
// 능력을 추가/변경할 때: ① 여기 엔트리 ② tools.ts의 handler 둘만 손대면 된다.
// 변경성 분류·요약이 따로 흩어져 드리프트하던 문제(describe.ts·MUTATING_TOOLS 별도 관리)를 없앤다.
// ⚠️ ClaudeCliAdapter의 프롬프트 산문(operationsFormat)은 모델 동작에 직결돼 여기서 생성하지 않는다 —
//    능력을 늘리면 그 산문도 함께 갱신할 것.

export interface Capability {
  name: string;
  // 조회 전용 모드(AI_READONLY)에서 정의를 숨기고 핸들러를 차단한다.
  mutating: boolean;
  definition: Anthropic.Tool;
  // 도구 호출을 채팅 액션 칩에 표시할 한국어 한 줄 요약.
  describe: (input: unknown) => string;
  // 변경성 능력의 프롬프트 출력 예시(operations[] 한 항목, 들여쓰기·쉼표 없는 원형).
  // claudeCliAdapter 프롬프트가 이 값들을 모아 operations 예시 블록을 생성한다.
  promptExample?: string;
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

const alertSchema = {
  type: 'object' as const,
  properties: {
    on: { type: 'string', enum: ['fail', 'contains'] },
    pattern: { type: 'string', description: 'on=contains일 때 출력에서 찾을 문자열' },
  },
  required: ['on'],
};

// describe 헬퍼: 입력은 모델이 생성한 JSON이라 형태가 느슨하다.
const rec = (input: unknown): Record<string, unknown> => (input ?? {}) as Record<string, unknown>;
const byName = (n: string): string => n; // 별도 요약이 없는 능력은 이름 그대로

export const CAPABILITIES: Capability[] = [
  {
    name: 'list_dashboards',
    mutating: false,
    definition: {
      name: 'list_dashboards',
      description: '모든 대시보드와 위젯 목록을 조회한다.',
      input_schema: { type: 'object', properties: {} },
    },
    describe: () => byName('list_dashboards'),
  },
  {
    name: 'create_dashboard',
    mutating: true,
    definition: {
      name: 'create_dashboard',
      description: '새 대시보드를 만든다.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', description: '대시보드 이름' } },
        required: ['name'],
      },
    },
    promptExample: '{"op":"create_dashboard","name":"이름"}',
    describe: (input) => `대시보드 '${String(rec(input)['name'])}' 생성`,
  },
  {
    name: 'delete_dashboard',
    mutating: true,
    definition: {
      name: 'delete_dashboard',
      description: '대시보드를 삭제한다.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    promptExample: '{"op":"delete_dashboard","id":"대시보드ID"}',
    describe: (input) => `대시보드 삭제 (${String(rec(input)['id'])})`,
  },
  {
    name: 'add_widget',
    mutating: true,
    definition: {
      name: 'add_widget',
      description: '대시보드에 위젯을 추가한다. dataSource.commandId는 list_commands에 있는 것만 사용.',
      input_schema: {
        type: 'object',
        properties: { dashboardId: { type: 'string' }, widget: widgetSchema },
        required: ['dashboardId', 'widget'],
      },
    },
    promptExample: '{"op":"add_widget","dashboardId":"대시보드ID 또는 $last","widget":{"type":"stat|table|chart|log|text|status","title":"제목","layout":{"x":0,"y":0,"w":3,"h":2},"dataSource":{"kind":"cli","commandId":"명령ID","params":{},"refreshSec":30},"display":{}}}',
    describe: (input) => `위젯 '${String((rec(input)['widget'] as Record<string, unknown>)?.['title'])}' 추가`,
  },
  {
    name: 'update_widget',
    mutating: true,
    definition: {
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
    promptExample: '{"op":"update_widget","dashboardId":"...","widgetId":"...","patch":{}}',
    describe: (input) => `위젯 수정 (${String(rec(input)['widgetId'])})`,
  },
  {
    name: 'remove_widget',
    mutating: true,
    definition: {
      name: 'remove_widget',
      description: '위젯을 삭제한다.',
      input_schema: {
        type: 'object',
        properties: { dashboardId: { type: 'string' }, widgetId: { type: 'string' } },
        required: ['dashboardId', 'widgetId'],
      },
    },
    promptExample: '{"op":"remove_widget","dashboardId":"...","widgetId":"..."}',
    describe: (input) => `위젯 삭제 (${String(rec(input)['widgetId'])})`,
  },
  {
    name: 'set_alert',
    mutating: true,
    definition: {
      name: 'set_alert',
      description:
        "위젯에 조건 알림을 설정한다. on='fail'은 명령 실패 시, on='contains'는 출력에 pattern 포함 시 알림. " +
        '알림을 끄려면 alert를 null로 보낸다.',
      input_schema: {
        type: 'object',
        properties: {
          dashboardId: { type: 'string' },
          widgetId: { type: 'string' },
          alert: { anyOf: [alertSchema, { type: 'null' }] },
        },
        required: ['dashboardId', 'widgetId', 'alert'],
      },
    },
    promptExample: '{"op":"set_alert","dashboardId":"...","widgetId":"...","alert":{"on":"fail"|"contains","pattern":"포함문자열"}}',
    describe: () => byName('set_alert'),
  },
  {
    name: 'list_commands',
    mutating: false,
    definition: {
      name: 'list_commands',
      description: '위젯 dataSource로 사용 가능한 CLI 명령 템플릿 목록을 조회한다.',
      input_schema: { type: 'object', properties: {} },
    },
    describe: () => byName('list_commands'),
  },
  {
    name: 'run_command_preview',
    mutating: false,
    definition: {
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
    describe: (input) => `명령 미리 실행 (${String(rec(input)['commandId'])})`,
  },
  {
    name: 'register_command',
    mutating: true,
    definition: {
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
    promptExample: '{"op":"register_command","id":"...","description":"...","argv":["cmd","{param}"],"params":["param"]}',
    describe: (input) => `명령 '${String(rec(input)['id'])}' 등록 요청`,
  },
];

const BY_NAME = new Map(CAPABILITIES.map((c) => [c.name, c]));

// 조회 전용 모드에서 숨기고 차단할 변경성 능력 이름 집합 (카탈로그에서 파생 — 단일 출처).
export const MUTATING_CAPABILITIES = new Set(
  CAPABILITIES.filter((c) => c.mutating).map((c) => c.name),
);

// 도구 호출을 채팅 액션 칩용 한국어 한 줄 요약으로 변환한다. 미등록 이름은 이름 그대로.
export function describeCapability(name: string, input: unknown): string {
  return BY_NAME.get(name)?.describe(input) ?? name;
}

// claudeCliAdapter 프롬프트의 operations 예시 줄을 카탈로그에서 생성한다(변경성 능력 추가 시 자동 반영).
// 출력은 기존 하드코딩 텍스트와 동일 — capabilities.test의 골든 스냅샷이 보증한다.
export function buildOperationExamples(): string[] {
  const examples = CAPABILITIES.filter((c) => c.mutating && c.promptExample).map((c) => c.promptExample!);
  return examples.map((e, i) => `  ${e}${i < examples.length - 1 ? ',' : ''}`);
}
