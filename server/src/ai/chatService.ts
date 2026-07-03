import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandTemplate } from '../types.js';
import type { ToolKit } from './tools.js';
import { describeToolCall } from './describe.js';
import type { ChatAdapter, ChatContext, ChatEvent } from './adapter.js';
export type { ChatEvent } from './adapter.js';

interface Deps {
  client: Anthropic;
  tools: ToolKit;
  store: DashboardStore;
  commands: CommandRegistry;
}

const MAX_TURNS = 8;
const MAX_HISTORY_MESSAGES = 60;

export class ChatService implements ChatAdapter {
  private readonly sessions = new Map<string, Anthropic.MessageParam[]>();

  constructor(private readonly deps: Deps) {}

  // 대화 초기화: 세션 메시지 히스토리를 삭제한다
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async chat(
    sessionId: string,
    userMessage: string,
    emit: (e: ChatEvent) => void,
    context?: ChatContext,
  ): Promise<void> {
    const signal = context?.signal;
    const history = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, history);
    this.trimHistory(history);
    const snapshot = history.length; // 실패·중단 시 이 길이로 롤백
    history.push({ role: 'user', content: userMessage });

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        // 클라이언트가 끊었으면(새 메시지·드로어 닫기) 미완성 턴을 되돌리고 조용히 종료
        if (signal?.aborted) {
          history.length = snapshot;
          return;
        }
        const response = await this.deps.client.messages.create(
          {
            model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: await this.systemPrompt(),
            tools: this.deps.tools.definitions,
            messages: [...history],
          },
          { signal },
        );

        history.push({ role: 'assistant', content: response.content });
        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) emit({ type: 'text', text: block.text });
        }
        if (response.stop_reason !== 'tool_use') return;

        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolBlocks.map(async (b) => ({
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content: await this.runTool(b.name, b.input, emit),
          })),
        );
        history.push({ role: 'user', content: results });
      }
      emit({ type: 'error', message: `도구 호출이 ${MAX_TURNS}회를 초과해 중단했습니다.` });
    } catch (e) {
      history.length = snapshot; // API 실패·중단 시 미완성 턴 제거 (세션 보존)
      if (signal?.aborted) return; // 사용자 취소는 에러로 올리지 않는다
      throw e;
    }
  }

  // 오래된 턴 제거. tool_use/tool_result 쌍이 깨지지 않도록
  // 남는 첫 메시지가 '문자열 content를 가진 user 메시지'가 될 때까지 더 버린다.
  private trimHistory(history: Anthropic.MessageParam[]): void {
    if (history.length <= MAX_HISTORY_MESSAGES) return;
    let start = history.length - MAX_HISTORY_MESSAGES;
    while (
      start < history.length &&
      !(history[start].role === 'user' && typeof history[start].content === 'string')
    ) {
      start++;
    }
    history.splice(0, start);
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
      emit({ type: 'tool', name, summary: describeToolCall(name, input) });
      if (name === 'register_command') {
        const { pendingId, command, warning } = output as {
          pendingId: string;
          command: CommandTemplate;
          warning?: string;
        };
        emit({ type: 'confirm_request', pendingId, command, warning });
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
