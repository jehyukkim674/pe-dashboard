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
    expect(result.diagnosis?.category).toBe('not_installed');
    expect(result.error).toMatch(/찾을 수 없습니다/);
  });

  it('classifies auth failure from stderr', async () => {
    const result = await runArgv(['node', '-e', 'console.error("error: You must be logged in (Unauthorized)"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.category).toBe('auth_expired');
    expect(result.error).toBe(result.diagnosis?.hint);
    expect(result.stderr).toContain('Unauthorized'); // 원문은 stderr에 보존
  });

  it('times out long-running commands', async () => {
    const result = await runArgv(['node', '-e', 'setTimeout(()=>{}, 60000)'], 500);
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.category).toBe('timeout');
    expect(result.error).toMatch(/초과/);
  }, 10_000);

  it('resolves with error for empty argv instead of rejecting', async () => {
    const result = await runArgv([]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/비어/);
  });

  it('extracts non-zero exit code with unknown diagnosis', async () => {
    const result = await runArgv(['node', '-e', 'console.error("boom"); process.exit(5)']);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.diagnosis?.category).toBe('unknown');
    expect(result.stderr).toContain('boom');
  });
});
