import type { CommandResult, WidgetDataSource } from '../types.js';
import type { HttpProfiles } from './httpProfiles.js';
import type { DataSource } from './registry.js';

// undici fetch는 네트워크/TLS 오류를 'fetch failed'로만 던지고 진짜 원인은 e.cause에 숨긴다.
// 사용자가 볼 에러에 그 원인(ECONNREFUSED, ENOTFOUND, 인증서 오류 등)을 드러낸다.
export function describeFetchError(message: string, e: unknown): string {
  if (message !== 'fetch failed') return message;
  const cause = (e as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ? `요청 실패: ${cause.message} (${code})` : `요청 실패: ${cause.message}`;
  }
  return message;
}

const TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1024 * 1024; // 1MB — 위젯 표시용이므로 그 이상은 자른다
const MAX_REDIRECTS = 5;

// 리다이렉트를 수동으로 따라가되, 교차 출처(origin이 다른 호스트)로 넘어갈 때는
// 프로필 인증 헤더를 떼고 요청한다. fetch 기본(redirect:'follow')은 Authorization 외
// 커스텀 헤더(X-Api-Key 등)를 교차 출처 리다이렉트 대상에도 그대로 전달해 비밀이 샌다.
export async function fetchFollowingRedirects(
  url: string,
  profileHeaders: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
  };
  const initialOrigin = new URL(url).origin;
  let current = url;
  let headers: Record<string, string> = { ...baseHeaders, ...profileHeaders };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { signal, headers, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    const next = new URL(location, current);
    // 교차 출처로 나가면 인증 헤더 제거. 한 번 벗겨지면 원 출처로 되돌아와도 복구하지 않는다.
    headers = next.origin === initialOrigin ? headers : { ...baseHeaders };
    current = next.toString();
    await res.arrayBuffer().catch(() => {}); // 응답 바디 소진(커넥션 정리)
  }
  throw new Error(`리다이렉트가 ${MAX_REDIRECTS}회를 초과했습니다`);
}

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
      const res = await fetchFollowingRedirects(url, profileHeaders, AbortSignal.timeout(TIMEOUT_MS));
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
        : describeFetchError(message, e);
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: friendly };
    }
  }
}
