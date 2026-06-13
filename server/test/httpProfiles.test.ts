import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpProfiles } from '../src/datasources/httpProfiles.js';
import { HttpSource } from '../src/datasources/httpSource.js';

async function makeProfiles(): Promise<HttpProfiles> {
  const dir = await mkdtemp(path.join(tmpdir(), 'httpprof-'));
  const profiles = new HttpProfiles(path.join(dir, 'http-profiles.json'));
  await profiles.load();
  return profiles;
}

describe('HttpProfiles', () => {
  let profiles: HttpProfiles;
  beforeEach(async () => { profiles = await makeProfiles(); });

  it('stores headers and exposes only names', async () => {
    await profiles.add({ name: 'internal', headers: { Authorization: 'Bearer secret' } });
    expect(profiles.names()).toEqual(['internal']);
    expect(profiles.get('internal')?.headers.Authorization).toBe('Bearer secret');
  });

  it('rejects empty headers and invalid header names', async () => {
    await expect(profiles.add({ name: 'x', headers: {} })).rejects.toThrow(/헤더/);
    await expect(profiles.add({ name: 'y', headers: { 'bad name': 'v' } })).rejects.toThrow(/헤더 이름/);
  });

  it('rejects header values with newlines (CRLF 인젝션 방지)', async () => {
    await expect(profiles.add({ name: 'z', headers: { 'X-A': 'v\r\nX-Evil: 1' } })).rejects.toThrow(/줄바꿈/);
  });

  it('rejects duplicate and invalid names', async () => {
    await profiles.add({ name: 'dup', headers: { A: '1' } });
    await expect(profiles.add({ name: 'dup', headers: { A: '1' } })).rejects.toThrow(/already exists/);
    await expect(profiles.add({ name: 'bad name', headers: { A: '1' } })).rejects.toThrow(/invalid profile name/);
  });

  it('persists across reload and removes', async () => {
    await profiles.add({ name: 'keep', headers: { A: '1' } });
    const reloaded = new HttpProfiles(profiles.file);
    await reloaded.load();
    expect(reloaded.names()).toEqual(['keep']);
    expect(await reloaded.remove('keep')).toBe(true);
    expect(await reloaded.remove('keep')).toBe(false);
  });
});

describe('HttpSource with profiles', () => {
  it('attaches profile headers to the request', async () => {
    const profiles = await makeProfiles();
    await profiles.add({ name: 'internal', headers: { Authorization: 'Bearer T', 'X-Api-Key': 'K' } });
    const source = new HttpSource(profiles);

    let seenHeaders: Headers | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers);
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    try {
      const result = await source.fetch({
        kind: 'http', commandId: '', params: {}, url: 'https://example.com', httpProfile: 'internal',
      });
      expect(result.ok).toBe(true);
      expect(seenHeaders?.get('authorization')).toBe('Bearer T');
      expect(seenHeaders?.get('x-api-key')).toBe('K');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('errors clearly when the named profile is missing', async () => {
    const source = new HttpSource(await makeProfiles());
    const result = await source.fetch({
      kind: 'http', commandId: '', params: {}, url: 'https://example.com', httpProfile: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/프로필을 찾을 수 없습니다/);
  });
});
