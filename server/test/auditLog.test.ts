import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureAuditLog, logCommand, readAuditLog } from '../src/commands/auditLog.js';

describe('auditLog', () => {
  it('appends entries and reads them back (long args truncated)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-'));
    configureAuditLog(path.join(dir, 'logs', 'commands.jsonl'));

    logCommand({ argv: ['git', 'log'], ok: true, exitCode: 0, durationMs: 12 });
    logCommand({ argv: ['claude', '-p', 'x'.repeat(500)], ok: false, exitCode: 1, durationMs: 999 });
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget 기록 대기

    const entries = await readAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].argv).toEqual(['git', 'log']);
    expect(entries[1].argv[2].length).toBeLessThanOrEqual(201);
    expect(entries[1].ok).toBe(false);
    expect(entries[0].ts).toMatch(/^\d{4}-/);
  });

  it('respects limit and returns latest entries', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-'));
    configureAuditLog(path.join(dir, 'commands.jsonl'));
    for (let i = 0; i < 5; i++) {
      logCommand({ argv: [`cmd${i}`], ok: true, exitCode: 0, durationMs: i });
    }
    await new Promise((r) => setTimeout(r, 50));
    const entries = await readAuditLog(2);
    expect(entries.map((e) => e.argv[0])).toEqual(['cmd3', 'cmd4']);
  });
});
