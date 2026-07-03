import { describe, it, expect } from 'vitest';
import { classifyBundlePath } from '../src/update-helpers.js';
import { pickArm64ZipUrl } from '../src/update-helpers.js';
import { buildSwapScript } from '../src/update-helpers.js';
import { parseShellPath, sanitizeWindowBounds, sameVersion } from '../src/update-helpers.js';

describe('sameVersion', () => {
  it('선행 v 유무만 다르면 같은 버전', () => {
    expect(sameVersion('v0.26.0', '0.26.0')).toBe(true);
    expect(sameVersion('0.26.0', '0.26.0')).toBe(true);
  });
  it('다른 버전은 false, 빈 값도 false', () => {
    expect(sameVersion('v0.26.0', '0.27.0')).toBe(false);
    expect(sameVersion(undefined, '0.26.0')).toBe(false);
    expect(sameVersion('', '')).toBe(false);
  });
});

describe('buildSwapScript 안전한 교체 순서', () => {
  const script = buildSwapScript({ pid: 123, srcApp: '/tmp/new/PE.app', destApp: '/Applications/PE.app' });
  it('기존 번들을 지우기 전에 옆으로 치운다(rm 먼저 아님) + 실패 시 복구', () => {
    // 예전 'rm -rf dest && mv' 순서가 아니라 mv(dest→.old) 후 교체여야 한다
    expect(script).not.toMatch(/rm -rf '\/Applications\/PE\.app' &&/);
    expect(script).toContain(`mv '/Applications/PE.app' '/Applications/PE.app.old'`);
    expect(script).toContain(`mv '/Applications/PE.app.old' '/Applications/PE.app'`); // 복구 경로
  });
  it('새 번들 준비 실패 시 즉시 종료', () => {
    expect(script).toContain('|| exit 1');
  });
});

describe('parseShellPath', () => {
  it('센티널 사이의 PATH만 뽑는다(앞의 배너·경고 무시)', () => {
    const out = parseShellPath('nvm: v20\n__PE_PATH_START__/opt/homebrew/bin:/usr/bin__PE_PATH_END__');
    expect(out).toBe('/opt/homebrew/bin:/usr/bin');
  });
  it('마커가 없으면 undefined(폴백 유도)', () => {
    expect(parseShellPath('/opt/homebrew/bin:/usr/bin')).toBeUndefined();
  });
  it("'/'가 없는 빈 값이면 undefined", () => {
    expect(parseShellPath('__PE_PATH_START__X__PE_PATH_END__')).toBeUndefined();
  });
});

describe('sanitizeWindowBounds', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  it('작업영역과 겹치는 위치는 그대로 유지', () => {
    const b = { x: 100, y: 100, width: 800, height: 600 };
    expect(sanitizeWindowBounds(b, displays)).toEqual(b);
  });
  it('화면 밖(사라진 외부 모니터) 위치는 버리고 크기만 남긴다', () => {
    expect(sanitizeWindowBounds({ x: 3000, y: 200, width: 800, height: 600 }, displays))
      .toEqual({ width: 800, height: 600 });
  });
  it('좌표가 없으면 크기만 반환', () => {
    expect(sanitizeWindowBounds({ width: 800, height: 600 }, displays)).toEqual({ width: 800, height: 600 });
  });
});

describe('classifyBundlePath', () => {
  it('쓰기 가능하고 일반 경로면 custom', () => {
    expect(classifyBundlePath('/Users/me/Applications/PE Dashboard.app', true)).toBe('custom');
  });
  it('쓰기 불가면 manual', () => {
    expect(classifyBundlePath('/Applications/PE Dashboard.app', false)).toBe('manual');
  });
  it('App Translocation 경로면 manual', () => {
    expect(classifyBundlePath('/private/var/folders/x/AppTranslocation/ABC/d/PE Dashboard.app', true)).toBe('manual');
  });
});

describe('pickArm64ZipUrl', () => {
  const release = {
    tag_name: 'v0.23.0',
    assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/latest-mac.yml' },
      { name: 'PE-Dashboard-0.23.0-arm64-mac.zip.blockmap', browser_download_url: 'https://x/bm' },
      { name: 'PE-Dashboard-0.23.0-arm64-mac.zip', browser_download_url: 'https://x/app.zip' },
    ],
  };
  it('arm64 mac zip(블록맵 제외)의 download url을 고른다', () => {
    expect(pickArm64ZipUrl(release)).toBe('https://x/app.zip');
  });
  it('해당 에셋이 없으면 throw', () => {
    expect(() => pickArm64ZipUrl({ tag_name: 'v0.23.0', assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/y' },
    ] })).toThrow();
  });
});

describe('buildSwapScript', () => {
  const script = buildSwapScript({
    pid: 12345,
    srcApp: '/tmp/pe-update/extract/PE Dashboard.app',
    destApp: '/Users/me/Applications/PE Dashboard.app',
  });
  it('PID 종료를 기다린다', () => {
    expect(script).toContain('kill -0 12345');
  });
  it('ditto로 교체하고 quarantine를 제거하고 open으로 재실행한다', () => {
    expect(script).toContain('/usr/bin/ditto');
    expect(script).toContain('com.apple.quarantine');
    expect(script).toContain('/usr/bin/open');
  });
  it('경로를 작은따옴표로 감싼다(공백 안전)', () => {
    expect(script).toContain("'/Users/me/Applications/PE Dashboard.app'");
    expect(script).toContain("'/tmp/pe-update/extract/PE Dashboard.app'");
  });
});
