import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertReadOnlyQuery } from '../src/datasources/postgresSource.js';
import { PgProfiles } from '../src/datasources/pgProfiles.js';

describe('assertReadOnlyQuery', () => {
  it('allows SELECT/WITH single statements', () => {
    expect(() => assertReadOnlyQuery('SELECT 1')).not.toThrow();
    expect(() => assertReadOnlyQuery('  select * from t;')).not.toThrow();
    expect(() => assertReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x')).not.toThrow();
  });
  it('rejects mutations and multi-statements', () => {
    expect(() => assertReadOnlyQuery('DROP TABLE users')).toThrow(/조회 쿼리만/);
    expect(() => assertReadOnlyQuery('UPDATE t SET a=1')).toThrow(/조회 쿼리만/);
    expect(() => assertReadOnlyQuery('SELECT 1; DROP TABLE t')).toThrow(/여러 문장/);
  });
});

describe('PgProfiles', () => {
  it('stores profiles, exposes names only, validates input', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pg-'));
    const profiles = new PgProfiles(path.join(dir, 'pg-profiles.json'));
    await profiles.load();
    await profiles.add({ name: 'local', connString: 'postgres://localhost:5432/postgres' });
    expect(profiles.names()).toEqual(['local']);
    await expect(profiles.add({ name: 'bad name!', connString: 'postgres://x' })).rejects.toThrow(/invalid/);
    await expect(profiles.add({ name: 'x', connString: 'mysql://nope' })).rejects.toThrow(/postgres/);
    await expect(profiles.add({ name: 'local', connString: 'postgres://y' })).rejects.toThrow(/exists/);

    const again = new PgProfiles(profiles.file);
    await again.load();
    expect(again.get('local')?.connString).toContain('5432');
    expect(await again.remove('local')).toBe(true);
  });
});
