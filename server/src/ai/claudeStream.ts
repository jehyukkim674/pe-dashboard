import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { CommandResult } from '../types.js';
import { logCommand } from '../commands/auditLog.js';

// SIGTERM을 무시하는 자식(멈춘 claude 등)을 확실히 죽이기 위한 유예 시간
const KILL_GRACE_MS = 2_000;

// claude --output-format stream-json 의 NDJSON 한 줄(이벤트). 필요한 필드만 느슨하게 본다.
export interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

export type ExecStream = (
  argv: string[],
  onEvent: (e: StreamEvent) => void,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<CommandResult>;

// claude를 stream-json으로 실행하며 NDJSON 이벤트를 onEvent로 흘리고,
// 종료 시 최종 결과를 CommandResult로 돌려준다(json은 {result} 형태로 맞춰
// 기존 비스트리밍 경로의 파싱 코드를 그대로 재사용하게 한다).
export const runClaudeStream: ExecStream = (argv, onEvent, timeoutMs = 120_000, signal) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(argv[0], argv.slice(1), { signal });
    // 청크 경계가 UTF-8 멀티바이트 문자(한글 등) 중간을 자를 수 있으므로 StringDecoder로
    // 안전하게 이어붙인다. chunk.toString('utf8')를 청크마다 하면 깨진 문자(�)가 섞인다.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let buffer = '';
    let stderr = '';
    let finalText = ''; // 터미널 result 이벤트의 result 필드 (모델의 완성 응답)
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // SIGTERM을 무시하면 유예 후 SIGKILL로 강제 종료 (좀비/무한 대기 방지)
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: StreamEvent;
      try {
        evt = JSON.parse(trimmed) as StreamEvent;
      } catch {
        return; // NDJSON이 아닌 잡음 줄은 무시
      }
      if (evt.type === 'result' && typeof evt.result === 'string') finalText = evt.result;
      onEvent(evt);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += stdoutDecoder.write(chunk);
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += stderrDecoder.write(chunk); });

    const finish = (ok: boolean, exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      buffer += stdoutDecoder.end(); // 디코더에 남은 바이트 flush
      if (buffer.trim()) handleLine(buffer); // 마지막 개행 없는 줄 처리
      logCommand({ argv, ok, exitCode, durationMs: Date.now() - startedAt });
      const result: CommandResult = { ok, exitCode, stdout: finalText, stderr };
      if (finalText) result.json = { result: finalText };
      if (error) result.error = error;
      resolve(result);
    };

    child.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      const msg = e.code === 'ENOENT'
        ? `'${argv[0]}' 명령을 찾을 수 없습니다. 설치 및 PATH를 확인하세요.`
        : err.message;
      finish(false, null, msg);
    });
    child.on('close', (code) => {
      if (signal?.aborted) return finish(false, code, '중단됨');
      // 타임아웃으로 죽인 경우 exit code는 무의미(signal 종료 시 null)하므로 명시적 안내를 준다
      if (timedOut) return finish(false, code, `응답이 ${Math.round(timeoutMs / 1000)}초를 초과해 중단했습니다`);
      finish(code === 0, code, code === 0 ? undefined : (stderr.slice(0, 300) || `exit ${code}`));
    });
  });
