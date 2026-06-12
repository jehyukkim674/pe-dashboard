import pg from 'pg';
import type { CommandResult, WidgetDataSource } from '../types.js';
import type { DataSource } from './registry.js';
import type { PgProfiles } from './pgProfiles.js';

const QUERY_TIMEOUT_MS = 10_000;
const MAX_ROWS = 500;

// 조회 전용 강제: SELECT/WITH로 시작하는 단일 문만 허용한다.
// 실행 시에도 READ ONLY 트랜잭션이라 함수를 통한 우회 변경도 DB가 거부한다.
export function assertReadOnlyQuery(query: string): void {
  const trimmed = query.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error('SELECT/WITH로 시작하는 조회 쿼리만 허용됩니다');
  }
  if (trimmed.includes(';')) {
    throw new Error('여러 문장(;)은 허용되지 않습니다');
  }
}

export class PostgresSource implements DataSource {
  readonly kind = 'postgres';
  private readonly pools = new Map<string, pg.Pool>();

  constructor(private readonly profiles: PgProfiles) {}

  private pool(profileName: string): pg.Pool {
    const cached = this.pools.get(profileName);
    if (cached) return cached;
    const profile = this.profiles.get(profileName);
    if (!profile) throw new Error(`등록되지 않은 Postgres 프로필: ${profileName}`);
    const pool = new pg.Pool({
      connectionString: profile.connString,
      max: 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: QUERY_TIMEOUT_MS,
    });
    this.pools.set(profileName, pool);
    return pool;
  }

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const { profile, query } = dataSource;
    if (!profile || !query) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'profile과 query가 필요합니다' };
    }
    try {
      assertReadOnlyQuery(query);
      const client = await this.pool(profile).connect();
      try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const res = await client.query(query);
        await client.query('ROLLBACK');
        const rows = res.rows.slice(0, MAX_ROWS);
        return {
          ok: true, exitCode: 0, stderr: '',
          stdout: JSON.stringify(rows).slice(0, 1024 * 1024),
          json: rows,
        };
      } finally {
        client.release();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: message };
    }
  }
}
