import { describe, it, expect, vi } from 'vitest';
import { ResultCache } from '../src/commands/resultCache.js';
import type { CommandResult } from '../src/types.js';

function result(stdout: string): CommandResult {
  return { ok: true, exitCode: 0, stdout, stderr: '' };
}

describe('ResultCache', () => {
  it('shares concurrent executions of the same argv', async () => {
    const cache = new ResultCache(10_000);
    let calls = 0;
    const exec = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return result('out');
    };
    const [a, b, c] = await Promise.all([
      cache.run(['gh', 'pr', 'list'], exec),
      cache.run(['gh', 'pr', 'list'], exec),
      cache.run(['gh', 'pr', 'list'], exec),
    ]);
    expect(calls).toBe(1);
    expect(a.stdout).toBe('out');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('does not share across different argv', async () => {
    const cache = new ResultCache(10_000);
    let calls = 0;
    const exec = async () => result(String(++calls));
    await cache.run(['a'], exec);
    await cache.run(['b'], exec);
    expect(calls).toBe(2);
  });

  it('re-executes after TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ResultCache(1_000);
      let calls = 0;
      const exec = async () => result(String(++calls));
      await cache.run(['x'], exec);
      vi.advanceTimersByTime(500);
      await cache.run(['x'], exec);
      expect(calls).toBe(1); // 아직 TTL 안
      vi.advanceTimersByTime(600);
      await cache.run(['x'], exec);
      expect(calls).toBe(2); // TTL 지나 재실행
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache thrown errors', async () => {
    const cache = new ResultCache(10_000);
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('boom');
    };
    await expect(cache.run(['x'], failing)).rejects.toThrow('boom');
    await expect(cache.run(['x'], failing)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});
