import type { CommandResult } from '../types';

// CommandResult의 JSON에서 행 배열을 꺼낸다. JSON이 배열이 아니거나 없으면 빈 배열.
// table/chart/status 위젯이 공유하는 "결과 → 행" 해석 규칙의 단일 출처.
export function asRows<T = Record<string, unknown>>(result?: CommandResult): T[] {
  return Array.isArray(result?.json) ? (result.json as T[]) : [];
}
