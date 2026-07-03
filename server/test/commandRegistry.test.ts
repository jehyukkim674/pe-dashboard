import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandRegistry, validateTemplate } from '../src/commands/registry.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cmd-'));
    registry = new CommandRegistry(path.join(dir, 'commands.json'));
    await registry.load();
  });

  it('lists builtin templates', () => {
    const ids = registry.list().map((t) => t.id);
    expect(ids).toContain('gh_run_list');
    expect(ids).toContain('argocd_app_list');
    expect(ids).toContain('port_check');
  });

  it('신규 빌트인이 목록에 있고, 모든 빌트인이 검증·안전 규칙을 통과한다', () => {
    const ids = registry.list().map((t) => t.id);
    for (const id of ['kubectl_get_pods', 'kubectl_get_nodes', 'kubectl_get_events',
      'docker_containers', 'aws_caller_identity', 'gcloud_instances', 'terraform_state_list',
      'glab_mr_list', 'jira_issue_list']) {
      expect(ids).toContain(id);
    }
    // 모든 빌트인이 validateTemplate(placeholder 선언 + safety)를 통과해야 한다 — 읽기전용·안전
    for (const t of registry.list()) {
      expect(() => validateTemplate(t), t.id).not.toThrow();
    }
  });

  it('신규 빌트인의 파라미터 치환이 올바르다', () => {
    expect(registry.buildArgv('kubectl_get_pods', { namespace: 'default' }))
      .toEqual(['kubectl', 'get', 'pods', '-n', 'default', '-o', 'json']);
    expect(registry.buildArgv('terraform_state_list', { dir: '/Users/me/proj' }))
      .toEqual(['terraform', '-chdir=/Users/me/proj', 'state', 'list']);
    expect(registry.buildArgv('glab_mr_list', { repo: 'org/repo' }))
      .toContain('org/repo');
  });

  it('손상된(배열 아님) commands.json이어도 list()가 죽지 않고 builtin만 반환한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cmd-'));
    const file = path.join(dir, 'commands.json');
    await writeFile(file, '{"not":"an array"}');
    const reg = new CommandRegistry(file);
    await reg.load();
    expect(() => reg.list()).not.toThrow();
    expect(reg.list().every((t) => t.builtin)).toBe(true);
  });

  it('builds argv with substituted params', () => {
    const argv = registry.buildArgv('gh_run_list', { repo: 'org/repo' });
    expect(argv).toContain('org/repo');
    expect(argv[0]).toBe('gh');
  });

  it('substitutes placeholder inside an argv element', () => {
    const argv = registry.buildArgv('port_check', { port: '8080' });
    expect(argv).toContain(':8080');
  });

  it('rejects missing params', () => {
    expect(() => registry.buildArgv('gh_run_list', {})).toThrow(/missing param/);
  });

  it('rejects unknown command', () => {
    expect(() => registry.buildArgv('rm_rf', {})).toThrow(/unknown command/);
  });

  it('rejects param values with shell metacharacters or leading dash', () => {
    expect(() => registry.buildArgv('gh_run_list', { repo: 'a;rm -rf /' })).toThrow(/invalid/);
    expect(() => registry.buildArgv('gh_run_list', { repo: '--evil' })).toThrow(/invalid/);
  });

  it('registers and persists a custom template', async () => {
    await registry.register({
      id: 'kubectl_pods',
      description: '파드 목록',
      argv: ['kubectl', 'get', 'pods', '-n', '{ns}', '-o', 'json'],
      params: ['ns'],
    });
    expect(registry.buildArgv('kubectl_pods', { ns: 'default' })).toContain('default');

    // 새 인스턴스로 로드해도 유지
    const again = new CommandRegistry(registry.customFile);
    await again.load();
    expect(again.get('kubectl_pods')).toBeDefined();
  });

  it('rejects duplicate or invalid template ids', async () => {
    await expect(
      registry.register({ id: 'gh_run_list', description: 'dup', argv: ['x'], params: [] }),
    ).rejects.toThrow(/already exists/);
    await expect(
      registry.register({ id: 'bad id!', description: '', argv: ['x'], params: [] }),
    ).rejects.toThrow(/invalid/);
  });

  it('rejects option injection on path-style params too', () => {
    expect(() => registry.buildArgv('git_log', { repoPath: '--work-tree=/etc' })).toThrow(/invalid/);
  });

  it('rejects registration when argv placeholder is not declared in params', async () => {
    await expect(
      registry.register({
        id: 'bad_tpl', description: 'x', argv: ['kubectl', 'get', '{thing}'], params: [],
      }),
    ).rejects.toThrow(/undeclared placeholder/);
  });

  describe('위험 명령 차단', () => {
    it('rejects registration of destructive binaries', async () => {
      await expect(
        registry.register({ id: 'rm_tmp', description: 'x', argv: ['rm', '-rf', '{p}'], params: ['p'] }),
      ).rejects.toThrow(/차단/);
      await expect(
        registry.register({ id: 'as_root', description: 'x', argv: ['sudo', 'ls'], params: [] }),
      ).rejects.toThrow(/차단/);
      await expect(
        registry.register({ id: 'wipe', description: 'x', argv: ['dd', 'if={a}', 'of={b}'], params: ['a', 'b'] }),
      ).rejects.toThrow(/차단/);
    });

    it('allows mutating subcommands to register (승인 단계 경고로 처리)', async () => {
      await registry.register({
        id: 'git_push', description: 'x', argv: ['git', '-C', '{p}', 'push'], params: ['p'],
      });
      await registry.register({
        id: 'k_delete', description: 'x', argv: ['kubectl', 'delete', 'pod', '{n}'], params: ['n'],
      });
      expect(registry.get('git_push')).toBeDefined();
      expect(registry.get('k_delete')).toBeDefined();
    });

    it('still allows builtin read-only templates', () => {
      expect(registry.buildArgv('gh_pr_list', { repo: 'org/repo' })[0]).toBe('gh');
      expect(registry.buildArgv('git_log', { repoPath: '/tmp/x' })[0]).toBe('git');
      expect(registry.buildArgv('port_check', { port: '8080' })[0]).toBe('lsof');
    });

    it('still allows read-only custom templates', async () => {
      await registry.register({
        id: 'docker_ps', description: '컨테이너 목록', argv: ['docker', 'ps', '--format', 'json'], params: [],
      });
      expect(registry.buildArgv('docker_ps', {})[0]).toBe('docker');
    });
  });
});
