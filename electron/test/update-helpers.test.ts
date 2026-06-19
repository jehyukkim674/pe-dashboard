import { describe, it, expect } from 'vitest';
import { classifyBundlePath } from '../src/update-helpers.js';

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
