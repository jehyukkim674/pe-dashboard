import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandRegistry } from '../src/commands/registry.js';

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
});
