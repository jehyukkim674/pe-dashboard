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
