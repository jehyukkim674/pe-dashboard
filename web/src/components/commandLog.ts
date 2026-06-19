import type { DiagnosisCategory } from '../types';

export interface LogEntry {
  ts: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stderr?: string;
  category?: DiagnosisCategory;
}

// 패널 표시용 카테고리→라벨 맵. 서버 diagnose.ts의 META.label과 수동 동기화한다.
export const CATEGORY_LABELS: Record<DiagnosisCategory, string> = {
  not_installed: '미설치',
  timeout: '시간초과',
  auth_expired: '인증만료',
  unreachable: '미연결',
  context_missing: '컨텍스트없음',
  permission_denied: '권한없음',
  not_found: '리소스없음',
  bad_usage: '잘못된사용',
  unknown: '실패',
};

export interface FailureSummary {
  category: DiagnosisCategory;
  label: string;
  count: number;
}

// 실패 엔트리를 category별로 집계해 건수 내림차순으로 반환한다.
export function summarizeFailures(entries: LogEntry[]): FailureSummary[] {
  const counts = new Map<DiagnosisCategory, number>();
  for (const e of entries) {
    if (e.ok) continue;
    const cat: DiagnosisCategory = e.category ?? 'unknown';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: CATEGORY_LABELS[category], count }))
    .sort((a, b) => b.count - a.count);
}
