import 'dotenv/config';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { buildApp } from './app.js';
import { DashboardStore } from './dashboardStore.js';
import { CommandRegistry } from './commands/registry.js';
import { PendingCommands } from './commands/pending.js';
import { DataSourceRegistry } from './datasources/registry.js';
import { CliSource } from './datasources/cliSource.js';
import { buildTools } from './ai/tools.js';
import { ChatService } from './ai/chatService.js';

const DATA_DIR = path.resolve(process.cwd(), '../data');
const PORT = 5174;

async function main(): Promise<void> {
  const store = new DashboardStore(path.join(DATA_DIR, 'dashboards'));
  await store.init();
  const commands = new CommandRegistry(path.join(DATA_DIR, 'commands.json'));
  await commands.load();
  const pending = new PendingCommands();

  const dataSources = new DataSourceRegistry();
  dataSources.register(new CliSource(commands));

  const tools = buildTools({ store, commands, pending });
  const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용
  const chatService = new ChatService({ client, tools, store, commands });

  const app = await buildApp({ store, commands, pending, dataSources, chatService });
  await app.listen({ port: PORT });
  console.log(`PE Dashboard server: http://localhost:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
