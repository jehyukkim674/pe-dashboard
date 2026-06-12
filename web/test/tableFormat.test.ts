import { describe, it, expect } from 'vitest';
import { orderColumns, parseIsoTimestamp, readTablePrefs, statusColor } from '../src/components/widgets/tableFormat';

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
