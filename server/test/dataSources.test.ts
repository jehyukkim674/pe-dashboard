import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataSourceRegistry } from '../src/datasources/registry.js';
import { CliSource } from '../src/datasources/cliSource.js';
import { CommandRegistry } from '../src/commands/registry.js';

describe('DataSourceRegistry', () => {
  it('resolves registered source by kind and throws for unknown kind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ds-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();

    const registry = new DataSourceRegistry();
    registry.register(new CliSource(commands));

    expect(registry.get('cli').kind).toBe('cli');
    expect(() => registry.get('postgres')).toThrow(/unsupported data source/);
  });

  it('CliSource fetches via command template', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ds-'));
    const commands = new CommandRegistry(path.join(dir, 'commands.json'));
    await commands.load();
    await commands.register({
      id: 'echo_json',
      description: 'test',
      argv: ['node', '-e', 'console.log(JSON.stringify({msg:"hi"}))'],
      params: [],
    });

    const source = new CliSource(commands);
    const result = await source.fetch({ kind: 'cli', commandId: 'echo_json', params: {} });
    expect(result.json).toEqual({ msg: 'hi' });
  });
});

describe('HttpSource', () => {
  it('fetches JSON from a local server', async () => {
    const { createServer } = await import('node:http');
    const { HttpSource } = await import('../src/datasources/httpSource.js');
    const srv = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'green', items: [1, 2] }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      const result = await new HttpSource().fetch({
        kind: 'http', commandId: '', params: {}, url: `http://127.0.0.1:${port}/x`,
      });
      expect(result.ok).toBe(true);
      expect((result.json as { status: string }).status).toBe('green');
    } finally {
      srv.close();
    }
  });

  it('rejects non-http urls and reports HTTP errors', async () => {
    const { HttpSource } = await import('../src/datasources/httpSource.js');
    const bad = await new HttpSource().fetch({ kind: 'http', commandId: '', params: {}, url: 'file:///etc/passwd' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/URL/);
  });
});
