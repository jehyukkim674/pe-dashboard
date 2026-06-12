import { describe, it, expect } from 'vitest';
import { relativeTime } from '../src/hooks/useWidgetData';
import { sanitizeNotes } from '../src/components/UpdateModal';

describe('relativeTime', () => {
  const base = 1_000_000_000;
  it('formats seconds, minutes, hours', () => {
    expect(relativeTime(base, base + 3_000)).toBe('방금');
    expect(relativeTime(base, base + 32_000)).toBe('32초 전');
    expect(relativeTime(base, base + 5 * 60_000)).toBe('5분 전');
    expect(relativeTime(base, base + 2 * 3_600_000)).toBe('2시간 전');
  });
  it('never goes negative', () => {
    expect(relativeTime(base + 10_000, base)).toBe('방금');
  });
});

describe('sanitizeNotes', () => {
  it('keeps formatting tags but strips scripts and handlers', () => {
    const html = '<h3>기능</h3><ul><li onclick="x()">항목</li></ul><script>alert(1)</script><a href="javascript:bad()">x</a>';
    const out = sanitizeNotes(html);
    expect(out).toContain('<h3>기능</h3>');
    expect(out).toContain('<li');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
  });
});
