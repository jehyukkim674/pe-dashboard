// 순수 함수 모음 — electron 모듈을 import하지 않는다(vitest가 node 환경에서 불러오므로).

export type InstallStrategy = 'squirrel' | 'custom' | 'manual';

// 미서명 빌드에서 in-app 교체가 가능한지 경로로 판정한다.
// App Translocation(읽기 전용 무작위 경로)이거나 쓰기 불가면 수동 폴백.
export function classifyBundlePath(bundlePath: string, isWritable: boolean): 'custom' | 'manual' {
  if (!isWritable) return 'manual';
  if (bundlePath.includes('/AppTranslocation/')) return 'manual';
  return 'custom';
}

export interface GithubAsset { name: string; browser_download_url: string }
export interface GithubRelease { tag_name?: string; assets: GithubAsset[] }

// arm64 mac zip 에셋의 다운로드 URL을 고른다(.blockmap 제외).
export function pickArm64ZipUrl(release: GithubRelease): string {
  const asset = release.assets.find(
    (a) => /-arm64-mac\.zip$/.test(a.name) && !a.name.endsWith('.blockmap'),
  );
  if (!asset) throw new Error('릴리스에서 arm64 mac zip 에셋을 찾지 못했습니다');
  return asset.browser_download_url;
}

// 로그인 셸이 출력한 PATH를 센티널 마커 사이에서만 뽑아낸다.
// 로그인 셸은 .zprofile/.zshenv 등을 소싱하며 stdout에 배너·경고(nvm 등)를 찍을 수 있는데,
// 예전처럼 stdout 전체를 PATH로 쓰면 그 잡음이 첫 PATH 항목에 붙어 CLI 탐색이 조용히 깨진다.
// main.ts는 `printf "__PE_PATH_START__%s__PE_PATH_END__" "$PATH"` 로 값을 감싸 출력한다.
export function parseShellPath(stdout: string): string | undefined {
  const m = /__PE_PATH_START__([\s\S]*)__PE_PATH_END__/.exec(stdout);
  const value = m?.[1];
  if (!value || !value.includes('/')) return undefined; // 마커 없음/빈 값 → 폴백
  return value;
}

export interface Rect { x?: number; y?: number; width?: number; height?: number }
export interface WorkArea { x: number; y: number; width: number; height: number }

// 저장된 창 위치를 현재 연결된 디스플레이에 맞게 정리한다. 이전 세션이 외부 모니터에서
// 끝났고 그 모니터가 사라졌으면 저장된 x/y가 화면 밖이라 창이 보이지 않는데(스플래시만 뜨고
// 멈춘 듯 보임), 그 경우 위치는 버리고 크기만 남겨 Electron이 창을 중앙에 띄우게 한다.
export function sanitizeWindowBounds(saved: Rect, workAreas: WorkArea[]): Rect {
  const { x, y, width, height } = saved;
  const sizeOnly: Rect = {
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
  };
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
    return sizeOnly;
  }
  const visible = workAreas.some(
    (wa) => x < wa.x + wa.width && x + width > wa.x && y < wa.y + wa.height && y + height > wa.y,
  );
  return visible ? saved : sizeOnly;
}

// 작은따옴표 셸 인용(경로 내 작은따옴표도 안전 처리).
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// 우리 프로세스 종료를 기다렸다가 번들을 교체·재실행하는 bash 스크립트를 만든다.
export function buildSwapScript(opts: { pid: number; srcApp: string; destApp: string }): string {
  const src = shellQuote(opts.srcApp);
  const dest = shellQuote(opts.destApp);
  const destNew = shellQuote(`${opts.destApp}.new`);
  return [
    '#!/bin/bash',
    `while kill -0 ${opts.pid} 2>/dev/null; do sleep 0.2; done`,
    `/usr/bin/ditto ${src} ${destNew} && rm -rf ${dest} && mv ${destNew} ${dest}`,
    `/usr/bin/xattr -dr com.apple.quarantine ${dest} 2>/dev/null || true`,
    `/usr/bin/open ${dest}`,
    '',
  ].join('\n');
}
