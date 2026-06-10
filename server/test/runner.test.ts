import { describe, it, expect } from 'vitest';
import { runArgv } from '../src/commands/runner.js';

describe('runArgv', () => {
  it('captures stdout and parses JSON output', async () => {
    const result = await runArgv(['node', '-e', 'console.log(JSON.stringify([{a:1}]))']);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual([{ a: 1 }]);
  });

  it('keeps raw stdout when output is not JSON', async () => {
    const result = await runArgv(['node', '-e', 'console.log("hello")']);
    expect(result.ok).toBe(true);
    expect(result.json).toBeUndefined();
    expect(result.stdout.trim()).toBe('hello');
  });

  it('reports friendly error for missing binary', async () => {
    const result = await runArgv(['definitely-not-a-command-xyz']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/찾을 수 없습니다/);
  });

  it('reports failure with stderr message', async () => {
    const result = await runArgv(['node', '-e', 'console.error("auth required"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('auth required');
  });

  it('times out long-running commands', async () => {
    const result = await runArgv(['node', '-e', 'setTimeout(()=>{}, 60000)'], 500);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/초과/);
  }, 10_000);
});
