import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../src/jsonFile.js';

describe('writeJsonAtomic', () => {
  it('writes pretty JSON that round-trips', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jf-'));
    const file = path.join(dir, 'x.json');
    await writeJsonAtomic(file, { a: 1, b: ['x'] });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: 1, b: ['x'] });
  });

  it('overwrites an existing file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jf-'));
    const file = path.join(dir, 'x.json');
    await writeJsonAtomic(file, { v: 1 });
    await writeJsonAtomic(file, { v: 2 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('leaves no temp file behind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jf-'));
    await writeJsonAtomic(path.join(dir, 'x.json'), { v: 1 });
    expect(await readdir(dir)).toEqual(['x.json']);
  });
});
