import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagnosisCategory } from '../types.js';

// 실행된 모든 외부 명령의 감사 로그 (JSONL append-only).
// start.ts에서 configureAuditLog로 경로를 지정하면 runner가 기록한다.

const MAX_ARG_CHARS = 200; // claude 프롬프트처럼 긴 인자는 잘라서 기록
const MAX_STDERR_CHARS = 500;

// 토큰류 비밀값을 가리고 길이를 제한한다(로컬 앱이지만 stderr에 자격증명이 찍힐 수 있음).
export function redactStderr(stderr: string): string {
  return stderr
    .replace(/(bearer\s+)[\w.\-]+/gi, '$1***')
    .replace(/(token[=:]\s*)[\w.\-]+/gi, '$1***')
    .replace(/(password[=:]\s*)\S+/gi, '$1***')
    .slice(0, MAX_STDERR_CHARS);
}

export interface AuditEntry {
  ts: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stderr?: string;            // 실패 시에만, 마스킹·절단됨
  category?: DiagnosisCategory;
}

let logFile: string | undefined;
// 동시 기록의 순서 보장을 위한 직렬화 큐
let writeQueue: Promise<void> = Promise.resolve();

export function configureAuditLog(filePath: string): void {
  logFile = filePath;
}

export function logCommand(
  entry: Omit<AuditEntry, 'ts' | 'argv' | 'stderr'> & { argv: string[]; stderr?: string },
): void {
  if (!logFile) return;
  const record: AuditEntry = {
    ts: new Date().toISOString(),
    ...entry,
    argv: entry.argv.map((a) => (a.length > MAX_ARG_CHARS ? `${a.slice(0, MAX_ARG_CHARS)}…` : a)),
    stderr: entry.stderr ? redactStderr(entry.stderr) : undefined,
  };
  const file = logFile;
  // 기록 실패가 명령 실행을 방해하지 않도록 fire-and-forget, 단 순서는 직렬화
  writeQueue = writeQueue
    .then(() => fs.mkdir(path.dirname(file), { recursive: true }))
    .then(() => fs.appendFile(file, JSON.stringify(record) + '\n'))
    .catch(() => {});
}

export async function readAuditLog(limit = 100): Promise<AuditEntry[]> {
  if (!logFile) return [];
  try {
    const text = await fs.readFile(logFile, 'utf8');
    return text
      .trimEnd()
      .split('\n')
      .slice(-limit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEntry];
        } catch {
          return [];
        }
      });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
