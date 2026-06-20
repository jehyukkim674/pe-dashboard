import { describe, it, expect } from 'vitest';
import { getPath } from '../src/utils/json';
import { asRows } from '../src/utils/commandResult';
import type { CommandResult } from '../src/types';

describe('getPath', () => {
  it('reads nested values by dotted path', () => {
    expect(getPath({ a: { b: { c: 3 } } }, 'a.b.c')).toBe(3);
    expect(getPath({ items: [{ x: 1 }] }, 'items.0.x')).toBe(1);
  });
  it('returns undefined when the path breaks', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath('str', 'length')).toBeUndefined(); // 비객체 중간값
  });
});

describe('asRows', () => {
  const ok = (json: unknown): CommandResult => ({ ok: true, exitCode: 0, stdout: '', stderr: '', json });
  it('returns the array when json is an array', () => {
    expect(asRows(ok([{ a: 1 }, { a: 2 }]))).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('returns [] for non-array json, missing json, or undefined result', () => {
    expect(asRows(ok({ a: 1 }))).toEqual([]);
    expect(asRows(ok(undefined))).toEqual([]);
    expect(asRows(undefined)).toEqual([]);
  });
});
