import { promises as fs } from 'node:fs';
import { writeJsonAtomic } from '../jsonFile.js';

export interface NamedProfile {
  name: string;
}

// 이름만 노출하고 비밀 필드(연결 문자열·인증 헤더)는 서버 파일에만 두는 프로필 저장소의 공통 골격.
// 로드(ENOENT→빈 목록)·이름 검증·중복 거부·원자적 쓰기(tmp→rename)는 여기서 한 번만 구현하고,
// 타입별 비밀 검증만 validator로 주입한다. PgProfiles·HttpProfiles가 이 커널을 공유한다.
export class SecretProfileStore<T extends NamedProfile> {
  private profiles: T[] = [];

  // validate: 이름 검증을 통과한 뒤, 타입별 비밀 필드를 검사한다(부적합 시 throw).
  constructor(
    readonly file: string,
    private readonly validate: (profile: T) => void,
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      // 파일이 손상돼 배열이 아니면(예: {}) 빈 목록으로 시작한다 — names()/get()의 배열 연산이 죽지 않게
      this.profiles = Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.profiles = [];
    }
  }

  names(): string[] {
    return this.profiles.map((p) => p.name);
  }

  get(name: string): T | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  // 검증 순서(보안): 이름 형식 → 타입별 비밀 검증 → 중복. 그 다음에야 저장한다.
  async add(profile: T): Promise<void> {
    if (!/^[\w-]+$/.test(profile.name)) throw new Error(`invalid profile name: ${profile.name}`);
    this.validate(profile);
    if (this.get(profile.name)) throw new Error(`profile already exists: ${profile.name}`);
    this.profiles.push(profile);
    await this.persist();
  }

  async remove(name: string): Promise<boolean> {
    const before = this.profiles.length;
    this.profiles = this.profiles.filter((p) => p.name !== name);
    if (this.profiles.length === before) return false;
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    // 연결 문자열·인증 헤더 같은 비밀이 담기므로 소유자만 읽고 쓰게(0600) 저장한다
    await writeJsonAtomic(this.file, this.profiles, 0o600);
  }
}
