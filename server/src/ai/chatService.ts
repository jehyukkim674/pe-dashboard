import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandTemplate } from '../types.js';
import type { ToolKit } from './tools.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate }
  | { type: 'error'; message: string };

interface Deps {
  client: Anthropic;
  tools: ToolKit;
  store: DashboardStore;
  commands: CommandRegistry;
}

const MAX_TURNS = 8;

export class ChatService {
  private readonly sessions = new Map<string, Anthropic.MessageParam[]>();

  constructor(private readonly deps: Deps) {}

  async chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void> {
    const history = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, history);
    history.push({ role: 'user', content: userMessage });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.deps.client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: await this.systemPrompt(),
        tools: this.deps.tools.definitions,
        messages: [...history],
      });

      history.push({ role: 'assistant', content: response.content });
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) emit({ type: 'text', text: block.text });
      }
      if (response.stop_reason !== 'tool_use') return;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: await this.runTool(block.name, block.input, emit),
        });
      }
      history.push({ role: 'user', content: results });
    }
    emit({ type: 'error', message: `도구 호출이 ${MAX_TURNS}회를 초과해 중단했습니다.` });
  }

  private async runTool(
    name: string,
    input: unknown,
    emit: (e: ChatEvent) => void,
  ): Promise<string> {
    const handler = this.deps.tools.handlers[name];
    if (!handler) return `ERROR: unknown tool ${name}`;
    try {
      const output = await handler(input);
      emit({ type: 'tool', name, summary: summarize(name, input) });
      if (name === 'register_command') {
        const { pendingId, command } = output as { pendingId: string; command: CommandTemplate };
        emit({ type: 'confirm_request', pendingId, command });
      }
      return JSON.stringify(output ?? 'ok');
    } catch (e) {
      return `ERROR: ${(e as Error).message}`;
    }
  }

  private async systemPrompt(): Promise<string> {
    const dashboards = await this.deps.store.list();
    const commands = this.deps.commands.list();
    return [
      '너는 PE Dashboard 어시스턴트다. 사용자의 요청에 따라 도구를 호출해 대시보드와 위젯을 생성·수정·삭제한다.',
      '그리드는 12컬럼, layout {x,y,w,h}의 h 1칸은 60px. 권장 크기: stat w3 h2, table/chart w6 h5, log w6 h5, text w4 h3.',
      '위젯 display 옵션: stat={metric:"count"|"path", path?:"a.b.c", suffix?:string}, ' +
        'table={columns?:string[]}, chart={xKey:string, yKey:string, chartType?:"line"|"bar"}, ' +
        'text={content:string}.',
      'dataSource.commandId는 반드시 list_commands 결과에 있는 것만 사용한다. ' +
        '출력 구조가 불확실하면 먼저 run_command_preview로 확인한 뒤 위젯을 구성한다.',
      '요청에 맞는 명령 템플릿이 없으면 register_command로 등록을 요청하라 (사용자 승인이 필요하다).',
      '응답은 한국어로 간결하게.',
      `현재 대시보드 상태: ${JSON.stringify(dashboards)}`,
      `사용 가능한 명령 템플릿: ${JSON.stringify(commands)}`,
    ].join('\n');
  }
}

function summarize(name: string, input: unknown): string {
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'create_dashboard': return `대시보드 '${String(i['name'])}' 생성`;
    case 'delete_dashboard': return `대시보드 삭제 (${String(i['id'])})`;
    case 'add_widget': return `위젯 '${String((i['widget'] as Record<string, unknown>)?.['title'])}' 추가`;
    case 'update_widget': return `위젯 수정 (${String(i['widgetId'])})`;
    case 'remove_widget': return `위젯 삭제 (${String(i['widgetId'])})`;
    case 'register_command': return `명령 '${String(i['id'])}' 등록 요청`;
    case 'run_command_preview': return `명령 미리 실행 (${String(i['commandId'])})`;
    default: return name;
  }
}
