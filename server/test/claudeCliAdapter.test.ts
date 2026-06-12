import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardStore } from '../src/dashboardStore.js';
import { CommandRegistry } from '../src/commands/registry.js';
import { PendingCommands } from '../src/commands/pending.js';
import { buildTools } from '../src/ai/tools.js';
import { ClaudeCliAdapter, extractJson } from '../src/ai/claudeCliAdapter.js';
import type { ChatEvent } from '../src/ai/adapter.js';
import type { CommandResult } from '../src/types.js';

function cliResult(over: Partial<CommandResult>): CommandResult {
  return { ok: true, exitCode: 0, stdout: '', stderr: '', ...over };
}

// claude -p --output-format json 의 정상 출력 형태: {"result":"<텍스트>", ...}
function envelope(text: string): CommandResult {
  const stdout = JSON.stringify({ type: 'result', result: text });
  return cliResult({ stdout, json: JSON.parse(stdout) });
}

async function makeAdapter(results: CommandResult[], opts: { readOnly?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-'));
  const store = new DashboardStore(path.join(dir, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(dir, 'commands.json'));
  await commands.load();
  const toolkit = buildTools({ store, commands, pending: new PendingCommands() }, opts);
  const calls: string[][] = [];
  const exec = async (argv: string[]) => {
    calls.push(argv);
    return results.shift() ?? cliResult({});
  };
  return {
    adapter: new ClaudeCliAdapter({ store, commands, toolkit, exec, readOnly: opts.readOnly }),
    store,
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

    expect(events[0]).toEqual({ type: 'text', text: '만들었습니다' });
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
      expect(events[0]).toEqual({ type: 'text', text: '최근 커밋은 abc123 입니다' });
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
});
