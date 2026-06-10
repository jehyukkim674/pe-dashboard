import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startServer } from '../src/start.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'start-'));
}

describe('startServer', () => {
  it('serves the API on the chosen port', async () => {
    const { app, port } = await startServer({ dataDir: await tmp(), preferredPort: 0 });
    apps.push(app);
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/commands`);
    expect(res.status).toBe(200);
  });

  it('falls back to a free port when preferred port is taken', async () => {
    const first = await startServer({ dataDir: await tmp(), preferredPort: 0 });
    apps.push(first.app);
    const second = await startServer({ dataDir: await tmp(), preferredPort: first.port });
    apps.push(second.app);
    expect(second.port).not.toBe(first.port);
  });

  it('serves static SPA with index.html fallback when staticDir given', async () => {
    const staticDir = await tmp();
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<html><body>PE</body></html>');

    const { app, port } = await startServer({ dataDir: await tmp(), preferredPort: 0, staticDir });
    apps.push(app);

    const root = await fetch(`http://127.0.0.1:${port}/`);
    expect(await root.text()).toContain('PE');
    const deep = await fetch(`http://127.0.0.1:${port}/some/spa/route`);
    expect(await deep.text()).toContain('PE'); // SPA 폴백
    const api = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(api.status).toBe(404); // API는 폴백 제외
  });
});
