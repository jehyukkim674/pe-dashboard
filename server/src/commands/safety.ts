// CLI 명령 안전성 평가. 두 단계로 나눈다:
// - block: 파괴적이거나 권한 상승이라 무조건 차단 (등록·실행 모두 거부)
// - warn:  변경성이라 위험할 수 있음 — 등록은 허용하되 채팅 승인 UI에 경고를 띄워
//          사용자가 직접 판단하게 한다 (승인된 템플릿의 실행은 막지 않음)

export interface SafetyAssessment {
  level: 'ok' | 'warn' | 'block';
  reason?: string;
}

const BLOCK_BINARIES = new Set([
  'rm', 'rmdir', 'dd', 'mkfs', 'shred',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'sudo', 'su', 'doas',
]);

const WARN_BINARIES = new Set([
  // 셸·간접 실행 (어떤 명령이든 숨길 수 있음)
  'sh', 'bash', 'zsh', 'dash', 'fish', 'env', 'xargs', 'nohup', 'nc', 'osascript',
  // 시스템 상태 변경
  'kill', 'killall', 'pkill', 'chmod', 'chown', 'chgrp', 'mv', 'ln', 'truncate',
  'launchctl', 'diskutil', 'crontab',
]);

// 변경성 서브커맨드/플래그. argv 요소와 정확히 일치할 때만 경고하므로
// 값 일부에 단어가 포함된 경우(예: repo 이름 'my-delete-log')는 통과한다.
const WARN_TOKENS = new Set([
  'delete', 'remove', 'destroy', 'terminate', 'prune', 'purge', 'uninstall', 'rm',
  'apply', 'push', 'sync', 'rollback', 'restart', 'stop', 'kill', 'drain', 'cordon', 'exec',
  'reset', 'clean', 'rebase', 'merge', 'checkout', 'restore', 'revert',
  '--force', '--hard', '--delete', '-delete', '-exec', '--prune', '--rm',
]);

export function assessArgv(argv: string[]): SafetyAssessment {
  const bin = (argv[0] ?? '').split('/').pop()?.toLowerCase() ?? '';
  if (BLOCK_BINARIES.has(bin)) {
    return { level: 'block', reason: `'${argv[0]}' 은(는) 파괴적인 명령이라 사용할 수 없습니다` };
  }
  if (WARN_BINARIES.has(bin)) {
    return { level: 'warn', reason: `'${argv[0]}' 은(는) 시스템을 변경하거나 임의 명령을 실행할 수 있습니다` };
  }
  for (const part of argv.slice(1)) {
    if (WARN_TOKENS.has(part.toLowerCase())) {
      return { level: 'warn', reason: `'${part}' 인자는 데이터를 변경·삭제할 수 있습니다` };
    }
  }
  return { level: 'ok' };
}

// block 레벨만 거부한다. warn 레벨은 호출 측에서 경고를 전달해 사용자가 판단한다.
export function assertSafeArgv(argv: string[]): void {
  const { level, reason } = assessArgv(argv);
  if (level === 'block') {
    throw new Error(`위험한 명령이라 차단되었습니다: ${reason}`);
  }
}
