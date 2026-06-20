import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

// JSON을 원자적으로 쓴다: 고유 tmp 파일에 쓴 뒤 rename — 부분 쓰기·전원 손실로 인한 손상과
// 같은 파일 동시 쓰기 충돌을 막는다. dashboardStore·commandRegistry·secretProfileStore·backup의
// 공통 쓰기 경로(원자적 쓰기 규칙의 단일 출처).
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
