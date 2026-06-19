// 순수 함수 모음 — electron 모듈을 import하지 않는다(vitest가 node 환경에서 불러오므로).

export type InstallStrategy = 'squirrel' | 'custom' | 'manual';

// 미서명 빌드에서 in-app 교체가 가능한지 경로로 판정한다.
// App Translocation(읽기 전용 무작위 경로)이거나 쓰기 불가면 수동 폴백.
export function classifyBundlePath(bundlePath: string, isWritable: boolean): 'custom' | 'manual' {
  if (!isWritable) return 'manual';
  if (bundlePath.includes('/AppTranslocation/')) return 'manual';
  return 'custom';
}
