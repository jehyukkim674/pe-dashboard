import { describe, it, expect } from 'vitest';
import { summarizeFailures, CATEGORY_LABELS } from '../src/components/commandLog';
import type { LogEntry } from '../src/components/commandLog';

const mk = (ok: boolean, category?: string): LogEntry => ({
  ts: '2026-06-19T00:00:00Z', argv: ['kubectl', 'get'], ok, exitCode: ok ? 0 : 1,
  durationMs: 1, category: category as LogEntry['category'],
});

describe('summarizeFailures', () => {
  it('실패 엔트리를 category별로 집계하고 건수 내림차순 정렬', () => {
    const rows = summarizeFailures([
      mk(true), mk(false, 'auth_expired'), mk(false, 'auth_expired'),
      mk(false, 'unreachable'), mk(true),
    ]);
    expect(rows).toEqual([
      { category: 'auth_expired', label: '인증만료', count: 2 },
      { category: 'unreachable', label: '미연결', count: 1 },
    ]);
  });

  it('category 없는 실패는 unknown으로 묶는다', () => {
    const rows = summarizeFailures([mk(false, undefined)]);
    expect(rows).toEqual([{ category: 'unknown', label: CATEGORY_LABELS.unknown, count: 1 }]);
  });

  it('실패가 없으면 빈 배열', () => {
    expect(summarizeFailures([mk(true), mk(true)])).toEqual([]);
  });
});
