import { execFile } from 'node:child_process';
import type { CommandResult } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export function runArgv(argv: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false, exitCode: null, stdout: '', stderr: '', error: 'argv가 비어 있습니다.',
    });
  }
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        const result: CommandResult = {
          ok: !err,
          exitCode: err ? exitCodeOf(err) : 0,
          stdout,
          stderr,
        };
        if (err) result.error = friendlyError(err, stderr, argv[0], timeoutMs);
        try {
          result.json = JSON.parse(stdout);
        } catch {
          // JSON이 아니면 raw stdout만 사용
        }
        resolve(result);
      },
    );
  });
}

function exitCodeOf(err: Error): number | null {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'number' ? code : null;
}

function friendlyError(err: Error, stderr: string, cmd: string, timeoutMs: number): string {
  const e = err as NodeJS.ErrnoException & { killed?: boolean };
  if (e.code === 'ENOENT') return `'${cmd}' 명령을 찾을 수 없습니다. 설치 및 PATH를 확인하세요.`;
  if (e.killed) return `명령 실행이 ${timeoutMs / 1000}초를 초과해 중단되었습니다.`;
  if (/auth|login|credential/i.test(stderr)) {
    return `로그인이 필요할 수 있습니다: ${stderr.slice(0, 200)}`;
  }
  return stderr.slice(0, 300) || err.message;
}
