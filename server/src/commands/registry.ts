import { promises as fs } from 'node:fs';
import type { CommandTemplate } from '../types.js';

const BUILTIN: CommandTemplate[] = [
  {
    id: 'gh_run_list',
    description: 'GitHub Actions 워크플로우 실행 목록 (JSON)',
    argv: ['gh', 'run', 'list', '--repo', '{repo}', '--limit', '20', '--json',
      'status,conclusion,name,displayTitle,createdAt,url'],
    params: ['repo'],
    builtin: true,
  },
  {
    id: 'gh_pr_list',
    description: 'GitHub PR 목록 (JSON)',
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
}

export class CommandRegistry {
  private custom: CommandTemplate[] = [];

  constructor(readonly customFile: string) {}

  async load(): Promise<void> {
    try {
      this.custom = JSON.parse(await fs.readFile(this.customFile, 'utf8')) as CommandTemplate[];
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
    const tmp = `${this.customFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.custom, null, 2));
    await fs.rename(tmp, this.customFile);
  }

  // 화이트리스트 검증의 핵심: 등록된 템플릿의 {placeholder} 위치에만 값 치환.
  // 셸을 거치지 않고 argv 배열로 실행하므로 값에 셸 메타문자·선행 대시를 금지한다.
  buildArgv(id: string, params: Record<string, string>): string[] {
    const template = this.get(id);
    if (!template) throw new Error(`unknown command: ${id}`);
    return template.argv.map((part) =>
      part.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = params[name];
        if (value === undefined) throw new Error(`missing param: ${name}`);
        if (value.startsWith('-') || !PARAM_VALUE_RE.test(value)) {
          throw new Error(`invalid param value for ${name}: ${value}`);
        }
        return value;
      }),
    );
  }
}
