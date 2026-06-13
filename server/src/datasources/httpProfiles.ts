import { promises as fs } from 'node:fs';

export interface HttpProfile {
  name: string;
  headers: Record<string, string>; // 예: { Authorization: "Bearer ..." } — 비밀이라 export 번들에 포함하지 않는다
}

// HTTP 위젯의 인증 헤더 프로필 저장소. 위젯은 프로필 "이름"만 참조하므로
// 대시보드 JSON·내보내기 파일에 토큰이 새지 않는다. (PgProfiles와 같은 패턴)
export class HttpProfiles {
  private profiles: HttpProfile[] = [];

  constructor(readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.profiles = JSON.parse(await fs.readFile(this.file, 'utf8')) as HttpProfile[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.profiles = [];
    }
  }

  names(): string[] {
    return this.profiles.map((p) => p.name);
  }

  get(name: string): HttpProfile | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  async add(profile: HttpProfile): Promise<void> {
    if (!/^[\w-]+$/.test(profile.name)) throw new Error(`invalid profile name: ${profile.name}`);
    const headers = profile.headers ?? {};
    if (Object.keys(headers).length === 0) throw new Error('헤더를 최소 1개 입력하세요');
    for (const [k, v] of Object.entries(headers)) {
      // 헤더 이름은 토큰 문자만, 값에는 제어문자(CR/LF 인젝션) 금지
      if (!/^[\w-]+$/.test(k)) throw new Error(`잘못된 헤더 이름: ${k}`);
      if (/[\r\n]/.test(v)) throw new Error(`헤더 값에 줄바꿈이 포함될 수 없습니다: ${k}`);
    }
    if (this.get(profile.name)) throw new Error(`profile already exists: ${profile.name}`);
    this.profiles.push({ name: profile.name, headers });
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
