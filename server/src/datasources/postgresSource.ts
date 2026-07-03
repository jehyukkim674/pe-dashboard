import pg from 'pg';
import type { CommandResult, WidgetDataSource } from '../types.js';
import type { DataSource } from './registry.js';
import type { PgProfiles } from './pgProfiles.js';
import { logCommand } from '../commands/auditLog.js';

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

// 위젯 파라미터 연동: 쿼리의 {name}을 pg 위치 파라미터 $N으로 바꾸고 값 배열을 만든다.
// 문자열 보간이 아니라 파라미터 바인딩이므로 SQL 인젝션이 원천 차단된다(값은 항상 데이터로 취급).
// 같은 이름이 여러 번 나오면 같은 $N을 재사용한다.
export function buildParameterizedQuery(
  query: string,
  params: Record<string, string> = {},
): { text: string; values: string[] } {
  const values: string[] = [];
  const indexByName = new Map<string, number>();
  const text = query.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (params[name] === undefined) throw new Error(`쿼리 파라미터 누락: ${name}`);
    let idx = indexByName.get(name);
    if (idx === undefined) {
      values.push(params[name]);
      idx = values.length; // pg 위치 파라미터는 1-based ($1, $2, …)
      indexByName.set(name, idx);
    }
    return `$${idx}`;
  });
  return { text, values };
}

export class PostgresSource implements DataSource {
  readonly kind = 'postgres';
  // 프로필명 → 풀. connString도 함께 저장해 프로필이 바뀌면 풀을 재생성한다.
  private readonly pools = new Map<string, { pool: pg.Pool; connString: string }>();

  constructor(private readonly profiles: PgProfiles) {}

  private pool(profileName: string): pg.Pool {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      // 프로필이 삭제됐다면 캐시된 풀도 함께 정리해 삭제된 프로필로 계속 조회되는 것을 막는다
      this.pools.get(profileName)?.pool.end().catch(() => {});
      this.pools.delete(profileName);
      throw new Error(`등록되지 않은 Postgres 프로필: ${profileName}`);
    }
    const cached = this.pools.get(profileName);
    if (cached && cached.connString === profile.connString) return cached.pool;
    // 같은 이름이지만 연결 문자열이 바뀌었으면(프로필 재생성 등) 낡은 풀을 폐기하고 새로 만든다
    if (cached) cached.pool.end().catch(() => {});
    const pool = new pg.Pool({
      connectionString: profile.connString,
      max: 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: QUERY_TIMEOUT_MS,
    });
    // 유휴 클라이언트의 커넥션 오류가 'error' 이벤트로 올라와 프로세스를 죽이지 않도록 흡수한다
    // (pg.Pool은 다음 요청에서 알아서 재연결한다).
    pool.on('error', () => {});
    this.pools.set(profileName, { pool, connString: profile.connString });
    return pool;
  }

  private async runQuery(
    profileName: string,
    text: string,
    values: string[],
  ): Promise<unknown[]> {
    const client = await this.pool(profileName).connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const res = await client.query(text, values);
      await client.query('ROLLBACK');
      client.release();
      return res.rows.slice(0, MAX_ROWS);
    } catch (e) {
      // 트랜잭션이 열린 채 실패하면 커넥션이 오염된다 — 풀로 돌려보내지 말고 폐기한다
      client.release(e as Error);
      throw e;
    }
  }

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const { profile, query } = dataSource;
    if (!profile || !query) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'profile과 query가 필요합니다' };
    }
    const startedAt = Date.now();
    try {
      assertReadOnlyQuery(query);
      // {name} → $N 위치 파라미터 (위젯 params와 연동, 인젝션 안전)
      const { text, values } = buildParameterizedQuery(query, dataSource.params);
      const rows = await this.runQuery(profile, text, values);
      logCommand({ argv: [`pg:${profile}`, query], ok: true, exitCode: 0, durationMs: Date.now() - startedAt });
      return {
        ok: true, exitCode: 0, stderr: '',
        stdout: JSON.stringify(rows).slice(0, 1024 * 1024),
        json: rows,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logCommand({ argv: [`pg:${profile}`, query], ok: false, exitCode: null, durationMs: Date.now() - startedAt });
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: message };
    }
  }
}
