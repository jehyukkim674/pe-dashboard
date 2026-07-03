import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatService, type ChatEvent } from '../src/ai/chatService.js';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools } from '../src/ai/tools.js';

async function makeService(responses: unknown[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  const tools = buildTools({ store, commands, pending: new PendingCommands() });

  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  const client = { messages: { create } };
  return {
    service: new ChatService({ client: client as never, tools, store, commands }),
    store,
    create,
  };
}

function collectEvents() {
  const events: ChatEvent[] = [];
  return { events, emit: (e: ChatEvent) => events.push(e) };
}

describe('ChatService', () => {
  it('emits text for a plain response', async () => {
    const { service } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '안녕하세요' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', '안녕', emit);
    expect(events).toEqual([{ type: 'text', text: '안녕하세요' }]);
  });

  it('runs tool_use loop: executes handler, emits tool event, continues', async () => {
    const { service, store } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'create_dashboard', input: { name: '배포' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '만들었습니다' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', '배포 대시보드 만들어줘', emit);

    expect((await store.list()).map((d) => d.name)).toEqual(['배포']);
    expect(events.some((e) => e.type === 'tool' && e.name === 'create_dashboard')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'text', text: '만들었습니다' });
  });

  it('emits confirm_request when register_command tool is used', async () => {
    const command = {
      id: 'k_ctx', description: 'ctx', argv: ['kubectl', 'config', 'current-context'], params: [],
    };
    const { service } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'register_command', input: command }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '승인해주세요' }] },
    ]);
    const { events, emit } = collectEvents();
    await service.chat('s1', 'kubectl 컨텍스트 명령 등록해줘', emit);

    const confirm = events.find((e) => e.type === 'confirm_request');
    expect(confirm).toBeDefined();
    expect((confirm as { pendingId: string }).pendingId).toBeTruthy();
  });

  it('returns tool errors to the model instead of crashing', async () => {
    const { service, create } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'delete_dashboard', input: { id: 'nope' } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '없네요' }] },
    ]);
    const { emit } = collectEvents();
    await service.chat('s1', '삭제해줘', emit);

    const secondCallMessages = create.mock.calls[1][0].messages;
    const toolResult = secondCallMessages.at(-1).content[0];
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.content).toMatch(/ERROR/);
  });

  it('keeps session history across calls', async () => {
    const { service, create } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '1' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '2' }] },
    ]);
    const { emit } = collectEvents();
    await service.chat('s1', '첫번째', emit);
    await service.chat('s1', '두번째', emit);
    // 두 번째 API 호출에는 첫 대화(user+assistant)가 포함되어야 한다
    const messages = create.mock.calls[1][0].messages;
    expect(messages.length).toBe(3); // user1, assistant1, user2
    expect(messages[0].content).toBe('첫번째');
  });

  it('rolls back history when the API call fails, keeping the session usable', async () => {
    const { service, create } = await makeService([]);
    create.mockRejectedValueOnce(new Error('rate limited'));
    // 다음 호출은 성공 응답
    create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '복구됨' }],
    });

    const { events, emit } = collectEvents();
    await expect(service.chat('s1', '첫 요청', emit)).rejects.toThrow('rate limited');

    await service.chat('s1', '두번째 요청', emit);
    // 실패한 턴이 롤백되어, 성공 호출의 messages는 [user('두번째 요청')] 하나여야 한다
    const messages = create.mock.calls[1][0].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'user', content: '두번째 요청' });
    expect(events.at(-1)).toEqual({ type: 'text', text: '복구됨' });
  });

  it('이미 중단된 signal이면 API를 호출하지 않고 조용히 종료한다', async () => {
    const { service, create } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] },
    ]);
    const ac = new AbortController();
    ac.abort();
    const { events, emit } = collectEvents();
    await expect(service.chat('s1', 'x', emit, { signal: ac.signal })).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('signal을 Anthropic 호출 옵션으로 전달한다', async () => {
    const { service, create } = await makeService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] },
    ]);
    const ac = new AbortController();
    await service.chat('s1', 'x', () => {}, { signal: ac.signal });
    expect(create.mock.calls[0][1]).toEqual({ signal: ac.signal });
  });

  it('executes multiple tool_use blocks from one response', async () => {
    const { service, store } = await makeService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'create_dashboard', input: { name: 'A' } },
          { type: 'tool_use', id: 'tu2', name: 'create_dashboard', input: { name: 'B' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '완료' }] },
    ]);
    const { emit } = collectEvents();
    await service.chat('s1', '둘 다 만들어', emit);
    expect((await store.list()).map((d) => d.name).sort()).toEqual(['A', 'B']);
  });
});
