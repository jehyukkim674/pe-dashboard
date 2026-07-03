import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

// JSON을 원자적으로 쓴다: 고유 tmp 파일에 쓴 뒤 rename — 부분 쓰기로 인한 손상과
// 같은 파일 동시 쓰기 충돌을 막는다. dashboardStore·commandRegistry·secretProfileStore·backup의
// 공통 쓰기 경로(원자적 쓰기 규칙의 단일 출처).
// mode를 주면 tmp 파일 생성 시 권한을 지정한다(비밀 프로필은 0o600). 쓰기/rename 실패 시
// tmp 파일을 남기지 않고 정리한다(디스크 꽉 참·크래시 사이 등에서 고아 tmp가 쌓이는 것 방지).
export async function writeJsonAtomic(file: string, data: unknown, mode?: number): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), mode !== undefined ? { mode } : undefined);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}
