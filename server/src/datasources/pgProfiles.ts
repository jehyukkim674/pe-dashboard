import { promises as fs } from 'node:fs';

export interface PgProfile {
  name: string;
  connString: string; // postgres://user:pass@host:port/db — 비밀이므로 export 번들에 포함하지 않는다
}

// Postgres 연결 프로필 저장소. 위젯은 프로필 "이름"만 참조하므로
// 대시보드 JSON·내보내기 파일에 연결 문자열(비밀번호)이 새지 않는다.
export class PgProfiles {
  private profiles: PgProfile[] = [];

  constructor(readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.profiles = JSON.parse(await fs.readFile(this.file, 'utf8')) as PgProfile[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.profiles = [];
    }
  }

  names(): string[] {
    return this.profiles.map((p) => p.name);
  }

  get(name: string): PgProfile | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  async add(profile: PgProfile): Promise<void> {
    if (!/^[\w-]+$/.test(profile.name)) throw new Error(`invalid profile name: ${profile.name}`);
    if (!/^postgres(ql)?:\/\//.test(profile.connString)) {
      throw new Error('connString은 postgres:// 형식이어야 합니다');
    }
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
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.profiles, null, 2));
    await fs.rename(tmp, this.file);
  }
}
