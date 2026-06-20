import { SecretProfileStore } from './secretProfileStore.js';

export interface PgProfile {
  name: string;
  connString: string; // postgres://user:pass@host:port/db — 비밀이므로 export 번들에 포함하지 않는다
}

function validatePgProfile(profile: PgProfile): void {
  if (!/^postgres(ql)?:\/\//.test(profile.connString)) {
    throw new Error('connString은 postgres:// 형식이어야 합니다');
  }
}

// Postgres 연결 프로필 저장소. 위젯은 프로필 "이름"만 참조하므로
// 대시보드 JSON·내보내기 파일에 연결 문자열(비밀번호)이 새지 않는다.
// 공통 골격(load/names/get/add/remove/원자적 쓰기)은 SecretProfileStore가 담당한다.
export class PgProfiles extends SecretProfileStore<PgProfile> {
  constructor(file: string) {
    super(file, validatePgProfile);
  }
}
