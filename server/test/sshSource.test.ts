import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSshArgv } from '../src/datasources/sshSource.js';
import { SshProfiles } from '../src/datasources/sshProfiles.js';

describe('buildSshArgv', () => {
  it('user@host·포트·원격 명령(단일 따옴표)로 ssh argv를 만든다', () => {
    const argv = buildSshArgv({ name: 'b', host: 'bastion', user: 'ops', port: 2222 }, ['kubectl', 'get', 'pods']);
    expect(argv[0]).toBe('ssh');
    expect(argv).toContain('BatchMode=yes');
    expect(argv).toContain('StrictHostKeyChecking=accept-new');
    expect(argv).toContain('-p');
    expect(argv).toContain('2222');
    expect(argv).toContain('ops@bastion');
    // 원격 명령은 마지막 단일 인자이며 각 토큰이 단일 따옴표로 감싸진다
    expect(argv[argv.length - 1]).toBe("'kubectl' 'get' 'pods'");
  });

  it('user가 없으면 target은 host만', () => {
    const argv = buildSshArgv({ name: 'b', host: 'h' }, ['echo', 'hi']);
    expect(argv).toContain('h');
    expect(argv).not.toContain('@h');
  });

  it('원격 인자의 작은따옴표·공백을 안전하게 이스케이프한다', () => {
    const argv = buildSshArgv({ name: 'b', host: 'h' }, ['echo', "a'b c"]);
    // 로컬은 execFile이라 안전하고, 원격 셸에는 리터럴로 전달되도록 따옴표 처리
    expect(argv[argv.length - 1]).toBe("'echo' 'a'\\''b c'");
  });
});

describe('SshProfiles 검증 (옵션 주입 방지)', () => {
  async function make(): Promise<SshProfiles> {
    const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
    const p = new SshProfiles(path.join(dir, 'ssh-profiles.json'));
    await p.load();
    return p;
  }

  it('정상 host/user/port는 허용', async () => {
    const p = await make();
    await p.add({ name: 'b', host: 'bastion.example.com', user: 'ops', port: 22 });
    expect(p.get('b')?.host).toBe('bastion.example.com');
  });

  it("'-'로 시작하는 host는 거부 (ssh 옵션 오인·ProxyCommand 로컬실행 방지)", async () => {
    const p = await make();
    await expect(p.add({ name: 'x', host: '-oProxyCommand=touch /tmp/pwn' })).rejects.toThrow(/host/);
  });

  it('공백·메타문자 host, 잘못된 user/port 거부', async () => {
    const p = await make();
    await expect(p.add({ name: 'a', host: 'a b;c' })).rejects.toThrow(/host/);
    await expect(p.add({ name: 'b', host: 'h', user: 'a b' })).rejects.toThrow(/user/);
    await expect(p.add({ name: 'c', host: 'h', port: 99999 })).rejects.toThrow(/port/);
  });
});
