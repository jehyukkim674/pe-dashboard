import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';

// 데이터 디렉터리를 실행 위치(process.cwd)가 아니라 이 모듈 위치에 고정한다.
// cwd 기준이면 repo 루트 등 다른 곳에서 실행 시 데이터가 조용히 저장소 밖으로 갈라진다.
// PE_DATA_DIR로 명시 지정도 허용한다. (src/index.ts → server → repo/data)
const DATA_DIR = process.env.PE_DATA_DIR
  ? path.resolve(process.env.PE_DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

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
