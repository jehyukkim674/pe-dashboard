import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagnosisCategory } from '../types.js';

// 실행된 모든 외부 명령의 감사 로그 (JSONL append-only).
// start.ts에서 configureAuditLog로 경로를 지정하면 runner가 기록한다.

const MAX_ARG_CHARS = 200; // claude 프롬프트처럼 긴 인자는 잘라서 기록
const MAX_STDERR_CHARS = 500;

// stderr에 찍히는 토큰류 비밀값을 가린다(env형 token=… 와 JSON형 "token":"…" 모두).
// 잘라내기 없이 마스킹만 하므로 위젯 알림 패턴 매칭(stdout+stderr) 등 길이 의존 로직을 깨지 않는다.
// 값 매처는 따옴표 값("…"/'…')과 비따옴표 값을 모두 통째로 잡는다. 비따옴표 값 클래스는
// base64 토큰의 +, /, = 를 포함하되 구분자(공백·쉼표·중괄호·&)에서 멈춰, 이전처럼 값 뒤 일부가
// 새는 것을 막는다.
const QUOTED_OR_BARE = `(?:"[^"]*"|'[^']*'|[^\\s,}&]+)`;
export function maskSecrets(s: string): string {
  return s
    .replace(new RegExp(`(bearer\\s+)${QUOTED_OR_BARE}`, 'gi'), '$1***')
    .replace(
      new RegExp(`((?:token|api[_-]?key|secret|client[_-]?secret|password)["']?\\s*[=:]\\s*)${QUOTED_OR_BARE}`, 'gi'),
      '$1***',
    );
}

// argv를 감사 로그에 남기기 전 비밀값을 가린다. 두 경로를 모두 막는다:
// (1) 한 인자 안의 key=value 형태 → maskSecrets
// (2) `--token SECRET`처럼 비밀 플래그 다음 인자에 값이 오는 형태 → 통째로 ***
const SECRET_FLAG_RE = /^--?(?:auth[-_]?token|token|password|passwd|pass|secret|api[-_]?key|client[-_]?secret|bearer|p|P)$/i;
export function maskArgv(argv: string[]): string[] {
  return argv.map((arg, i) => (i > 0 && SECRET_FLAG_RE.test(argv[i - 1]) ? '***' : maskSecrets(arg)));
}

// 감사 로그 영속화용: 마스킹 후 길이까지 제한한다.
export function redactStderr(stderr: string): string {
  return maskSecrets(stderr).slice(0, MAX_STDERR_CHARS);
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
    // 인자로 넘어온 비밀값(토큰·비밀번호)을 먼저 가린 뒤 길이를 제한한다
    argv: maskArgv(entry.argv).map((a) => (a.length > MAX_ARG_CHARS ? `${a.slice(0, MAX_ARG_CHARS)}…` : a)),
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
