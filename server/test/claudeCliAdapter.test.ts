import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools } from '../src/ai/tools.js';
import { ClaudeCliAdapter, extractJson, extractReplyText } from '../src/ai/claudeCliAdapter.js';
import type { ChatEvent } from '../src/ai/adapter.js';
import type { ExecStream } from '../src/ai/claudeStream.js';
import type { DataSourceRegistry } from '../src/datasources/registry.js';
import type { CommandResult } from '../src/types.js';

function cliResult(over: Partial<CommandResult>): CommandResult {
  return { ok: true, exitCode: 0, stdout: '', stderr: '', ...over };
}

// claude -p --output-format json 의 정상 출력 형태: {"result":"<텍스트>", ...}
function envelope(text: string): CommandResult {
  const stdout = JSON.stringify({ type: 'result', result: text });
  return cliResult({ stdout, json: JSON.parse(stdout) });
}

async function makeAdapter(
  results: CommandResult[],
  opts: { readOnly?: boolean; dataSources?: DataSourceRegistry; execStream?: ExecStream } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();
  const toolkit = buildTools({ store, commands, pending }, opts);
  const calls: string[][] = [];
  const exec = async (argv: string[]) => {
    calls.push(argv);
    return results.shift() ?? cliResult({});
  };
  return {
    adapter: new ClaudeCliAdapter({
      store, commands, pending, toolkit, exec, readOnly: opts.readOnly,
      dataSources: opts.dataSources, execStream: opts.execStream,
    }),
    store,
    pending,
    calls,
  };
}

function collect() {
  const events: ChatEvent[] = [];
  return { events, emit: (e: ChatEvent) => events.push(e) };
}

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"reply":"안녕","operations":[]}').reply).toBe('안녕');
  });
  it('parses fenced JSON', () => {
    expect(extractJson('설명\n```json\n{"reply":"ok","operations":[]}\n```').reply).toBe('ok');
  });
  it('throws when no JSON object found', () => {
    expect(() => extractJson('그냥 텍스트')).toThrow(/JSON/);
  });
  it('parses JSON even when prose before it contains braces', () => {
    const text = '포맷 {op: ...} 예시는 이렇다: {"reply":"진짜","operations":[]}';
    expect(extractJson(text).reply).toBe('진짜');
  });
});

describe('ClaudeCliAdapter', () => {
  it('invokes claude CLI with -p and --output-format json', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"네","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '안녕', emit);
    expect(calls[0][0]).toBe('claude');
    expect(calls[0]).toContain('-p');
    expect(calls[0]).toContain('--output-format');
    expect(calls[0]).toContain('json');
  });

  it('restricts claude CLI to read-only tools without permission prompts', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"네","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '안녕', emit);
    const argv = calls[0];
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('Read,Glob,Grep');
    const disallowed = argv[argv.indexOf('--disallowedTools') + 1];
    expect(disallowed).toContain('Bash');
    expect(disallowed).toContain('Write');
    expect(disallowed).toContain('Edit');
  });

  it('emits reply text and applies operations', async () => {
    const { adapter, store } = await makeAdapter([
      envelope('{"reply":"만들었습니다","operations":[{"op":"create_dashboard","name":"배포"}]}'),
    ]);
    const { events, emit } = collect();
    await adapter.chat('s1', '배포 대시보드 만들어줘', emit);

    expect(events.find((e) => e.type === 'text')).toEqual({ type: 'text', text: '만들었습니다' });
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    expect((await store.list()).map((d) => d.name)).toEqual(['배포']);
  });

  it('emits friendly error when claude binary is missing', async () => {
    const { adapter } = await makeAdapter([
      cliResult({ ok: false, exitCode: null, error: "'claude' 명령을 찾을 수 없습니다. 설치 및 PATH를 확인하세요." }),
    ]);
    const { events, emit } = collect();
    await adapter.chat('s1', '테스트', emit);
    const error = events.find((e) => e.type === 'error');
    expect(error && error.message).toMatch(/Claude Code/);
  });

  it('emits parse error with original snippet for non-JSON reply', async () => {
    const { adapter } = await makeAdapter([envelope('미안하지만 JSON이 아니야')]);
    const { events, emit } = collect();
    await adapter.chat('s1', '테스트', emit);
    const error = events.find((e) => e.type === 'error');
    expect(error && error.message).toMatch(/파싱 실패/);
  });

  it('evicts oldest history beyond 10 turns', async () => {
    const responses = Array.from({ length: 12 }, (_, i) =>
      envelope(`{"reply":"답${i}","operations":[]}`),
    );
    const { adapter, calls } = await makeAdapter(responses);
    const { emit } = collect();
    for (let i = 0; i < 12; i++) {
      await adapter.chat('s1', `질문${i}`, emit);
    }
    const lastPrompt = calls[11][calls[11].indexOf('-p') + 1];
    expect(lastPrompt).not.toContain('질문0');
    expect(lastPrompt).toContain('질문10');
  });

  describe('조회 전용 모드 (readOnly)', () => {
    it('does not apply operations the model returns', async () => {
      const { adapter, store } = await makeAdapter([
        envelope('{"reply":"만들게요","operations":[{"op":"create_dashboard","name":"배포"}]}'),
      ], { readOnly: true });
      const { events, emit } = collect();
      await adapter.chat('s1', '배포 대시보드 만들어줘', emit);
      expect(await store.list()).toHaveLength(0);
      const error = events.find((e) => e.type === 'error');
      expect(error && error.message).toMatch(/조회 전용/);
    });

    it('instructs the model that mutations are disabled', async () => {
      const { adapter, calls } = await makeAdapter([
        envelope('{"reply":"네","operations":[]}'),
      ], { readOnly: true });
      const { emit } = collect();
      await adapter.chat('s1', '안녕', emit);
      const prompt = calls[0][calls[0].indexOf('-p') + 1];
      expect(prompt).toContain('조회 전용');
    });
  });

  describe('화면 컨텍스트', () => {
    it('runs visible widget commands and includes their data in the prompt', async () => {
      const widgetData = cliResult({ stdout: 'abc123 최근 커밋 한 줄' });
      const { adapter, store, calls } = await makeAdapter([
        widgetData,
        envelope('{"reply":"최근 커밋은 abc123 입니다","operations":[]}'),
      ]);
      const dashboard = await store.create('배포');
      await store.addWidget(dashboard.id, {
        type: 'log',
        title: '최근 커밋',
        layout: { x: 0, y: 0, w: 6, h: 5 },
        dataSource: { kind: 'cli', commandId: 'git_log', params: { repoPath: '/tmp/x' } },
      });
      const { events, emit } = collect();
      await adapter.chat('s1', '최근 커밋 뭐야?', emit, { dashboardId: dashboard.id });

      expect(calls[0][0]).toBe('git'); // 위젯 명령이 먼저 실행됨
      const claudeCall = calls.find((c) => c[0] === 'claude')!;
      const prompt = claudeCall[claudeCall.indexOf('-p') + 1];
      expect(prompt).toContain('abc123 최근 커밋 한 줄');
      expect(prompt).toContain('최근 커밋'); // 위젯 제목 포함
      expect(events.find((e) => e.type === 'text'))
        .toEqual({ type: 'text', text: '최근 커밋은 abc123 입니다' });
    });

    it('includes http/postgres widget data in the prompt via dataSources', async () => {
      const httpResult = cliResult({ stdout: '{"status":"ok"}', json: { status: 'ok' } });
      const dataSources = {
        get: () => ({ kind: 'http', fetch: async () => httpResult }),
      } as unknown as DataSourceRegistry;
      const { adapter, store, calls } = await makeAdapter(
        [envelope('{"reply":"정상","operations":[]}')],
        { dataSources },
      );
      const dashboard = await store.create('http대시');
      await store.addWidget(dashboard.id, {
        type: 'stat', title: 'API 상태', layout: { x: 0, y: 0, w: 3, h: 2 },
        dataSource: { kind: 'http', commandId: '', params: {}, url: 'https://example.com/s' },
      });
      const { emit } = collect();
      await adapter.chat('s1', '상태 어때?', emit, { dashboardId: dashboard.id });

      const claudeCall = calls.find((c) => c[0] === 'claude')!;
      const prompt = claudeCall[claudeCall.indexOf('-p') + 1];
      expect(prompt).toContain('API 상태'); // 위젯 제목
      expect(prompt).toContain('"status":"ok"'); // http 소스가 조회한 데이터
    });

    it('skips http widgets silently when no dataSources are injected', async () => {
      const { adapter, store, calls } = await makeAdapter([
        envelope('{"reply":"네","operations":[]}'),
      ]);
      const dashboard = await store.create('http대시');
      await store.addWidget(dashboard.id, {
        type: 'stat', title: 'API 상태', layout: { x: 0, y: 0, w: 3, h: 2 },
        dataSource: { kind: 'http', commandId: '', params: {}, url: 'https://example.com/s' },
      });
      const { emit } = collect();
      await adapter.chat('s1', '안녕', emit, { dashboardId: dashboard.id });
      // 소스 미주입이라 위젯 데이터 없이도 정상 진행 (claude 호출 1회)
      expect(calls.filter((c) => c[0] === 'claude')).toHaveLength(1);
    });

    it('identifies the current dashboard even when it has no widgets', async () => {
      const { adapter, store, calls } = await makeAdapter([
        envelope('{"reply":"네","operations":[]}'),
      ]);
      const dashboard = await store.create('빈 대시보드');
      const { emit } = collect();
      await adapter.chat('s1', '여기에 위젯 추가해줘', emit, { dashboardId: dashboard.id });

      const prompt = calls[0][calls[0].indexOf('-p') + 1];
      expect(prompt).toContain(`현재 보고 있는 대시보드: id="${dashboard.id}"`);
      expect(prompt).toContain('현재 보고 있는 대시보드"에 적용');
    });

    it('emits progress status events', async () => {
      const { adapter, store } = await makeAdapter([
        cliResult({ stdout: 'data' }),
        envelope('{"reply":"네","operations":[]}'),
      ]);
      const dashboard = await store.create('d');
      await store.addWidget(dashboard.id, {
        type: 'log', title: 'w', layout: { x: 0, y: 0, w: 6, h: 5 },
        dataSource: { kind: 'cli', commandId: 'git_log', params: { repoPath: '/tmp/x' } },
      });
      const { events, emit } = collect();
      await adapter.chat('s1', '안녕', emit, { dashboardId: dashboard.id });
      const stages = events.filter((e) => e.type === 'status').map((e) => e.stage);
      expect(stages[0]).toMatch(/수집 중/);
      expect(stages[1]).toMatch(/생성 중/);
    });

    it('stops silently when the client aborted', async () => {
      const { adapter } = await makeAdapter([envelope('{"reply":"늦은 답","operations":[]}')]);
      const ac = new AbortController();
      ac.abort();
      const { events, emit } = collect();
      await adapter.chat('s1', '안녕', emit, { signal: ac.signal });
      expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    });

    it('does not run widget commands when no dashboardId is given', async () => {
      const { adapter, calls } = await makeAdapter([
        envelope('{"reply":"네","operations":[]}'),
      ]);
      const { emit } = collect();
      await adapter.chat('s1', '안녕', emit);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('claude');
    });
  });

  it('defers widget ops that depend on a just-requested command until approval', async () => {
    const ops = JSON.stringify({
      reply: '등록 요청했어요',
      operations: [
        { op: 'register_command', id: 'top_summary', description: 'top', argv: ['top', '-l', '1'], params: [] },
        {
          op: 'add_widget', dashboardId: 'd1',
          widget: {
            type: 'log', title: 'CPU', layout: { x: 0, y: 0, w: 6, h: 5 },
            dataSource: { kind: 'cli', commandId: 'top_summary', params: {} },
          },
        },
      ],
    });
    const { adapter, store, pending } = await makeAdapter([envelope(ops)]);
    await store.save({ id: 'd1', name: '보드', widgets: [] });
    const { events, emit } = collect();
    await adapter.chat('s1', 'top 위젯 추가해줘', emit);

    const confirm = events.find((e) => e.type === 'confirm_request');
    expect(confirm).toBeDefined();
    expect((await store.get('d1'))!.widgets).toHaveLength(0); // 즉시 추가 안 됨
    const entry = pending.take((confirm as { pendingId: string }).pendingId);
    expect(entry?.deferred).toHaveLength(1); // 승인 시 적용될 작업으로 보류됨
    expect(events.some((e) => e.type === 'tool' && /자동 적용/.test(e.summary))).toBe(true);
  });

  it('passes whitelisted --model and ignores unknown values', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"a","operations":[]}'),
      envelope('{"reply":"b","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '안녕', emit, { model: 'haiku' });
    expect(calls[0].join(' ')).toContain('--model haiku');
    await adapter.chat('s1', '안녕', emit, { model: 'evil; rm' });
    expect(calls[1].join(' ')).not.toContain('--model');
  });

  it('summarizes non-current dashboards in the prompt (prompt diet)', async () => {
    const { adapter, store, calls } = await makeAdapter([envelope('{"reply":"네","operations":[]}')]);
    const current = await store.create('현재보드');
    const currentWidget = await store.addWidget(current.id, {
      type: 'log', title: '현재위젯', layout: { x: 0, y: 0, w: 6, h: 5 },
    });
    const other = await store.create('다른보드');
    await store.addWidget(other.id, {
      type: 'log', title: '다른위젯', layout: { x: 0, y: 0, w: 6, h: 5 },
    });
    const { emit } = collect();
    await adapter.chat('s1', '안녕', emit, { dashboardId: current.id });

    const prompt = calls[0][calls[0].indexOf('-p') + 1];
    expect(prompt).toContain(currentWidget.id); // 현재 대시보드는 위젯 id까지 전체
    expect(prompt).toContain('widgetTitles'); // 나머지는 제목 요약만
    expect(prompt).toContain('다른위젯');
  });

  it('includes recent history in the next prompt', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"첫 답","operations":[]}'),
      envelope('{"reply":"둘째 답","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '첫 질문', emit);
    await adapter.chat('s1', '둘째 질문', emit);

    const secondPrompt = calls[1][calls[1].indexOf('-p') + 1];
    expect(secondPrompt).toContain('첫 질문');
    expect(secondPrompt).toContain('첫 답');
  });

  it('clearSession removes history so the next prompt starts fresh', async () => {
    const { adapter, calls } = await makeAdapter([
      envelope('{"reply":"첫 답","operations":[]}'),
      envelope('{"reply":"둘째 답","operations":[]}'),
    ]);
    const { emit } = collect();
    await adapter.chat('s1', '첫 질문', emit);
    adapter.clearSession('s1');
    await adapter.chat('s1', '둘째 질문', emit);

    const secondPrompt = calls[1][calls[1].indexOf('-p') + 1];
    expect(secondPrompt).not.toContain('첫 질문');
    expect(secondPrompt).not.toContain('첫 답');
  });

  describe('에이전트 루프(inspect)', () => {
    it('runs an inspect round then applies operations from the next response', async () => {
      const { adapter, store, calls } = await makeAdapter([
        envelope('{"reply":"명령을 먼저 확인할게요","operations":[],"inspect":[{"tool":"list_commands","input":{}}]}'),
        envelope('{"reply":"점검 대시보드를 만들었어요","operations":[{"op":"create_dashboard","name":"점검"}]}'),
      ]);
      const { events, emit } = collect();
      await adapter.chat('s1', '점검 대시보드 만들어줘', emit);

      const claudeCalls = calls.filter((c) => c[0] === 'claude');
      expect(claudeCalls).toHaveLength(2); // inspect 1라운드 + 최종 1라운드
      const secondPrompt = claudeCalls[1][claudeCalls[1].indexOf('-p') + 1];
      expect(secondPrompt).toContain('확인 결과'); // inspect 결과가 다음 프롬프트에 반영됨
      expect(events.some((e) => e.type === 'tool' && 'name' in e && e.name === 'inspect')).toBe(true);
      expect((await store.list()).some((d) => d.name === '점검')).toBe(true);
    });

    it('stops at the round cap even if the model keeps requesting inspect', async () => {
      const keepInspecting = () =>
        envelope('{"reply":"또 확인","operations":[],"inspect":[{"tool":"list_commands","input":{}}]}');
      const { adapter, calls } = await makeAdapter([
        keepInspecting(), keepInspecting(), keepInspecting(), keepInspecting(), keepInspecting(),
      ]);
      const { emit } = collect();
      await adapter.chat('s1', '뭐든', emit);
      // 무한 루프 방지: claude 호출이 상한(3)을 넘지 않는다
      expect(calls.filter((c) => c[0] === 'claude').length).toBeLessThanOrEqual(3);
    });

    it('rejects non-allowlisted inspect tools', async () => {
      const { adapter, calls } = await makeAdapter([
        envelope('{"reply":"확인","operations":[],"inspect":[{"tool":"delete_dashboard","input":{"id":"x"}}]}'),
        envelope('{"reply":"끝","operations":[]}'),
      ]);
      const { emit } = collect();
      await adapter.chat('s1', '뭐든', emit);
      const claudeCalls = calls.filter((c) => c[0] === 'claude');
      const secondPrompt = claudeCalls[1][claudeCalls[1].indexOf('-p') + 1];
      expect(secondPrompt).toContain('허용되지 않은 확인 도구'); // delete_dashboard는 inspect 불가
    });
  });

  describe('스트리밍', () => {
    it('streams reply text as text_delta and finalizes with text + operations', async () => {
      // 모델 출력 JSON을 조각내어 델타로 흘린다
      const chunks = ['{"reply":"안', '녕하', '세요","operations":[]}'];
      let streamArgv: string[] = [];
      const execStream: ExecStream = async (argv, onEvent) => {
        streamArgv = argv;
        for (const c of chunks) {
          onEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: c } } });
        }
        return envelope('{"reply":"안녕하세요","operations":[]}');
      };
      const { adapter } = await makeAdapter([], { execStream });
      const { events, emit } = collect();
      await adapter.chat('s1', '인사해줘', emit);

      // stream-json 플래그로 호출됐는지
      expect(streamArgv).toContain('stream-json');
      // 델타 조각을 모으면 reply 본문이 된다 (JSON 구문은 안 보이고 텍스트만)
      const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text);
      expect(deltas.join('')).toBe('안녕하세요');
      // 최종 권위 텍스트 1회
      expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: '안녕하세요' }]);
    });

    it('applies operations from the final parse even while streaming', async () => {
      const execStream: ExecStream = async () =>
        envelope('{"reply":"만들었어요","operations":[{"op":"create_dashboard","name":"새 대시"}]}');
      const { adapter, store } = await makeAdapter([], { execStream });
      const { emit } = collect();
      await adapter.chat('s1', '대시보드 만들어', emit);
      const list = await store.list();
      expect(list.some((d) => d.name === '새 대시')).toBe(true);
    });
  });
});

describe('extractReplyText (스트리밍 진행형 추출)', () => {
  it('returns empty until the reply field begins', () => {
    expect(extractReplyText('{"repl')).toBe('');
    expect(extractReplyText('{"reply":')).toBe('');
    expect(extractReplyText('{"reply":"')).toBe('');
  });
  it('returns the partial reply as it grows', () => {
    expect(extractReplyText('{"reply":"안녕')).toBe('안녕');
    expect(extractReplyText('{"reply":"안녕하세요","operations')).toBe('안녕하세요');
  });
  it('unescapes common sequences', () => {
    expect(extractReplyText('{"reply":"a\\nb\\"c"')).toBe('a\nb"c');
  });
  it('stops before a dangling escape (incomplete chunk)', () => {
    expect(extractReplyText('{"reply":"line\\')).toBe('line');
    expect(extractReplyText('{"reply":"x\\u26')).toBe('x');
  });
  it('handles a leading json code fence', () => {
    expect(extractReplyText('```json\n{"reply":"hi","operations":[]}')).toBe('hi');
  });
});
