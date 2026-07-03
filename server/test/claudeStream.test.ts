import { describe, it, expect } from 'vitest';
import { runClaudeStream, type StreamEvent } from '../src/ai/claudeStream.js';

describe('runClaudeStream', () => {
  it('청크 경계가 한글(멀티바이트)을 갈라도 손상 없이 이어붙인다', async () => {
    // 64KB 파이프 버퍼를 훌쩍 넘겨 stdout이 여러 data 청크로 쪼개지게 만든다.
    // '가'(EA B0 80, 3바이트)를 반복하면 청크 경계가 문자 중간을 자를 확률이 매우 높다.
    const big = '가'.repeat(60_000);
    const payload = JSON.stringify({ type: 'result', result: big }) + '\n';
    const script = `process.stdout.write(${JSON.stringify(payload)})`;

    const events: StreamEvent[] = [];
    const result = await runClaudeStream(
      [process.execPath, '-e', script],
      (e) => events.push(e),
    );

    expect(result.ok).toBe(true);
    // 깨진 문자(U+FFFD)가 하나도 없어야 하고 원문과 정확히 일치해야 한다
    expect(result.stdout).not.toContain('�');
    expect(result.stdout).toBe(big);
    expect((result.json as { result: string }).result).toBe(big);
  });

  it("타임아웃 시 명확한 안내 메시지로 실패한다", async () => {
    const result = await runClaudeStream(
      [process.execPath, '-e', 'setTimeout(() => {}, 10000)'],
      () => {},
      200, // 200ms 타임아웃
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/초과/);
  });
});
