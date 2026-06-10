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
