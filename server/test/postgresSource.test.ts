import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertReadOnlyQuery, buildParameterizedQuery } from '../src/datasources/postgresSource.js';
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

describe('buildParameterizedQuery', () => {
  it('{name}을 $N 위치 파라미터로 바꾸고 값 배열을 만든다', () => {
    const { text, values } = buildParameterizedQuery(
      'SELECT * FROM jobs WHERE env = {env} AND status = {status}',
      { env: 'prod', status: 'failed' },
    );
    expect(text).toBe('SELECT * FROM jobs WHERE env = $1 AND status = $2');
    expect(values).toEqual(['prod', 'failed']);
  });
  it('같은 이름이 반복되면 같은 $N을 재사용한다', () => {
    const { text, values } = buildParameterizedQuery(
      'SELECT * FROM t WHERE a = {x} OR b = {x}',
      { x: '5' },
    );
    expect(text).toBe('SELECT * FROM t WHERE a = $1 OR b = $1');
    expect(values).toEqual(['5']);
  });
  it('값은 항상 파라미터로 바인딩돼 인젝션이 무력화된다', () => {
    // 악의적 값이 들어와도 SQL 텍스트엔 $1만 남고, 값은 데이터로만 전달된다
    const { text, values } = buildParameterizedQuery('SELECT {v}', { v: "1; DROP TABLE t--" });
    expect(text).toBe('SELECT $1');
    expect(values).toEqual(["1; DROP TABLE t--"]);
  });
  it('파라미터 값이 없으면 예외', () => {
    expect(() => buildParameterizedQuery('SELECT {missing}', {})).toThrow(/누락/);
  });
  it('플레이스홀더가 없으면 원문 그대로, 빈 값 배열', () => {
    expect(buildParameterizedQuery('SELECT 1', {})).toEqual({ text: 'SELECT 1', values: [] });
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
