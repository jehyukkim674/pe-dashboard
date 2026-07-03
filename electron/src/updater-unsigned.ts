import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, writeFileSync, promises as fs } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { buildSwapScript, pickArm64ZipUrl, sameVersion, type GithubRelease } from './update-helpers.js';

const RELEASE_API = 'https://api.github.com/repos/jehyukkim674/pe-dashboard/releases/latest';

// 다운로드한 새 번들(.app) 경로. startInstall(custom)에서 채우고 restartWithSwap에서 쓴다.
let pendingSwapSrc: string | undefined;

// GitHub API/에셋은 리다이렉트를 쓰므로 302를 따라가며 GET 한다.
function httpGet(url: string, headers: Record<string, string>): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        httpGet(res.headers.location, headers).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await httpGet(RELEASE_API, { 'User-Agent': 'PE-Dashboard-Updater', Accept: 'application/vnd.github+json' });
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease;
}

// 릴리스 zip을 받아 압축 해제하고 새 .app 경로를 반환한다. 진행률 0~100을 콜백으로 보낸다.
// expectedVersion을 주면 실제로 받는 릴리스 태그가 그것과 같은지 검증한다 — 체크 이후 새 릴리스가
// 게시되면 모달에 표시·동의한 버전과 다른 것이 설치될 수 있으므로 불일치 시 중단한다.
export async function downloadUnsigned(
  onProgress: (percent: number) => void,
  expectedVersion?: string,
): Promise<string> {
  onProgress(0);
  const release = await fetchLatestRelease();
  if (expectedVersion && !sameVersion(release.tag_name, expectedVersion)) {
    throw new Error(`릴리스 버전 불일치: 예상 ${expectedVersion}, 실제 ${release.tag_name ?? '(없음)'}`);
  }
  const url = pickArm64ZipUrl(release);

  const tmp = path.join(os.tmpdir(), `pe-update-${release.tag_name ?? 'latest'}`);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  const zipPath = path.join(tmp, 'app.zip');
  const extractDir = path.join(tmp, 'extract');
  await fs.mkdir(extractDir, { recursive: true });

  const res = await httpGet(url, { 'User-Agent': 'PE-Dashboard-Updater' });
  const total = Number(res.headers['content-length'] ?? 0);
  let received = 0;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(zipPath);
    res.on('data', (c: Buffer) => {
      received += c.length;
      if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
    });
    res.pipe(out);
    out.on('finish', () => out.close(() => resolve()));
    out.on('error', reject);
    res.on('error', reject);
  });

  // ditto로 해제(앱 번들 심볼릭링크·권한 보존)
  const r = spawnSync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`압축 해제 실패: ${r.stderr || r.status}`);

  const entries = await fs.readdir(extractDir);
  const appName = entries.find((n) => n.endsWith('.app'));
  if (!appName) throw new Error('압축 해제 결과에서 .app을 찾지 못했습니다');
  pendingSwapSrc = path.join(extractDir, appName);
  onProgress(100);
  return pendingSwapSrc;
}

// 현재 실행 중인 번들 경로(.app 루트).
export function currentBundlePath(): string {
  return path.resolve(app.getPath('exe'), '..', '..', '..');
}

// 다운로드해 둔 새 번들로 교체하는 헬퍼를 띄우고 앱을 종료한다.
export function restartWithSwap(): void {
  if (!pendingSwapSrc) throw new Error('다운로드된 업데이트가 없습니다');
  const script = buildSwapScript({
    pid: process.pid,
    srcApp: pendingSwapSrc,
    destApp: currentBundlePath(),
  });
  const scriptPath = path.join(os.tmpdir(), `pe-swap-${Date.now()}.sh`);
  // 동기 기록(곧 app.quit 하므로 비동기 완료를 기다릴 수 없음)
  writeFileSync(scriptPath, script, { mode: 0o755 });
  const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' });
  child.unref();
  app.quit();
}
