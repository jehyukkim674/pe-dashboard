import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { PendingCommands } from '../commands/pending.js';
import type { PgProfiles } from '../datasources/pgProfiles.js';
import type { DataSourceRegistry } from '../datasources/registry.js';
import type { CommandResult, Dashboard } from '../types.js';
import { runArgv } from '../commands/runner.js';
import { readAuditLog } from '../commands/auditLog.js';
import { ResultCache } from '../commands/resultCache.js';
import type { ToolKit } from './tools.js';
import type { ChatAdapter, ChatContext, ChatEvent } from './adapter.js';
import { applyOperations, type Operation } from './operations.js';
import type { ExecStream } from './claudeStream.js';

const CLI_TIMEOUT_MS = 120_000;
const MAX_HISTORY_TURNS = 10;
const MAX_SESSIONS = 20;
const WIDGET_DATA_TIMEOUT_MS = 10_000;
const WIDGET_DATA_MAX_CHARS = 1_500; // 위젯당 프롬프트에 넣는 데이터 상한
const MAX_CONTEXT_WIDGETS = 8;

// 에이전트 루프: inspect→재질의를 몇 번까지 돌지(마지막 라운드는 inspect 무시하고 마무리),
// 라운드당 실행할 inspect 수·각 결과 크기 상한. inspect는 읽기 전용 도구만 허용한다.
const MAX_AGENT_ROUNDS = 3;
const MAX_INSPECTS_PER_ROUND = 4;
const INSPECT_MAX_CHARS = 1_500;
const INSPECT_TOOLS = new Set(['run_command_preview', 'list_commands', 'list_dashboards']);

interface InspectRequest { tool?: string; input?: unknown }

// 읽기 전용 도구만 승인 없이 허용하고, 파일 변경·임의 명령 실행 도구는 차단한다.
// -p(print) 모드에서 allowedTools에 없는 도구는 권한 프롬프트 없이 거부되므로
// 채팅이 멈추지 않으면서도 시스템을 변경할 수 없다.
const READONLY_CLI_FLAGS = [
  '--allowedTools', 'Read,Glob,Grep',
  '--disallowedTools', 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch',
];

// --model로 전달 가능한 별칭 화이트리스트 (argv 주입 방지)
const ALLOWED_MODELS = new Set(['haiku', 'sonnet', 'opus']);

type Exec = (argv: string[], timeoutMs?: number, signal?: AbortSignal) => Promise<CommandResult>;

interface Deps {
  store: DashboardStore;
  commands: CommandRegistry;
  toolkit: ToolKit;
  pending?: PendingCommands; // 같은 응답에서 등록 요청한 명령에 의존하는 작업의 보류용
  pgProfiles?: PgProfiles; // Postgres 위젯 생성 안내용 (프로필 이름만 노출)
  dataSources?: DataSourceRegistry; // http/postgres 위젯의 화면 데이터 조회용 (cli는 exec로 직접)
  exec?: Exec; // 테스트 주입용. 기본 runArgv
  execStream?: ExecStream; // 주입 시 stream-json으로 응답을 토큰 단위 스트리밍 (표시 전용)
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
    const basePrompt = await this.buildPrompt(sessionId, userMessage, context);
    const modelFlags =
      context?.model && ALLOWED_MODELS.has(context.model) ? ['--model', context.model] : [];

    // 에이전트 루프: 모델이 inspect를 요청하면 읽기 전용 도구를 실행해 결과를 돌려주고 다시 묻는다.
    // inspect가 없거나 라운드 상한에 닿으면 그 응답의 operations를 적용하고 끝낸다.
    let inspectionLog = '';
    let lastReply = '';
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      emit({ type: 'status', stage: round === 0 ? 'AI 응답 생성 중…' : 'AI가 확인 결과를 반영하는 중…' });
      const prompt = inspectionLog
        ? `${basePrompt}\n\n${inspectionLog}\n위 "확인 결과"를 근거로 이제 최종 작업(operations)을 출력하라.`
        : basePrompt;

      const result = await this.runModel(prompt, modelFlags, emit, context?.signal);
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
      let parsed: { reply?: string; operations?: Operation[]; inspect?: InspectRequest[] };
      try {
        parsed = extractJson(envelopeText);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: 'error', message: `응답 파싱 실패: ${message} — 원문: ${envelopeText.slice(0, 200)}` });
        return;
      }

      if (parsed.reply) {
        emit({ type: 'text', text: parsed.reply });
        lastReply = parsed.reply;
      }

      const inspect = Array.isArray(parsed.inspect) ? parsed.inspect : [];
      const isFinalRound = round === MAX_AGENT_ROUNDS - 1;
      if (inspect.length > 0 && !isFinalRound) {
        inspectionLog += (inspectionLog ? '\n' : '확인 결과:\n') + await this.runInspections(inspect, emit);
        continue; // 결과를 반영해 다음 라운드로
      }

      const operations = parsed.operations ?? [];
      if (this.deps.readOnly && operations.length > 0) {
        emit({ type: 'error', message: '조회 전용 모드라 변경 작업은 적용하지 않았습니다.' });
      } else {
        await applyOperations(operations, this.deps.toolkit, emit, this.deps.pending);
      }
      break;
    }
    this.remember(sessionId, userMessage, lastReply);
  }

  // claude 1회 호출. execStream이 있으면 stream-json으로 reply를 토큰 단위로 흘려 보여준다(표시 전용,
  // operations는 호출자가 최종 텍스트를 extractJson으로 파싱해 적용하므로 영향 없음).
  private async runModel(
    prompt: string,
    modelFlags: string[],
    emit: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    if (this.deps.execStream) {
      let modelText = '';
      let emitted = 0;
      return this.deps.execStream(
        ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose',
          '--include-partial-messages', ...READONLY_CLI_FLAGS, ...modelFlags],
        (evt) => {
          const delta = evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta'
            ? evt.event.delta.text
            : undefined;
          if (typeof delta !== 'string') return;
          modelText += delta;
          const reply = extractReplyText(modelText);
          if (reply.length > emitted) {
            emit({ type: 'text_delta', text: reply.slice(emitted) });
            emitted = reply.length;
          }
        },
        CLI_TIMEOUT_MS,
        signal,
      );
    }
    return this.exec(
      ['claude', '-p', prompt, '--output-format', 'json', ...READONLY_CLI_FLAGS, ...modelFlags],
      CLI_TIMEOUT_MS,
      signal,
    );
  }

  // 모델이 요청한 읽기 전용 inspect 도구를 실행하고 결과를 프롬프트용 텍스트로 모은다.
  private async runInspections(inspect: InspectRequest[], emit: (e: ChatEvent) => void): Promise<string> {
    const parts: string[] = [];
    for (const req of inspect.slice(0, MAX_INSPECTS_PER_ROUND)) {
      const tool = req?.tool;
      if (typeof tool !== 'string' || !INSPECT_TOOLS.has(tool)) {
        parts.push(`[${String(tool)}] 허용되지 않은 확인 도구입니다`);
        continue;
      }
      emit({ type: 'tool', name: 'inspect', summary: `확인 중: ${tool}` });
      try {
        const output = await this.deps.toolkit.handlers[tool](req.input ?? {});
        parts.push(`[${tool} ${JSON.stringify(req.input ?? {})}]\n${JSON.stringify(output).slice(0, INSPECT_MAX_CHARS)}`);
      } catch (e) {
        parts.push(`[${tool}] 오류: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return parts.join('\n');
  }

  // 대화 초기화: 프롬프트에 들어가는 요약 히스토리를 비워 AI가 이전 대화를 기억하지 않게 한다
  clearSession(sessionId: string): void {
    this.history.delete(sessionId);
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
    const failuresText = await this.recentFailures();

    // 프롬프트 다이어트: 현재 보고 있는 대시보드만 전체 구조(위젯 id·layout 포함)를 주고,
    // 나머지는 id·이름·위젯 제목만 요약한다. 대시보드가 늘어도 프롬프트가 비대해지지 않는다.
    const dashboardsForPrompt = current
      ? dashboards.map((d) =>
          d.id === current.id
            ? d
            : { id: d.id, name: d.name, widgetTitles: d.widgets.map((w) => w.title) },
        )
      : dashboards;

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
          '  {"op":"add_widget","dashboardId":"대시보드ID 또는 $last","widget":{"type":"stat|table|chart|log|text|status","title":"제목","layout":{"x":0,"y":0,"w":3,"h":2},"dataSource":{"kind":"cli","commandId":"명령ID","params":{},"refreshSec":30},"display":{}}},',
          '  {"op":"update_widget","dashboardId":"...","widgetId":"...","patch":{}},',
          '  {"op":"remove_widget","dashboardId":"...","widgetId":"..."},',
          '  {"op":"set_alert","dashboardId":"...","widgetId":"...","alert":{"on":"fail"|"contains","pattern":"포함문자열"}},',
          '  {"op":"register_command","id":"...","description":"...","argv":["cmd","{param}"],"params":["param"]}',
          ']}',
          '',
          '규칙:',
          '- 그리드는 12컬럼, layout h 1칸 = 60px. 권장: stat w3 h2, table/chart w6 h5, log w6 h5, status w6 h4, text w4 h3.',
          '- display 옵션: stat={"metric":"count"|"path","path":"a.b.c","suffix":""}, table={"columns":[...]}, chart={"xKey":"","yKey":"","chartType":"line"|"bar"}, status={"labelPath":"a.b","statePath":"c.d","okValues":"Synced,Healthy"}, text={"content":""}.',
          '- dataSource.commandId는 아래 "사용 가능한 명령 템플릿"에 있는 것만 쓴다.',
          '- DB 조회 위젯은 dataSource를 {"kind":"postgres","commandId":"","params":{},"profile":"프로필명","query":"SELECT ..."}로 쓴다 (SELECT/WITH 단일 문만). HTTP JSON은 {"kind":"http","commandId":"","params":{},"url":"https://..."}.',
          '- 같은 응답에서 방금 만든 대시보드에 위젯을 추가할 때 dashboardId에 "$last"를 쓴다.',
          '- 필요한 명령 템플릿이 없으면 register_command를 사용한다 (사용자 승인이 필요함을 reply에 언급).',
          '- "X가 실패하면 알림" 같은 요청은 set_alert로 처리한다: on="fail"(명령 실패 시), on="contains"(출력에 pattern 포함 시). 알림 해제는 alert를 null로.',
          '- 위젯 구성 전 명령 출력 구조가 불확실하면 operations 대신 inspect로 먼저 확인할 수 있다(에이전트 단계):',
          '  {"reply":"먼저 출력을 확인할게요","operations":[],"inspect":[{"tool":"run_command_preview","input":{"commandId":"명령ID","params":{}}}]}',
          '  inspect 도구는 run_command_preview·list_commands·list_dashboards만 가능. 결과를 받은 다음 응답에서 operations로 구성하라. inspect와 operations를 동시에 넣지 마라.',
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
      `현재 대시보드 상태: ${JSON.stringify(dashboardsForPrompt)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
      this.deps.pgProfiles && this.deps.pgProfiles.names().length > 0
        ? `사용 가능한 Postgres 프로필: ${JSON.stringify(this.deps.pgProfiles.names())}`
        : '',
      screenText,
      failuresText,
      historyText ? `이전 대화:\n${historyText}` : '',
      `사용자 요청: ${userMessage}`,
    ].filter((line) => line !== '').join('\n');
  }

  // 최근 실패한 명령을 디버깅 단서로 프롬프트에 넣는다 (claude 자체 호출·성공은 제외).
  // '위젯이 왜 비어 있어?' 같은 질문에 AI가 실제 실패 원인을 근거로 답할 수 있게 한다.
  private async recentFailures(): Promise<string> {
    try {
      const failures = (await readAuditLog(80))
        .filter((e) => !e.ok && e.argv[0] !== 'claude')
        .slice(-8)
        .map((e) => `- ${e.argv.join(' ').slice(0, 160)} (exit ${e.exitCode ?? '?'})`);
      return failures.length > 0 ? `최근 실패한 명령 (디버깅 참고):\n${failures.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  // 사용자가 보고 있는 대시보드의 위젯 데이터를 실제로 조회해 최신 상태를 모은다.
  // 위젯이 띄우는 것과 같은 소스(cli/http/postgres)를 같은 파라미터로 실행하므로 화면과 같은 데이터가 된다.
  private async screenContext(dashboard: Dashboard): Promise<string> {
    const widgets = dashboard.widgets.filter((w) => w.dataSource).slice(0, MAX_CONTEXT_WIDGETS);
    if (widgets.length === 0) return '';

    const entries = await Promise.all(
      widgets.map(async (w) => {
        const ds = w.dataSource!;
        try {
          const result = await this.fetchWidgetData(ds);
          if (!result) return undefined; // http/postgres인데 소스 미주입(테스트) → 건너뜀
          const raw = result.ok
            ? result.stdout || (result.json !== undefined ? JSON.stringify(result.json) : '')
            : `(조회 실패: ${result.error ?? '알 수 없는 오류'})`;
          return `[위젯 "${w.title}"]\n${raw.slice(0, WIDGET_DATA_MAX_CHARS)}`;
        } catch (e) {
          return `[위젯 "${w.title}"]\n(실행 불가: ${e instanceof Error ? e.message : String(e)})`;
        }
      }),
    );
    const lines = entries.filter((e): e is string => e !== undefined);
    if (lines.length === 0) return '';
    return `현재 화면 위젯 데이터 (대시보드 "${dashboard.name}"):\n${lines.join('\n')}`;
  }

  // cli는 주입된 exec로 직접(+캐시 공유)하고, http/postgres는 dataSources 레지스트리로 조회한다.
  private async fetchWidgetData(ds: Dashboard['widgets'][number]['dataSource']): Promise<CommandResult | undefined> {
    if (!ds) return undefined;
    if (ds.kind === 'cli') {
      const argv = this.deps.commands.buildArgv(ds.commandId, ds.params);
      return this.cache.run(argv, () => this.exec(argv, WIDGET_DATA_TIMEOUT_MS));
    }
    if (!this.deps.dataSources) return undefined;
    return this.deps.dataSources.get(ds.kind).fetch(ds);
  }
}

// 스트리밍 중인 모델 출력(완성 전 JSON 문자열)에서 지금까지의 reply 값만 언이스케이프해 뽑는다.
// 표시 전용 — operations는 최종 완성 텍스트를 extractJson으로 파싱해 적용하므로 여기 정확성은 무관.
export function extractReplyText(partial: string): string {
  const s = partial.replace(/^\s*```(?:json)?\s*/i, '');
  const m = /"reply"\s*:\s*"/.exec(s);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') break; // reply 문자열의 끝
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= s.length) break; // 백슬래시가 마지막 — 미완성 이스케이프, 다음 청크를 기다린다
    const next = s[i + 1];
    const simple: Record<string, string> = {
      n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f',
    };
    if (next === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) break; // 미완성 \uXXXX
      out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : next;
      i += /^[0-9a-fA-F]{4}$/.test(hex) ? 5 : 1;
    } else {
      out += simple[next] ?? next;
      i += 1;
    }
  }
  return out;
}

// 코드펜스(```json ... ```)나 앞뒤 잡설이 섞여 있어도 JSON 객체를 찾아 파싱한다.
// 잡설에 '{'가 섞인 경우를 대비해, 각 '{' 후보 위치에서 마지막 '}'까지 파싱을 시도한다.
export function extractJson(
  text: string,
): { reply?: string; operations?: Operation[]; inspect?: InspectRequest[] } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const end = candidate.lastIndexOf('}');
  let start = candidate.indexOf('{');
  while (start >= 0 && start < end) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as {
        reply?: string;
        operations?: Operation[];
        inspect?: InspectRequest[];
      };
    } catch {
      start = candidate.indexOf('{', start + 1);
    }
  }
  throw new Error('JSON 객체를 찾지 못했습니다');
}
