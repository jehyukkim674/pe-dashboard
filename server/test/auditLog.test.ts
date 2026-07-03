import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureAuditLog, logCommand, readAuditLog, maskSecrets, maskArgv } from '../src/commands/auditLog.js';

describe('maskSecrets', () => {
  it('env형(token=…)·Bearer 토큰을 가린다', () => {
    expect(maskSecrets('Bearer abc123def token=secret9')).toBe('Bearer *** token=***');
    expect(maskSecrets('password=p@ss!word')).toBe('password=***');
  });

  it('JSON형 따옴표 값("token":"…")을 가린다', () => {
    const masked = maskSecrets('{"token": "abc123secret", "ok": false}');
    expect(masked).not.toContain('abc123secret');
    expect(masked).toContain('***');
  });

  it('apikey/secret/client_secret 키도 가린다', () => {
    expect(maskSecrets('api_key=KEY12345')).not.toContain('KEY12345');
    expect(maskSecrets('client_secret: CS_9988')).not.toContain('CS_9988');
  });

  it('비밀값이 없으면 원문을 보존한다(분류 단서 유지)', () => {
    const s = 'error: context "ns-oss-cmdb" not found';
    expect(maskSecrets(s)).toBe(s);
  });

  it('+ / = 가 든 base64/불투명 토큰도 끝까지 가린다', () => {
    // 이전 [\w.-]+ 값 클래스는 +,/,= 에서 멈춰 뒷부분이 샜다
    expect(maskSecrets('token=Abc123+def/ghi==')).toBe('token=***');
    const masked = maskSecrets('{"api_key":"a/b+c=d"}');
    expect(masked).not.toContain('a/b+c=d');
    expect(masked).not.toContain('/b+c=d');
  });
});

describe('maskArgv', () => {
  it('비밀 플래그 다음 인자 값을 통째로 가린다', () => {
    expect(maskArgv(['argocd', 'login', '--auth-token', 'SECRET123'])).toEqual(
      ['argocd', 'login', '--auth-token', '***'],
    );
    expect(maskArgv(['mysql', '-p', 'hunter2', 'db'])).toEqual(['mysql', '-p', '***', 'db']);
  });
  it('한 인자에 든 key=value 형태 비밀값도 가린다', () => {
    expect(maskArgv(['tool', '--token=Abc+/=='])).toEqual(['tool', '--token=***']);
  });
  it('비밀이 아닌 인자는 그대로 둔다', () => {
    expect(maskArgv(['gh', 'run', 'list', '--repo', 'a/b'])).toEqual(['gh', 'run', 'list', '--repo', 'a/b']);
  });
});

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

  it('실패 엔트리에 stderr(마스킹·절단)와 category를 기록한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-'));
    configureAuditLog(path.join(dir, 'commands.jsonl'));
    logCommand({
      argv: ['kubectl', 'get', 'pods'], ok: false, exitCode: 1, durationMs: 5,
      stderr: 'Authorization: Bearer abc123def token=secret9 ' + 'x'.repeat(800),
      category: 'auth_expired',
    });
    logCommand({ argv: ['git', 'log'], ok: true, exitCode: 0, durationMs: 3 });
    await new Promise((r) => setTimeout(r, 50));

    const [fail, ok] = await readAuditLog();
    expect(fail.category).toBe('auth_expired');
    expect(fail.stderr!.length).toBeLessThanOrEqual(500);
    expect(fail.stderr).toContain('Bearer ***');
    expect(fail.stderr).toContain('token=***');
    expect(fail.stderr).not.toContain('secret9');
    expect(ok.stderr).toBeUndefined(); // 성공 엔트리엔 stderr 없음
    expect(ok.category).toBeUndefined();
  });
});
