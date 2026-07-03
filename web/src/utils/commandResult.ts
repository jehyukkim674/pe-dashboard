import type { CommandResult } from '../types';
import { getPath } from './json';

// 최상위 배열이 아닐 때, 배열을 흔히 감싸는 래퍼 키들 (kubectl {items}, prometheus {data:{result}} 등)
const ROW_WRAPPER_KEYS = ['items', 'data', 'results', 'rows', 'list'];

// CommandResult의 JSON에서 행 배열을 꺼낸다. table/chart/status 위젯이 공유하는
// "결과 → 행" 해석 규칙의 단일 출처.
// - 최상위가 배열이면 그대로.
// - rowsPath가 주어지면 그 점 경로의 배열을 쓴다(명시 우선).
// - 아니면 흔한 래퍼 키(items/data/results/rows/list) 중 배열인 것을 자동 사용
//   → kubectl `-o json`({items:[...]}) 같은 출력이 설정 없이도 위젯에 뜬다.
export function asRows<T = Record<string, unknown>>(result?: CommandResult, rowsPath?: string): T[] {
  const json = result?.json;
  if (Array.isArray(json)) return json as T[];
  if (json == null || typeof json !== 'object') return [];
  if (rowsPath) {
    const at = getPath(json, rowsPath);
    return Array.isArray(at) ? (at as T[]) : [];
  }
  for (const key of ROW_WRAPPER_KEYS) {
    const v = (json as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}
