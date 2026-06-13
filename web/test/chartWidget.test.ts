import { describe, it, expect } from 'vitest';
import { formatTick, parseYKeys } from '../src/components/widgets/ChartWidget';

describe('formatTick', () => {
  it('abbreviates large numbers', () => {
    expect(formatTick(950)).toBe('950');
    expect(formatTick(1234)).toBe('1.2k');
    expect(formatTick(3_400_000)).toBe('3.4M');
    expect(formatTick(2_000_000_000)).toBe('2B');
    expect(formatTick(-1500)).toBe('-1.5k');
  });
  it('drops trailing .0', () => {
    expect(formatTick(2000)).toBe('2k');
  });
  it('passes through non-numbers', () => {
    expect(formatTick('Synced')).toBe('Synced');
    expect(formatTick(undefined)).toBe('');
  });
});

describe('parseYKeys', () => {
  it('parses a single key', () => {
    expect(parseYKeys('count')).toEqual(['count']);
  });
  it('parses a comma-separated string into multiple series', () => {
    expect(parseYKeys('success, failure , pending')).toEqual(['success', 'failure', 'pending']);
  });
  it('accepts arrays and trims/filters blanks', () => {
    expect(parseYKeys([' a ', '', 'b'])).toEqual(['a', 'b']);
  });
  it('returns empty for missing yKey', () => {
    expect(parseYKeys(undefined)).toEqual([]);
    expect(parseYKeys('')).toEqual([]);
  });
});
