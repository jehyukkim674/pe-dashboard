import type { CommandResult, WidgetDataSource } from '../types.js';
import type { CommandRegistry } from '../commands/registry.js';
import { runArgv } from '../commands/runner.js';
import { ResultCache } from '../commands/resultCache.js';
import type { SshProfiles, SshProfile } from './sshProfiles.js';
import type { DataSource } from './registry.js';

const SSH_TIMEOUT_MS = 15_000; // 원격 왕복은 로컬보다 느릴 수 있어 여유를 둔다

// 원격 셸이 각 인자를 재해석하지 않도록 단일 따옴표로 감싼다(원격 측 셸 인젝션 방지).
function shellQuoteSingle(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// 화이트리스트로 만들어진 원격 argv를 ssh 실행 argv로 감싼다.
// - target(user@host)·포트는 프로필에서. host는 프로필 검증에서 '-' 시작이 막혀 옵션 오인이 없다.
// - BatchMode=yes: 비밀번호 프롬프트로 멈추지 않게. StrictHostKeyChecking=accept-new: 첫 접속 자동 수락.
export function buildSshArgv(profile: SshProfile, remoteArgv: string[]): string[] {
  const target = profile.user ? `${profile.user}@${profile.host}` : profile.host;
  const opts = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'StrictHostKeyChecking=accept-new',
  ];
  if (profile.port) opts.push('-p', String(profile.port));
  const remoteCmd = remoteArgv.map(shellQuoteSingle).join(' ');
  return ['ssh', ...opts, target, remoteCmd];
}

// 등록된 명령 템플릿을 SSH 프로필의 원격 호스트에서 실행하는 데이터 소스.
// 원격에서 돌릴 명령도 CLI와 동일한 화이트리스트(buildArgv → safety)를 거친다.
export class SshSource implements DataSource {
  readonly kind = 'ssh';

  constructor(
    private readonly commands: CommandRegistry,
    private readonly profiles: SshProfiles,
    private readonly cache: ResultCache = new ResultCache(),
  ) {}

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    if (!dataSource.sshProfile) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: 'sshProfile이 필요합니다' };
    }
    const profile = this.profiles.get(dataSource.sshProfile);
    if (!profile) {
      return {
        ok: false, exitCode: null, stdout: '', stderr: '',
        error: `SSH 프로필을 찾을 수 없습니다: ${dataSource.sshProfile}`,
      };
    }
    // 원격 명령을 화이트리스트 템플릿에서 안전하게 조립 (실패 시 throw → 라우트가 400)
    const remoteArgv = this.commands.buildArgv(dataSource.commandId, dataSource.params);
    const sshArgv = buildSshArgv(profile, remoteArgv);
    return this.cache.run(sshArgv, () => runArgv(sshArgv, SSH_TIMEOUT_MS));
  }
}
