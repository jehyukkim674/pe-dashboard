import type { CommandResult, WidgetDataSource } from '../types.js';
import type { HttpProfiles } from './httpProfiles.js';
import type { DataSource } from './registry.js';
import { describeFetchError, fetchFollowingRedirects } from './httpSource.js';

const TIMEOUT_MS = 10_000;
const MAX_ROWS = 1000;

// Prometheus instant/range 쿼리 응답을 평평한 행 배열로 변환한다.
// 응답: { status, data: { resultType, result: [{ metric:{label:val,...}, value:[ts,"v"] | values:[[ts,"v"],...] }] } }
// → 각 시계열을 { ...라벨, value:number, timestamp:number } 한 행으로. table/chart/stat이 바로 소비.
export function shapePrometheus(json: unknown): Record<string, unknown>[] {
  const result = (json as { data?: { result?: unknown } })?.data?.result;
  if (!Array.isArray(result)) return [];
  return result.slice(0, MAX_ROWS).map((item) => {
    const it = (item ?? {}) as { metric?: Record<string, unknown>; value?: unknown; values?: unknown };
    const row: Record<string, unknown> = { ...(it.metric ?? {}) };
    // instant는 value(단일 쌍), range는 values(쌍 배열) — range면 마지막 값을 대표로 쓴다
    const pair = Array.isArray(it.value)
      ? it.value
      : Array.isArray(it.values) && it.values.length > 0
        ? it.values[it.values.length - 1]
        : undefined;
    if (Array.isArray(pair)) {
      row.timestamp = pair[0];
      const num = Number(pair[1]);
      row.value = Number.isFinite(num) ? num : pair[1];
    }
    return row;
  });
}

// Prometheus HTTP API(/api/v1/query)를 직접 호출하는 네이티브 소스.
// url = 서버 베이스(http://prom:9090), query = PromQL. 인증은 http 프로필 재사용.
export class PrometheusSource implements DataSource {
  readonly kind = 'prometheus';

  constructor(private readonly profiles?: HttpProfiles) {}

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const base = (dataSource.url ?? '').trim();
    if (!/^https?:\/\//.test(base)) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'Prometheus 베이스 URL(http(s)://)이 필요합니다' };
    }
    if (!dataSource.query) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'PromQL query가 필요합니다' };
    }
    let headers: Record<string, string> = {};
    if (dataSource.httpProfile) {
      const profile = this.profiles?.get(dataSource.httpProfile);
      if (!profile) {
        return { ok: false, exitCode: null, stdout: '', stderr: '', error: `HTTP 인증 프로필을 찾을 수 없습니다: ${dataSource.httpProfile}` };
      }
      headers = profile.headers;
    }
    const url = `${base.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(dataSource.query)}`;
    try {
      const res = await fetchFollowingRedirects(url, headers, AbortSignal.timeout(TIMEOUT_MS));
      const text = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      if (!res.ok) {
        return { ok: false, exitCode: res.status, stdout: '', stderr: '', error: `HTTP ${res.status} ${res.statusText}`.trim() };
      }
      // Prometheus는 200에도 {status:'error', error:'...'}로 쿼리 오류를 알린다
      const status = (parsed as { status?: string })?.status;
      if (status === 'error') {
        const msg = (parsed as { error?: string })?.error ?? 'Prometheus query error';
        return { ok: false, exitCode: res.status, stdout: '', stderr: '', error: msg };
      }
      const rows = shapePrometheus(parsed);
      return {
        ok: true, exitCode: res.status, stderr: '',
        stdout: JSON.stringify(rows).slice(0, 1024 * 1024),
        json: rows,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const friendly = /abort|timeout/i.test(message)
        ? `요청이 ${TIMEOUT_MS / 1000}초를 초과했습니다`
        : describeFetchError(message, e);
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: friendly };
    }
  }
}
