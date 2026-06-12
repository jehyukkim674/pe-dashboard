import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandResult, Dashboard } from '../types.js';
import { runArgv } from '../commands/runner.js';
import { ResultCache } from '../commands/resultCache.js';
import type { ToolKit } from './tools.js';
import type { ChatAdapter, ChatContext, ChatEvent } from './adapter.js';
import { applyOperations, type Operation } from './operations.js';

const CLI_TIMEOUT_MS = 120_000;
const MAX_HISTORY_TURNS = 10;
const MAX_SESSIONS = 20;
const WIDGET_DATA_TIMEOUT_MS = 10_000;
const WIDGET_DATA_MAX_CHARS = 1_500; // 위젯당 프롬프트에 넣는 데이터 상한
const MAX_CONTEXT_WIDGETS = 8;

// 읽기 전용 도구만 승인 없이 허용하고, 파일 변경·임의 명령 실행 도구는 차단한다.
// -p(print) 모드에서 allowedTools에 없는 도구는 권한 프롬프트 없이 거부되므로
// 채팅이 멈추지 않으면서도 시스템을 변경할 수 없다.
const READONLY_CLI_FLAGS = [
  '--allowedTools', 'Read,Glob,Grep',
  '--disallowedTools', 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch',
];

type Exec = (argv: string[], timeoutMs?: number, signal?: AbortSignal) => Promise<CommandResult>;

interface Deps {
  store: DashboardStore;
  commands: CommandRegistry;
  toolkit: ToolKit;
  exec?: Exec; // 테스트 주입용. 기본 runArgv
  readOnly?: boolean; // 조회 전용 모드: AI의 변경 작업(operations)을 적용하지 않는다
  cache?: ResultCache; // 위젯 데이터 캐시. CliSource와 공유하면 화면 컨텍스트가 재실행을 피한다
}

interface Turn {
  user: string;
  reply: string;
}

// Claude를 API 대신 로컬 claude CLI(Claude Code 로그인 사용)로 호출하는 어댑터.
// 채팅 1회 = `claude -p <프롬프트> --output-format json` 1회. 멀티턴은 요약 히스토리로 근사.
export class ClaudeCliAdapter implements ChatAdapter {
  private readonly history = new Map<string, Turn[]>();
  private readonly exec: Exec;
  private readonly cache: ResultCache;

  constructor(private readonly deps: Deps) {
    this.exec = deps.exec ?? runArgv;
    this.cache = deps.cache ?? new ResultCache();
  }

  async chat(
    sessionId: string,
    userMessage: string,
    emit: (e: ChatEvent) => void,
    context?: ChatContext,
  ): Promise<void> {
    if (context?.dashboardId) emit({ type: 'status', stage: '화면 위젯 데이터 수집 중…' });
    const prompt = await this.buildPrompt(sessionId, userMessage, context);

    emit({ type: 'status', stage: 'AI 응답 생성 중…' });
    const result = await this.exec(
      ['claude', '-p', prompt, '--output-format', 'json', ...READONLY_CLI_FLAGS],
      CLI_TIMEOUT_MS,
      context?.signal, // 클라이언트가 끊으면 claude 프로세스도 종료
    );
    if (context?.signal?.aborted) return; // 받을 사람이 없으니 조용히 종료

    if (!result.ok) {
      const base = result.error ?? 'claude CLI 실행에 실패했습니다';
      const hint = base.includes('찾을 수 없습니다')
        ? ' Claude Code CLI 설치가 필요합니다 (https://claude.com/claude-code).'
        : '';
      emit({ type: 'error', message: base + hint });
      return;
    }

    const envelopeText = (result.json as { result?: string } | undefined)?.result ?? result.stdout;
    let parsed: { reply?: string; operations?: Operation[] };
    try {
      parsed = extractJson(envelopeText);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit({
        type: 'error',
        message: `응답 파싱 실패: ${message} — 원문: ${envelopeText.slice(0, 200)}`,
      });
      return;
    }

    if (parsed.reply) emit({ type: 'text', text: parsed.reply });
    const operations = parsed.operations ?? [];
    if (this.deps.readOnly && operations.length > 0) {
      emit({ type: 'error', message: '조회 전용 모드라 변경 작업은 적용하지 않았습니다.' });
    } else {
      await applyOperations(operations, this.deps.toolkit, emit);
    }
    this.remember(sessionId, userMessage, parsed.reply ?? '');
  }

  private remember(sessionId: string, user: string, reply: string): void {
    const turns = this.history.get(sessionId) ?? [];
    turns.push({ user, reply });
    while (turns.length > MAX_HISTORY_TURNS) turns.shift();
    this.history.set(sessionId, turns);
    // 오래된 세션부터 제거 (Map은 삽입 순서 유지)
    while (this.history.size > MAX_SESSIONS) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }

  private async buildPrompt(
    sessionId: string,
    userMessage: string,
    context?: ChatContext,
  ): Promise<string> {
    const dashboards = await this.deps.store.list();
    const commands = this.deps.commands.list();
    const turns = this.history.get(sessionId) ?? [];
    const historyText = turns.map((t) => `사용자: ${t.user}\n어시스턴트: ${t.reply}`).join('\n');
    // 잘못된 id(스토어가 throw)나 삭제된 대시보드는 화면 컨텍스트 없이 진행한다.
    const current = context?.dashboardId
      ? await this.deps.store.get(context.dashboardId).catch(() => undefined)
      : undefined;
    const screenText = current ? await this.screenContext(current) : '';

    const operationsFormat = this.deps.readOnly
      ? [
          '출력 포맷:',
          '{"reply":"사용자에게 보여줄 한국어 답변","operations":[]}',
          '',
          '규칙:',
          '- 지금은 "조회 전용 모드"다. operations는 반드시 빈 배열로 둔다.',
          '- 대시보드 생성·수정·삭제 요청이 오면 조회 전용 모드라 변경할 수 없다고 reply로 안내한다.',
        ]
      : [
          '출력 포맷:',
          '{"reply":"사용자에게 보여줄 한국어 답변","operations":[',
          '  {"op":"create_dashboard","name":"이름"},',
          '  {"op":"delete_dashboard","id":"대시보드ID"},',
          '  {"op":"add_widget","dashboardId":"대시보드ID 또는 $last","widget":{"type":"stat|table|chart|log|text","title":"제목","layout":{"x":0,"y":0,"w":3,"h":2},"dataSource":{"kind":"cli","commandId":"명령ID","params":{},"refreshSec":30},"display":{}}},',
          '  {"op":"update_widget","dashboardId":"...","widgetId":"...","patch":{}},',
          '  {"op":"remove_widget","dashboardId":"...","widgetId":"..."},',
          '  {"op":"register_command","id":"...","description":"...","argv":["cmd","{param}"],"params":["param"]}',
          ']}',
          '',
          '규칙:',
          '- 그리드는 12컬럼, layout h 1칸 = 60px. 권장: stat w3 h2, table/chart w6 h5, log w6 h5, text w4 h3.',
          '- display 옵션: stat={"metric":"count"|"path","path":"a.b.c","suffix":""}, table={"columns":[...]}, chart={"xKey":"","yKey":"","chartType":"line"|"bar"}, text={"content":""}.',
          '- dataSource.commandId는 아래 "사용 가능한 명령 템플릿"에 있는 것만 쓴다.',
          '- 같은 응답에서 방금 만든 대시보드에 위젯을 추가할 때 dashboardId에 "$last"를 쓴다.',
          '- 필요한 명령 템플릿이 없으면 register_command를 사용한다 (사용자 승인이 필요함을 reply에 언급).',
          '- 조회/질문만 있고 변경이 필요 없으면 operations를 빈 배열로 두고 reply로만 답한다.',
          '- 사용자가 대시보드를 명시하지 않은 위젯 추가·수정·삭제 요청은 "현재 보고 있는 대시보드"에 적용한다.',
        ];

    return [
      '너는 PE Dashboard 어시스턴트다. 아래 작업 JSON 포맷 "하나만" 출력한다. 설명이나 다른 텍스트를 덧붙이지 마라.',
      '',
      ...operationsFormat,
      screenText ? '- 데이터 관련 질문에는 아래 "현재 화면 위젯 데이터"를 근거로 답한다.' : '',
      '',
      current
        ? `사용자가 현재 보고 있는 대시보드: id="${current.id}", 이름="${current.name}"`
        : '',
      `현재 대시보드 상태: ${JSON.stringify(dashboards)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
      screenText,
      historyText ? `이전 대화:\n${historyText}` : '',
      `사용자 요청: ${userMessage}`,
    ].filter((line) => line !== '').join('\n');
  }

  // 사용자가 보고 있는 대시보드의 위젯 명령을 실제로 실행해 최신 데이터를 모은다.
  // 위젯이 띄우는 것과 같은 명령을 같은 파라미터로 실행하므로 화면과 같은 데이터가 된다.
  private async screenContext(dashboard: Dashboard): Promise<string> {
    const cliWidgets = dashboard.widgets
      .filter((w) => w.dataSource?.kind === 'cli')
      .slice(0, MAX_CONTEXT_WIDGETS);
    if (cliWidgets.length === 0) return '';

    const entries = await Promise.all(
      cliWidgets.map(async (w) => {
        try {
          const argv = this.deps.commands.buildArgv(w.dataSource!.commandId, w.dataSource!.params);
          const result = await this.cache.run(argv, () => this.exec(argv, WIDGET_DATA_TIMEOUT_MS));
          const body = result.ok
            ? result.stdout.slice(0, WIDGET_DATA_MAX_CHARS)
            : `(조회 실패: ${result.error ?? '알 수 없는 오류'})`;
          return `[위젯 "${w.title}"]\n${body}`;
        } catch (e) {
          return `[위젯 "${w.title}"]\n(실행 불가: ${e instanceof Error ? e.message : String(e)})`;
        }
      }),
    );
    return `현재 화면 위젯 데이터 (대시보드 "${dashboard.name}"):\n${entries.join('\n')}`;
  }
}

// 코드펜스(```json ... ```)나 앞뒤 잡설이 섞여 있어도 JSON 객체를 찾아 파싱한다.
// 잡설에 '{'가 섞인 경우를 대비해, 각 '{' 후보 위치에서 마지막 '}'까지 파싱을 시도한다.
export function extractJson(text: string): { reply?: string; operations?: Operation[] } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const end = candidate.lastIndexOf('}');
  let start = candidate.indexOf('{');
  while (start >= 0 && start < end) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as {
        reply?: string;
        operations?: Operation[];
      };
    } catch {
      start = candidate.indexOf('{', start + 1);
    }
  }
  throw new Error('JSON 객체를 찾지 못했습니다');
}
