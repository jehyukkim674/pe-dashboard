import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../src/utils/sanitize';

describe('sanitizeHtml', () => {
  it('script/style/iframe 블록을 제거한다', () => {
    expect(sanitizeHtml('<script>alert(1)</script>hi')).toBe('hi');
    expect(sanitizeHtml('<b>ok</b><iframe src=x></iframe>')).toBe('<b>ok</b>');
  });

  it('공백으로 구분된 이벤트 핸들러를 제거한다', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).not.toMatch(/onerror/i);
    expect(sanitizeHtml('<div onclick="steal()">x</div>')).not.toMatch(/onclick/i);
  });

  it("'/'로 구분된 이벤트 핸들러도 제거한다 (우회 방지)", () => {
    // <img/onerror=...> 는 공백 없이 슬래시로 속성을 붙이는 XSS 우회 기법
    const out = sanitizeHtml('<img/onerror=alert(1) src=x>');
    expect(out).not.toMatch(/onerror/i);
    const out2 = sanitizeHtml('<svg/onload=alert(1)>');
    expect(out2).not.toMatch(/onload/i);
  });

  it('javascript: 스킴을 제거한다', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
  });
});
