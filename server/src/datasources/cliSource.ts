import type { CommandResult, WidgetDataSource } from '../types.js';
import type { CommandRegistry } from '../commands/registry.js';
import { runArgv } from '../commands/runner.js';
import { ResultCache } from '../commands/resultCache.js';
import type { DataSource } from './registry.js';

export class CliSource implements DataSource {
  readonly kind = 'cli';

  constructor(
    private readonly commands: CommandRegistry,
    private readonly cache: ResultCache = new ResultCache(),
  ) {}

  async fetch(dataSource: WidgetDataSource): Promise<CommandResult> {
    const argv = this.commands.buildArgv(dataSource.commandId, dataSource.params);
    return this.cache.run(argv, () => runArgv(argv));
  }
}
