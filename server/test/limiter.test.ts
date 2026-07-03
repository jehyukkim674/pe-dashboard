import { describe, it, expect } from 'vitest';
import { Limiter } from '../src/commands/limiter.js';

// 수동 제어 가능한 지연 작업 팩토리
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Limiter', () => {
  it('동시 실행 수가 상한을 넘지 않는다', async () => {
    const limiter = new Limiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let maxRunning = 0;

    const runs = gates.map((g) =>
      limiter.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await g.promise;
        running--;
      }),
    );

    // 마이크로태스크가 돌 시간을 준다 — 처음엔 2개만 실행돼야 한다
    await Promise.resolve();
    await Promise.resolve();
    expect(limiter.activeCount).toBe(2);
    expect(limiter.pendingCount).toBe(2);

    // 하나씩 풀어주며 대기가 순차로 승격되는지 확인
    gates[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await Promise.all(runs);

    expect(maxRunning).toBe(2); // 절대 2를 넘지 않았다
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it('작업이 던져도 슬롯을 반환한다', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // 슬롯이 반환돼 다음 작업이 실행 가능해야 한다
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
    expect(limiter.activeCount).toBe(0);
  });
});
