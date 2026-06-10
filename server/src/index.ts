import 'dotenv/config';
import path from 'node:path';
import { startServer } from './start.js';

const DATA_DIR = path.resolve(process.cwd(), '../data');

async function main(): Promise<void> {
  const { app, port } = await startServer({ dataDir: DATA_DIR, preferredPort: 5174 });
  console.log(`PE Dashboard server: http://localhost:${port}`);
  console.log(`Data directory: ${DATA_DIR}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app.close().finally(() => process.exit(0));
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
