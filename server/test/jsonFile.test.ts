import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, stat, mkdir } from 'node:fs/promises';
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

  it('mode를 주면 소유자 전용(0600) 권한으로 쓴다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jf-'));
    const file = path.join(dir, 'secret.json');
    await writeJsonAtomic(file, { token: 'x' }, 0o600);
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rename 실패 시(대상이 디렉터리) 남은 tmp를 정리한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jf-'));
    const target = path.join(dir, 'x.json');
    await mkdir(target); // 대상 경로를 디렉터리로 선점 → rename(tmp, target) 실패 유도
    await expect(writeJsonAtomic(target, { v: 1 })).rejects.toThrow();
    // tmp는 생성됐다가 정리돼야 한다 — 디렉터리 하나만 남고 .tmp는 없어야 한다
    expect(await readdir(dir)).toEqual(['x.json']);
  });
});
