import { describeCapability } from './capabilities.js';

// 도구 호출을 채팅 액션 칩에 표시할 한국어 한 줄 요약으로 변환한다.
// 요약 문구의 단일 출처는 capabilities.ts다 (능력별 describe). 여기는 그 facade.
export function describeToolCall(name: string, input: unknown): string {
  return describeCapability(name, input);
}
