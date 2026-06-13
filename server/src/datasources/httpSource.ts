import type { CommandResult, WidgetDataSource } from '../types.js';
import type { HttpProfiles } from './httpProfiles.js';
import type { DataSource } from './registry.js';

const TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1024 * 1024; // 1MB — 위젯 표시용이므로 그 이상은 자른다

// HTTP(S) GET으로 JSON API를 조회하는 위젯 데이터 소스.
// CommandResult 형태로 반환해 기존 위젯 렌더러(stat/table/chart/log)를 그대로 쓴다.
export class HttpSource implements DataSource {
  readonly kind = 'http';

  // httpProfile 이름으로 인증 헤더를 붙인다 (헤더 값은 서버에만 저장)
  constructor(private readonly profiles?: HttpProfiles) {}

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const url = dataSource.url ?? '';
    if (!/^https?:\/\//.test(url)) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'http(s):// URL이 필요합니다' };
    }
    let profileHeaders: Record<string, string> = {};
    if (dataSource.httpProfile) {
      const profile = this.profiles?.get(dataSource.httpProfile);
      if (!profile) {
        return {
          ok: false, exitCode: null, stdout: '', stderr: '',
          error: `HTTP 인증 프로필을 찾을 수 없습니다: ${dataSource.httpProfile}`,
        };
      }
      profileHeaders = profile.headers;
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8', ...profileHeaders },
      });
      const text = (await res.text()).slice(0, MAX_BODY_CHARS);
      const result: CommandResult = { ok: res.ok, exitCode: res.status, stdout: text, stderr: '' };
      if (!res.ok) result.error = `HTTP ${res.status} ${res.statusText}`.trim();
      try {
        result.json = JSON.parse(text);
      } catch {
        // JSON이 아니면 raw stdout만 사용
      }
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const friendly = /abort|timeout/i.test(message)
        ? `요청이 ${TIMEOUT_MS / 1000}초를 초과했습니다`
        : message;
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: friendly };
    }
  }
}
