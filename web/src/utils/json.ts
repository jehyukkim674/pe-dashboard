// 점 표기 경로로 중첩 객체/JSON을 안전하게 읽는다 (중간이 객체가 아니거나 없으면 undefined).
// StatWidget·StatusWidget·tableFormat(valueAt)이 공유하는 단일 접근자.
export function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>(
    (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}
