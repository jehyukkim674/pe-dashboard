import 'dotenv/config';
import path from 'node:path';
import { startServer } from './start.js';

const DATA_DIR = path.resolve(process.cwd(), '../data');

async function main(): Promise<void> {
  // dev는 15174 — 패키징 앱(5174)과 포트를 분리해 동시 실행 시 데이터가 섞이지 않게 한다
  const { app, port } = await startServer({ dataDir: DATA_DIR, preferredPort: 15174 });
  console.log(`PE Dashboard server: http://127.0.0.1:${port}`);
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
