import { describe, it, expect } from 'vitest';
import { compare, orderColumns, parseIsoTimestamp, readTablePrefs, statusColor } from '../src/components/widgets/tableFormat';

describe('compare (컬럼 정렬)', () => {
  it('양쪽 유한 수면 수치 비교', () => {
    expect(compare({ n: '2' }, { n: '10' }, 'n')).toBeLessThan(0); // 2 < 10 (문자열이면 '10'<'2')
    expect(compare({ n: 5 }, { n: 5 }, 'n')).toBe(0);
  });
  it('숫자가 아니면 문자열 비교', () => {
    expect(compare({ s: 'apple' }, { s: 'banana' }, 's')).toBeLessThan(0);
  });
  it("'Infinity'/'NaN' 문자열은 수치로 오인하지 않고 문자열 비교", () => {
    // Infinity로 오인하면 수치 비교가 되어 순서가 깨진다 — 문자열 비교로 안정적이어야 한다
    expect(compare({ v: 'Infinity' }, { v: 'Alpha' }, 'v')).toBeGreaterThan(0); // 'I' > 'A'
    expect(Number.isNaN(compare({ v: 'NaN' }, { v: 'zzz' }, 'v'))).toBe(false);
  });
});

describe('statusColor', () => {
  it('maps common status words to colors (case-insensitive)', () => {
    expect(statusColor('Synced')).toBe('green');
    expect(statusColor(' HEALTHY ')).toBe('green');
    expect(statusColor('OutOfSync')).toBe('red');
    expect(statusColor('Degraded')).toBe('red');
    expect(statusColor('Missing')).toBe('orange');
    expect(statusColor('Progressing')).toBe('orange');
  });

  it('returns undefined for non-status text', () => {
    expect(statusColor('argo-workflow')).toBeUndefined();
    expect(statusColor('0.1.5')).toBeUndefined();
    expect(statusColor('')).toBeUndefined();
  });
});

describe('parseIsoTimestamp', () => {
  it('parses ISO-8601 timestamps', () => {
    expect(parseIsoTimestamp('2026-06-12T16:38:40Z')).toBe(Date.parse('2026-06-12T16:38:40Z'));
  });

  it('rejects non-timestamp text', () => {
    expect(parseIsoTimestamp('0.1.5')).toBeUndefined();
    expect(parseIsoTimestamp('hello')).toBeUndefined();
    expect(parseIsoTimestamp('2026-06')).toBeUndefined();
  });
});

describe('orderColumns', () => {
  it('applies saved order first, appends new columns after', () => {
    expect(orderColumns(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });

  it('ignores saved keys that no longer exist', () => {
    expect(orderColumns(['a', 'b'], ['x', 'b'])).toEqual(['b', 'a']);
  });

  it('returns base order when nothing saved', () => {
    expect(orderColumns(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('readTablePrefs', () => {
  it('parses saved prefs', () => {
    const prefs = readTablePrefs({
      columnWidths: { name: 200 },
      columnFilters: { status: ['Synced'] },
      columnSort: { key: 'name', order: 'ascend' },
      hiddenColumns: ['url'],
      columnOrder: ['status', 'name'],
    });
    expect(prefs.widths).toEqual({ name: 200 });
    expect(prefs.filters).toEqual({ status: ['Synced'] });
    expect(prefs.sort).toEqual({ key: 'name', order: 'ascend' });
    expect(prefs.hidden).toEqual(['url']);
    expect(prefs.order).toEqual(['status', 'name']);
  });

  it('tolerates garbage values (display는 AI도 수정 가능)', () => {
    const prefs = readTablePrefs({
      columnWidths: 'oops', columnFilters: { a: 'not-array' },
      columnSort: { key: 1, order: 'sideways' }, hiddenColumns: [1, 'ok'], columnOrder: [],
    });
    expect(prefs.widths).toEqual({});
    expect(prefs.filters).toEqual({});
    expect(prefs.sort).toBeUndefined();
    expect(prefs.hidden).toEqual(['ok']);
    expect(prefs.order).toBeUndefined();
  });
});
