// TableWidget의 셀 렌더 규칙·컬럼 설정 파싱 — 순수 함수만 모아 테스트하기 쉽게 분리
import { getPath } from '../../utils/json';

export function valueAt(row: Record<string, unknown>, dotted: string): unknown {
  return getPath(row, dotted);
}

// 컬럼 클릭 정렬: 양쪽 다 유한한 수면 수치 비교, 아니면 문자열 비교.
// Number.isFinite로 판정해 'Infinity'/'NaN' 같은 문자열이 수치로 오인돼 정렬을 깨뜨리지 않게 한다.
export function compare(a: Record<string, unknown>, b: Record<string, unknown>, key: string): number {
  const [va, vb] = [valueAt(a, key), valueAt(b, key)];
  const [na, nb] = [Number(va), Number(vb)];
  if (Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== '') return na - nb;
  return String(va ?? '').localeCompare(String(vb ?? ''));
}

// 셀에 보이는 문자열 그대로를 검색·필터 기준으로 쓴다
export function cellText(v: unknown): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
}

// 모니터링 도구들이 흔히 쓰는 상태 단어 → 색. 매칭 안 되면 undefined(일반 텍스트)
const STATUS_WORDS: Record<'green' | 'red' | 'orange', string[]> = {
  green: ['synced', 'healthy', 'ok', 'success', 'succeeded', 'running', 'active', 'ready', 'passed', 'up', 'online', 'true', '정상'],
  red: ['outofsync', 'degraded', 'failed', 'failure', 'error', 'down', 'offline', 'unhealthy', 'crashloopbackoff', 'false', '실패', '오류'],
  orange: ['missing', 'progressing', 'pending', 'warning', 'suspended', 'unknown', 'paused', 'terminating', '대기'],
};

export function statusColor(text: string): 'green' | 'red' | 'orange' | undefined {
  const t = text.trim().toLowerCase();
  for (const [color, words] of Object.entries(STATUS_WORDS)) {
    if (words.includes(t)) return color as 'green' | 'red' | 'orange';
  }
  return undefined;
}

// ISO-8601 타임스탬프면 epoch ms 반환 (상대 시각 표시 대상 판별)
export function parseIsoTimestamp(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text.trim())) return undefined;
  const ms = Date.parse(text.trim());
  return Number.isNaN(ms) ? undefined : ms;
}

// 컬럼 순서: 저장된 순서를 우선하고, 새로 생긴 컬럼은 원래 자리 순서대로 뒤에 붙인다
export function orderColumns(base: string[], order?: string[]): string[] {
  if (!order?.length) return base;
  const known = order.filter((k) => base.includes(k));
  return [...known, ...base.filter((k) => !known.includes(k))];
}

// display에 저장되는 테이블 사용자 설정 키 (WidgetEditModal이 편집 시 보존해야 하는 목록)
export const TABLE_PREF_KEYS = ['columnWidths', 'columnFilters', 'columnSort', 'hiddenColumns', 'columnOrder'] as const;

export interface TablePrefs {
  widths: Record<string, number>;
  filters: Record<string, string[]>;
  sort?: { key: string; order: 'ascend' | 'descend' };
  hidden: string[];
  order?: string[];
}

// display는 AI도 수정할 수 있는 느슨한 JSON이라 방어적으로 파싱한다
export function readTablePrefs(display?: Record<string, unknown>): TablePrefs {
  const obj = (v: unknown) => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const widths: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(display?.columnWidths))) {
    if (typeof v === 'number' && v > 0) widths[k] = v;
  }
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj(display?.columnFilters))) {
    const vals = strArr(v);
    if (vals.length > 0) filters[k] = vals;
  }
  const isSortOrder = (v: unknown): v is 'ascend' | 'descend' => v === 'ascend' || v === 'descend';
  const { key: sortKey, order: sortOrder } = obj(display?.columnSort);
  const sort = typeof sortKey === 'string' && isSortOrder(sortOrder)
    ? { key: sortKey, order: sortOrder }
    : undefined;
  const order = strArr(display?.columnOrder);
  return {
    widths, filters, sort,
    hidden: strArr(display?.hiddenColumns),
    order: order.length > 0 ? order : undefined,
  };
}
