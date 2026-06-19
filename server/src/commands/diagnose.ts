import type { Diagnosis, DiagnosisCategory } from '../types.js';

export interface DiagnoseSignals {
  exitCode: number | null;
  stderr: string;
  errCode?: string; // err.code (ENOENT 등)
  killed?: boolean; // 우리 타임아웃에 의해 종료됨
}

// 카테고리별 라벨·조치 안내. 위젯/AI가 쓰는 문구의 단일 출처.
const META: Record<DiagnosisCategory, { label: string; hint: (bin: string) => string }> = {
  not_installed: { label: '미설치', hint: (b) => `'${b}' 명령을 찾을 수 없습니다 — 설치/PATH 확인 (GUI 실행 시 PATH 누락 가능)` },
  timeout: { label: '시간초과', hint: () => '명령이 제한 시간을 초과했습니다 — 네트워크·VPN 또는 큰 출력 확인' },
  auth_expired: { label: '인증만료', hint: () => '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신' },
  unreachable: { label: '미연결', hint: () => '서버/클러스터에 도달할 수 없습니다 — VPN 연결·엔드포인트 확인' },
  context_missing: { label: '컨텍스트없음', hint: () => 'kubeconfig context를 찾을 수 없습니다 — context 이름·파일 경로 확인' },
  permission_denied: { label: '권한없음', hint: () => '해당 리소스/네임스페이스 권한이 없습니다 — 계정·역할 확인' },
  not_found: { label: '리소스없음', hint: () => '대상 리소스가 없습니다 — 이름·네임스페이스 확인' },
  bad_usage: { label: '잘못된사용', hint: () => '명령 인자가 올바르지 않습니다 — 템플릿 argv 점검' },
  unknown: { label: '실패', hint: () => '명령이 실패했습니다 — stderr 원문을 확인하세요' },
};

// 우선순위 순서대로 매칭한다. auth를 unreachable보다(만료 토큰이 TLS류 메시지 동반),
// permission을 not_found보다(403 vs 404) 먼저 본다.
function classify(s: DiagnoseSignals): DiagnosisCategory {
  if (s.errCode === 'ENOENT') return 'not_installed';
  if (s.killed) return 'timeout';
  const e = s.stderr.toLowerCase();
  if (/unauthorized|\b401\b|token.*expir|login required|must be logged in|\bauth\b/.test(e)) return 'auth_expired';
  if (/connection refused|dial tcp|i\/o timeout|no route to host|\beof\b|x509|\btls\b|couldn'?t connect|could not connect|unable to connect/.test(e)) return 'unreachable';
  if (/context .* not found|current-context|no configuration has been provided|kubeconfig/.test(e)) return 'context_missing';
  if (/forbidden|\b403\b|not allowed|cannot .* in .* namespace|\brbac\b/.test(e)) return 'permission_denied';
  if (/not found|\b404\b|notfound|no such/.test(e)) return 'not_found';
  if (s.exitCode === 2 || /unknown flag|invalid argument|usage:/.test(e)) return 'bad_usage';
  return 'unknown';
}

export function diagnose(argv: string[], s: DiagnoseSignals): Diagnosis {
  const bin = (argv[0] ?? '').split('/').pop() ?? '';
  const category = classify(s);
  return { category, label: META[category].label, hint: META[category].hint(bin) };
}
