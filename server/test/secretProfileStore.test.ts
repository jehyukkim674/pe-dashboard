import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SecretProfileStore } from '../src/datasources/secretProfileStore.js';

interface Demo { name: string; secret: string; }

async function makeStore(): Promise<SecretProfileStore<Demo>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sps-'));
  const store = new SecretProfileStore<Demo>(
    path.join(dir, 'demo.json'),
    (p) => { if (!p.secret) throw new Error('secret required'); },
  );
  await store.load();
  return store;
}

describe('SecretProfileStore', () => {
  let store: SecretProfileStore<Demo>;
  beforeEach(async () => { store = await makeStore(); });

  it('loads empty when the file is missing', () => {
    expect(store.names()).toEqual([]);
  });

  it('손상된(배열 아님) 파일이면 빈 목록으로 로드해 names()가 죽지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sps-'));
    const file = path.join(dir, 'demo.json');
    await writeFile(file, '{"corrupt":true}');
    const s = new SecretProfileStore<Demo>(file, () => {});
    await s.load();
    expect(() => s.names()).not.toThrow();
    expect(s.names()).toEqual([]);
  });

  it('adds and exposes only names; get returns the full entry', async () => {
    await store.add({ name: 'a', secret: 's' });
    expect(store.names()).toEqual(['a']);
    expect(store.get('a')?.secret).toBe('s');
  });

  it('rejects invalid names before running the validator', async () => {
    // 비밀이 비어 있어도 이름 검증이 먼저 걸린다 (검증 순서 보존)
    await expect(store.add({ name: 'bad name', secret: '' })).rejects.toThrow(/invalid profile name/);
  });

  it('runs the injected secret validator', async () => {
    await expect(store.add({ name: 'x', secret: '' })).rejects.toThrow(/secret required/);
  });

  it('rejects duplicate names', async () => {
    await store.add({ name: 'dup', secret: 's' });
    await expect(store.add({ name: 'dup', secret: 's' })).rejects.toThrow(/already exists/);
  });

  it('persists across reload and removes idempotently', async () => {
    await store.add({ name: 'keep', secret: 's' });
    const reloaded = new SecretProfileStore<Demo>(store.file, () => {});
    await reloaded.load();
    expect(reloaded.names()).toEqual(['keep']);
    expect(await reloaded.remove('keep')).toBe(true);
    expect(await reloaded.remove('keep')).toBe(false);
  });
});
