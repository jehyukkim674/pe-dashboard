import { promises as fs } from 'node:fs';
import type { CommandTemplate } from '../types.js';
import { assertSafeArgv } from './safety.js';
import { writeJsonAtomic } from '../jsonFile.js';

const BUILTIN: CommandTemplate[] = [
  {
    id: 'gh_run_list',
    description: 'GitHub Actions 워크플로우 실행 목록 (JSON). repo는 OWNER/REPO 형식 (예: kt-cloud-infra-ops/cmdb-frontend)',
    argv: ['gh', 'run', 'list', '--repo', '{repo}', '--limit', '20', '--json',
      'status,conclusion,name,displayTitle,createdAt,url'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'gh_pr_list',
    description: 'GitHub PR 목록 (JSON). repo는 OWNER/REPO 형식 (예: kt-cloud-infra-ops/cmdb-frontend)',
    argv: ['gh', 'pr', 'list', '--repo', '{repo}', '--json',
      'number,title,author,state,createdAt,url'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'git_log',
    description: '로컬 저장소 최근 커밋 로그 (텍스트)',
    argv: ['git', '-C', '{repoPath}', 'log', '--oneline', '-n', '20'],
    params: ['repoPath'],
    builtin: true,
  },
  {
    id: 'argocd_app_list',
    description: 'ArgoCD 애플리케이션 목록 (JSON)',
    argv: ['argocd', 'app', 'list', '-o', 'json'],
    params: [],
    builtin: true,
  },
  {
    id: 'argocd_app_get',
    description: 'ArgoCD 단일 앱 상세 (JSON)',
    argv: ['argocd', 'app', 'get', '{app}', '-o', 'json'],
    params: ['app'],
    builtin: true,
  },
  {
    id: 'port_check',
    description: '로컬 포트 사용/포트포워딩 상태 (텍스트, 미사용 시 빈 결과)',
    argv: ['lsof', '-nP', '-i', ':{port}'],
    params: ['port'],
    builtin: true,
  },
  // --- Kubernetes (kubectl -o json → {items:[...]}; table/status는 행 경로 자동감지) ---
  {
    id: 'kubectl_get_pods',
    description: 'Kubernetes 파드 목록 (JSON). namespace 지정. table/status 위젯은 행 경로 items 자동 인식',
    argv: ['kubectl', 'get', 'pods', '-n', '{namespace}', '-o', 'json'],
    params: ['namespace'],
    builtin: true,
  },
  {
    id: 'kubectl_get_nodes',
    description: 'Kubernetes 노드 목록 (JSON)',
    argv: ['kubectl', 'get', 'nodes', '-o', 'json'],
    params: [],
    builtin: true,
  },
  {
    id: 'kubectl_get_events',
    description: 'Kubernetes 이벤트 목록 (JSON). namespace 지정',
    argv: ['kubectl', 'get', 'events', '-n', '{namespace}', '-o', 'json'],
    params: ['namespace'],
    builtin: true,
  },
  // --- Docker / AWS / GCP / Terraform ---
  {
    id: 'docker_containers',
    description: '실행 중인 도커 컨테이너 (텍스트 표) — log 위젯 권장',
    argv: ['docker', 'ps'],
    params: [],
    builtin: true,
  },
  {
    id: 'aws_caller_identity',
    description: '현재 AWS 자격증명 주체 (JSON) — stat(path=Account) 등',
    argv: ['aws', 'sts', 'get-caller-identity'],
    params: [],
    builtin: true,
  },
  {
    id: 'gcloud_instances',
    description: 'GCP Compute 인스턴스 목록 (JSON 배열)',
    argv: ['gcloud', 'compute', 'instances', 'list', '--format', 'json'],
    params: [],
    builtin: true,
  },
  {
    id: 'terraform_state_list',
    description: 'Terraform state의 리소스 목록 (텍스트). dir = 프로젝트 경로',
    argv: ['terraform', '-chdir={dir}', 'state', 'list'],
    params: ['dir'],
    builtin: true,
  },
  // --- GitLab (glab) / Jira (jira-cli) ---
  {
    id: 'glab_mr_list',
    description: 'GitLab Merge Request 목록 (JSON). repo는 OWNER/REPO',
    argv: ['glab', 'mr', 'list', '-R', '{repo}', '-F', 'json'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'jira_issue_list',
    description: 'Jira 이슈 목록 (텍스트) — jira-cli 설정 필요. log 위젯 권장',
    argv: ['jira', 'issue', 'list', '--plain'],
    params: [],
    builtin: true,
  },
];

// 주의: 이 정규식은 선행 대시(--flag)를 막지 못한다. 옵션 주입 방어는
// buildArgv의 value.startsWith('-') 검사가 담당하므로 둘을 함께 유지해야 한다.
const PARAM_VALUE_RE = /^[\w@.:/\\,= -]+$/;

export function validateTemplate(template: CommandTemplate): void {
  if (!/^[\w-]+$/.test(template.id)) throw new Error(`invalid template id: ${template.id}`);
  if (!Array.isArray(template.argv) || template.argv.length === 0) {
    throw new Error('argv must be a non-empty array');
  }
  const placeholders = [...new Set(
    template.argv.flatMap((part) => [...part.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
  )];
  const declared = new Set(template.params);
  const undeclared = placeholders.filter((p) => !declared.has(p));
  if (undeclared.length > 0) {
    throw new Error(`undeclared placeholder in argv: ${undeclared.join(', ')}`);
  }
  assertSafeArgv(template.argv);
}

export class CommandRegistry {
  private custom: CommandTemplate[] = [];

  constructor(readonly customFile: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.customFile, 'utf8'));
      // 손상 파일이 배열이 아니면 빈 목록으로 — list()의 [...BUILTIN, ...this.custom] 전개가 죽지 않게
      this.custom = Array.isArray(parsed) ? (parsed as CommandTemplate[]) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.custom = [];
    }
  }

  list(): CommandTemplate[] {
    return [...BUILTIN, ...this.custom];
  }

  get(id: string): CommandTemplate | undefined {
    return this.list().find((t) => t.id === id);
  }

  async register(template: CommandTemplate): Promise<void> {
    if (this.get(template.id)) throw new Error(`template already exists: ${template.id}`);
    validateTemplate(template);
    this.custom.push({ ...template, builtin: false });
    await writeJsonAtomic(this.customFile, this.custom);
  }

  // 화이트리스트 검증의 핵심: 등록된 템플릿의 {placeholder} 위치에만 값 치환.
  // 셸을 거치지 않고 argv 배열로 실행하므로 값에 셸 메타문자·선행 대시를 금지한다.
  buildArgv(id: string, params: Record<string, string>): string[] {
    const template = this.get(id);
    if (!template) throw new Error(`unknown command: ${id}`);
    const argv = template.argv.map((part) =>
      part.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = params[name];
        if (value === undefined) throw new Error(`missing param: ${name}`);
        if (value.startsWith('-') || !PARAM_VALUE_RE.test(value)) {
          throw new Error(`invalid param value for ${name}: ${value}`);
        }
        return value;
      }),
    );
    // 파라미터 치환 결과까지 포함한 최종 argv를 한 번 더 검사한다.
    assertSafeArgv(argv);
    return argv;
  }
}
