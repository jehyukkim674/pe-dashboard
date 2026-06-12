// 위험(파괴·변경) 명령 차단. 대시보드 위젯은 읽기 전용 조회 도구이므로
// 등록 시점(validateTemplate)과 실행 시점(buildArgv) 양쪽에서 검사한다.
// 셸 간접 실행(bash -c 등)도 막아 우회를 차단한다.

const DENY_BINARIES = new Set([
  // 파괴적 시스템 명령
  'rm', 'rmdir', 'dd', 'mkfs', 'shred', 'truncate', 'mv', 'ln',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'kill', 'killall', 'pkill',
  'chmod', 'chown', 'chgrp',
  'launchctl', 'diskutil', 'crontab', 'osascript',
  // 권한 상승
  'sudo', 'su', 'doas',
  // 셸·간접 실행 (우회 차단)
  'sh', 'bash', 'zsh', 'dash', 'fish', 'env', 'xargs', 'nohup', 'eval', 'nc',
]);

// 서브커맨드/플래그 단위의 변경성 토큰. argv 요소와 정확히 일치할 때만 차단하므로
// 값 일부에 단어가 포함된 경우(예: repo 이름 'my-delete-log')는 통과한다.
const DENY_TOKENS = new Set([
  // 삭제·파괴
  'delete', 'remove', 'destroy', 'terminate', 'prune', 'purge', 'uninstall', 'rm',
  // 배포·변경
  'apply', 'patch', 'push', 'sync', 'rollback', 'restart', 'stop', 'kill',
  'scale', 'drain', 'cordon', 'exec', 'create', 'edit', 'set', 'update',
  // git 변경 계열
  'reset', 'clean', 'rebase', 'merge', 'commit', 'checkout', 'restore', 'revert',
  // 위험 플래그
  '--force', '--hard', '--delete', '-delete', '-exec', '--prune', '--rm',
]);

export function assertSafeArgv(argv: string[]): void {
  const bin = (argv[0] ?? '').split('/').pop()?.toLowerCase() ?? '';
  if (DENY_BINARIES.has(bin)) {
    throw new Error(`위험한 명령이라 차단되었습니다: '${argv[0]}' 실행은 허용되지 않습니다 (읽기 전용 명령만 가능)`);
  }
  for (const part of argv.slice(1)) {
    if (DENY_TOKENS.has(part.toLowerCase())) {
      throw new Error(`위험한 명령이라 차단되었습니다: '${part}' 인자는 허용되지 않습니다 (읽기 전용 명령만 가능)`);
    }
  }
}
