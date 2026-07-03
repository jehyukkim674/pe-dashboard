import { SecretProfileStore } from './secretProfileStore.js';

export interface HttpProfile {
  name: string;
  headers: Record<string, string>; // 예: { Authorization: "Bearer ..." } — 비밀이라 export 번들에 포함하지 않는다
}

function validateHttpProfile(profile: HttpProfile): void {
  const headers = profile.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('headers는 객체여야 합니다');
  }
  if (Object.keys(headers).length === 0) throw new Error('헤더를 최소 1개 입력하세요');
  for (const [k, v] of Object.entries(headers)) {
    // 헤더 이름은 토큰 문자만, 값은 문자열이며 제어문자(CR/LF 인젝션) 금지
    if (!/^[\w-]+$/.test(k)) throw new Error(`잘못된 헤더 이름: ${k}`);
    if (typeof v !== 'string') throw new Error(`헤더 값은 문자열이어야 합니다: ${k}`);
    if (/[\r\n]/.test(v)) throw new Error(`헤더 값에 줄바꿈이 포함될 수 없습니다: ${k}`);
  }
}

// HTTP 위젯의 인증 헤더 프로필 저장소. 위젯은 프로필 "이름"만 참조하므로
// 대시보드 JSON·내보내기 파일에 토큰이 새지 않는다. (PgProfiles와 같은 커널 공유)
export class HttpProfiles extends SecretProfileStore<HttpProfile> {
  constructor(file: string) {
    super(file, validateHttpProfile);
  }
}
