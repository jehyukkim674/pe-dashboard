import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandResult } from '../types.js';
import { runArgv } from '../commands/runner.js';
import type { ToolKit } from './tools.js';
import type { ChatAdapter, ChatEvent } from './adapter.js';
import { applyOperations, type Operation } from './operations.js';

const CLI_TIMEOUT_MS = 120_000;
const MAX_HISTORY_TURNS = 10;
const MAX_SESSIONS = 20;

type Exec = (argv: string[], timeoutMs?: number) => Promise<CommandResult>;

interface Deps {
  store: DashboardStore;
  commands: CommandRegistry;
  toolkit: ToolKit;
  exec?: Exec; // 테스트 주입용. 기본 runArgv
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

  constructor(private readonly deps: Deps) {
    this.exec = deps.exec ?? runArgv;
  }

  async chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void> {
    const prompt = await this.buildPrompt(sessionId, userMessage);
    const result = await this.exec(['claude', '-p', prompt, '--output-format', 'json'], CLI_TIMEOUT_MS);

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
    await applyOperations(parsed.operations ?? [], this.deps.toolkit, emit);
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

  private async buildPrompt(sessionId: string, userMessage: string): Promise<string> {
    const dashboards = await this.deps.store.list();
    const commands = this.deps.commands.list();
    const turns = this.history.get(sessionId) ?? [];
    const historyText = turns.map((t) => `사용자: ${t.user}\n어시스턴트: ${t.reply}`).join('\n');

    return [
      '너는 PE Dashboard 어시스턴트다. 아래 작업 JSON 포맷 "하나만" 출력한다. 설명이나 다른 텍스트를 덧붙이지 마라.',
      '',
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
      '',
      `현재 대시보드 상태: ${JSON.stringify(dashboards)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
      historyText ? `이전 대화:\n${historyText}` : '',
      `사용자 요청: ${userMessage}`,
    ].filter((line) => line !== '').join('\n');
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
