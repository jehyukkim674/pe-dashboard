import { execFile } from 'node:child_process';
import type { CommandResult } from '../types.js';
import { logCommand, maskSecrets } from './auditLog.js';
import { diagnose } from './diagnose.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export function runArgv(
  argv: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false, exitCode: null, stdout: '', stderr: '', error: 'argv가 비어 있습니다.',
    });
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, signal },
      (err, stdout, stderr) => {
        const result: CommandResult = {
          ok: !err,
          exitCode: err ? exitCodeOf(err) : 0,
          stdout,
          // 분류는 아래에서 원문 stderr로 수행하고, 노출용 stderr는 비밀값을 가린다.
          // (위젯 표시·AI 프롬프트가 이 값을 그대로 쓰므로 모든 표면이 동일하게 마스킹된다)
          stderr: maskSecrets(stderr),
        };
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          result.diagnosis = diagnose(argv, {
            exitCode: result.exitCode,
            stderr,
            errCode: e.code,
            killed: e.killed,
          });
          result.error = result.diagnosis.hint; // 하위호환: error = hint
        }
        try {
          result.json = JSON.parse(stdout);
        } catch {
          // JSON이 아니면 raw stdout만 사용
        }
        logCommand({
          argv,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
          stderr: err ? stderr : undefined,
          category: result.diagnosis?.category,
        });
        resolve(result);
      },
    );
  });
}

function exitCodeOf(err: Error): number | null {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'number' ? code : null;
}
