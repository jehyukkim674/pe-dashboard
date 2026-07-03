import { SecretProfileStore } from './secretProfileStore.js';

export interface SshProfile {
  name: string;
  host: string;
  user?: string;
  port?: number;
}

// host/user/port를 엄격히 검증한다. 특히 host가 '-'로 시작하면 ssh가 이를 옵션(예: -oProxyCommand=…,
// 로컬 명령 실행)으로 오인할 수 있으므로 반드시 영숫자로 시작하는 호스트명/IP만 허용한다.
function validateSshProfile(profile: SshProfile): void {
  if (typeof profile.host !== 'string' || !/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(profile.host)) {
    throw new Error('host는 영숫자로 시작하는 호스트명/IP여야 합니다 (옵션 주입 방지)');
  }
  if (profile.user !== undefined && !/^[a-zA-Z0-9._-]+$/.test(profile.user)) {
    throw new Error('user 형식이 올바르지 않습니다');
  }
  if (profile.port !== undefined
    && (!Number.isInteger(profile.port) || profile.port <= 0 || profile.port > 65535)) {
    throw new Error('port는 1~65535 정수여야 합니다');
  }
}

// SSH 접속 프로필 저장소. 키·config는 사용자의 ~/.ssh를 그대로 활용한다(여기엔 비밀을 담지 않음).
// SecretProfileStore 커널(load/names/get/add/remove/원자적 쓰기)을 공유한다.
export class SshProfiles extends SecretProfileStore<SshProfile> {
  constructor(file: string) {
    super(file, validateSshProfile);
  }
}
