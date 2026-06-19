import { describe, it, expect } from 'vitest';
import { classifyBundlePath } from '../src/update-helpers.js';
import { pickArm64ZipUrl } from '../src/update-helpers.js';

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
