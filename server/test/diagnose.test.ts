import { describe, it, expect } from 'vitest';
import { diagnose } from '../src/commands/diagnose.js';

const kubectl = ['/opt/homebrew/bin/kubectl', 'get', 'pods'];

describe('diagnose', () => {
  it('ENOENT → not_installed (bin 이름 포함)', () => {
    const d = diagnose(['some-missing-bin'], { exitCode: null, stderr: '', errCode: 'ENOENT' });
    expect(d.category).toBe('not_installed');
    expect(d.hint).toContain('some-missing-bin');
  });

  it('killed → timeout', () => {
    expect(diagnose(kubectl, { exitCode: null, stderr: '', killed: true }).category).toBe('timeout');
  });

  it('Unauthorized → auth_expired', () => {
    const d = diagnose(kubectl, { exitCode: 1, stderr: 'error: You must be logged in to the server (Unauthorized)' });
    expect(d.category).toBe('auth_expired');
    expect(d.label).toBe('인증만료');
  });

  it('connection refused → unreachable', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'dial tcp 10.0.0.1:6443: connect: connection refused' }).category).toBe('unreachable');
  });

  it('x509 (만료 인증서) → unreachable', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'x509: certificate has expired' }).category).toBe('unreachable');
  });

  it('context not found → context_missing', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'error: context "ns-oss-cmdb" not found' }).category).toBe('context_missing');
  });

  it('forbidden → permission_denied (not_found보다 우선)', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'Error from server (Forbidden): pods is forbidden' }).category).toBe('permission_denied');
  });

  it('resource NotFound → not_found', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'Error from server (NotFound): deployments.apps "x" not found' }).category).toBe('not_found');
  });

  it('exit 2 → bad_usage', () => {
    expect(diagnose(kubectl, { exitCode: 2, stderr: 'unknown flag: --bogus' }).category).toBe('bad_usage');
  });

  it('정체불명 stderr → unknown', () => {
    expect(diagnose(kubectl, { exitCode: 1, stderr: 'something weird happened' }).category).toBe('unknown');
  });
});
