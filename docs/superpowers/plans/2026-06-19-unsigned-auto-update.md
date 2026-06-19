# 미서명 빌드 자동 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미서명 macOS 빌드에서 앱 안에서 릴리스 zip을 자동 다운로드·압축 해제하고, "지금 재시작" 시 번들을 교체·재실행하는 자동 업데이트를 지원한다.

**Architecture:** 순수 함수(`update-helpers.ts`, electron 의존 없음 → vitest 단위 테스트)와 I/O 모듈(`updater-unsigned.ts`, electron/Node/시스템 명령)을 분리한다. `updater.ts`가 설치 전략(`squirrel`/`custom`/`manual`)을 판별해 서명 빌드는 기존 electron-updater, 미서명 빌드는 커스텀 다운로드+교체로 분기한다. IPC·preload·UpdateModal 시그니처는 불변.

**Tech Stack:** Electron 42, electron-updater(서명 경로), Node 내장 `https`/`fs`/`child_process`, 시스템 `ditto`/`xattr`/`open`/`bash`, vitest.

설계 문서: `docs/superpowers/specs/2026-06-19-unsigned-auto-update-design.md`

---

## File Structure

- **Create** `electron/src/update-helpers.ts` — 순수 함수 3종(`classifyBundlePath`, `pickArm64ZipUrl`, `buildSwapScript`). electron import 절대 금지(vitest가 node 환경에서 import하므로).
- **Create** `electron/test/update-helpers.test.ts` — 위 3종 단위 테스트.
- **Create** `electron/src/updater-unsigned.ts` — I/O. `fetchLatestRelease`, `downloadUnsigned`, `restartWithSwap`. electron `app` + Node + 시스템 명령 사용.
- **Modify** `electron/package.json` — devDep `vitest` + `"test": "vitest run"` 스크립트.
- **Modify** `electron/src/updater.ts` — `installStrategy()` 도입, `startInstall`/`restartToUpdate`/`checkUpdateStatus` 분기.

UpdateModal/preload/main.ts는 변경하지 않는다(전략이 `manual`이 아니면 `canAutoInstall:true`가 되어 기존 자동 다운로드 UI가 그대로 동작).

---

## Task 1: electron vitest 도입 + classifyBundlePath

**Files:**
- Modify: `electron/package.json`
- Create: `electron/src/update-helpers.ts`
- Test: `electron/test/update-helpers.test.ts`

- [ ] **Step 1: vitest 추가**

`electron/package.json`의 `scripts`에 `"test": "vitest run"`를 추가하고(기존 `typecheck` 옆), `devDependencies`에 `"vitest": "^4.1.8"`를 추가한다. 결과 scripts/devDeps:

```json
  "scripts": {
    "dev": "node build.mjs && ELECTRON_START_URL=http://localhost:5173 electron .",
    "build:bundle": "node build.mjs",
    "dist": "node build.mjs && electron-builder --publish never",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^25.9.3",
    "electron": "42.4.0",
    "electron-builder": "^26.15.2",
    "electron-updater": "^6.3.0",
    "esbuild": "^0.28.1",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
```

그다음 루트에서 설치: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard && npm install`

- [ ] **Step 2: 실패 테스트 작성**

`electron/test/update-helpers.test.ts` 생성:

```ts
import { describe, it, expect } from 'vitest';
import { classifyBundlePath } from '../src/update-helpers.js';

describe('classifyBundlePath', () => {
  it('쓰기 가능하고 일반 경로면 custom', () => {
    expect(classifyBundlePath('/Users/me/Applications/PE Dashboard.app', true)).toBe('custom');
  });
  it('쓰기 불가면 manual', () => {
    expect(classifyBundlePath('/Applications/PE Dashboard.app', false)).toBe('manual');
  });
  it('App Translocation 경로면 manual', () => {
    expect(classifyBundlePath('/private/var/folders/x/AppTranslocation/ABC/d/PE Dashboard.app', true)).toBe('manual');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts`
Expected: FAIL — 모듈/함수 없음.

- [ ] **Step 4: 구현**

`electron/src/update-helpers.ts` 생성(electron import 없이):

```ts
// 순수 함수 모음 — electron 모듈을 import하지 않는다(vitest가 node 환경에서 불러오므로).

export type InstallStrategy = 'squirrel' | 'custom' | 'manual';

// 미서명 빌드에서 in-app 교체가 가능한지 경로로 판정한다.
// App Translocation(읽기 전용 무작위 경로)이거나 쓰기 불가면 수동 폴백.
export function classifyBundlePath(bundlePath: string, isWritable: boolean): 'custom' | 'manual' {
  if (!isWritable) return 'manual';
  if (bundlePath.includes('/AppTranslocation/')) return 'manual';
  return 'custom';
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/82312411gimjaehyeog/Dev/pe-dashboard
git add electron/package.json electron/src/update-helpers.ts electron/test/update-helpers.test.ts package-lock.json
git commit -m "빌드: electron vitest 도입 + classifyBundlePath 순수 함수"
```

---

## Task 2: pickArm64ZipUrl

**Files:**
- Modify: `electron/src/update-helpers.ts`
- Test: `electron/test/update-helpers.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `electron/test/update-helpers.test.ts`에 추가:

```ts
import { pickArm64ZipUrl } from '../src/update-helpers.js';

describe('pickArm64ZipUrl', () => {
  const release = {
    tag_name: 'v0.23.0',
    assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/latest-mac.yml' },
      { name: 'PE-Dashboard-0.23.0-arm64-mac.zip.blockmap', browser_download_url: 'https://x/bm' },
      { name: 'PE-Dashboard-0.23.0-arm64-mac.zip', browser_download_url: 'https://x/app.zip' },
    ],
  };

  it('arm64 mac zip(블록맵 제외)의 download url을 고른다', () => {
    expect(pickArm64ZipUrl(release)).toBe('https://x/app.zip');
  });

  it('해당 에셋이 없으면 throw', () => {
    expect(() => pickArm64ZipUrl({ tag_name: 'v0.23.0', assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/y' },
    ] })).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts`
Expected: FAIL — `pickArm64ZipUrl` 없음.

- [ ] **Step 3: 구현** — `electron/src/update-helpers.ts`에 추가:

```ts
export interface GithubAsset { name: string; browser_download_url: string }
export interface GithubRelease { tag_name?: string; assets: GithubAsset[] }

// arm64 mac zip 에셋의 다운로드 URL을 고른다(.blockmap 제외).
export function pickArm64ZipUrl(release: GithubRelease): string {
  const asset = release.assets.find(
    (a) => /-arm64-mac\.zip$/.test(a.name) && !a.name.endsWith('.blockmap'),
  );
  if (!asset) throw new Error('릴리스에서 arm64 mac zip 에셋을 찾지 못했습니다');
  return asset.browser_download_url;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts && npx tsc --noEmit`
Expected: 5 tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/82312411gimjaehyeog/Dev/pe-dashboard
git add electron/src/update-helpers.ts electron/test/update-helpers.test.ts
git commit -m "기능: 릴리스 JSON에서 arm64 zip URL 선택 pickArm64ZipUrl"
```

---

## Task 3: buildSwapScript

**Files:**
- Modify: `electron/src/update-helpers.ts`
- Test: `electron/test/update-helpers.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `electron/test/update-helpers.test.ts`에 추가:

```ts
import { buildSwapScript } from '../src/update-helpers.js';

describe('buildSwapScript', () => {
  const script = buildSwapScript({
    pid: 12345,
    srcApp: '/tmp/pe-update/extract/PE Dashboard.app',
    destApp: '/Users/me/Applications/PE Dashboard.app',
  });

  it('PID 종료를 기다린다', () => {
    expect(script).toContain('kill -0 12345');
  });
  it('ditto로 교체하고 quarantine를 제거하고 open으로 재실행한다', () => {
    expect(script).toContain('/usr/bin/ditto');
    expect(script).toContain('com.apple.quarantine');
    expect(script).toContain('/usr/bin/open');
  });
  it('경로를 작은따옴표로 감싼다(공백 안전)', () => {
    expect(script).toContain("'/Users/me/Applications/PE Dashboard.app'");
    expect(script).toContain("'/tmp/pe-update/extract/PE Dashboard.app'");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts`
Expected: FAIL — `buildSwapScript` 없음.

- [ ] **Step 3: 구현** — `electron/src/update-helpers.ts`에 추가:

```ts
// 작은따옴표 셸 인용(경로 내 작은따옴표도 안전 처리).
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// 우리 프로세스 종료를 기다렸다가 번들을 교체·재실행하는 bash 스크립트를 만든다.
export function buildSwapScript(opts: { pid: number; srcApp: string; destApp: string }): string {
  const src = shellQuote(opts.srcApp);
  const dest = shellQuote(opts.destApp);
  const destNew = shellQuote(`${opts.destApp}.new`);
  return [
    '#!/bin/bash',
    `while kill -0 ${opts.pid} 2>/dev/null; do sleep 0.2; done`,
    `/usr/bin/ditto ${src} ${destNew} && rm -rf ${dest} && mv ${destNew} ${dest}`,
    `/usr/bin/xattr -dr com.apple.quarantine ${dest} 2>/dev/null || true`,
    `/usr/bin/open ${dest}`,
    '',
  ].join('\n');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx vitest run test/update-helpers.test.ts && npx tsc --noEmit`
Expected: 8 tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/82312411gimjaehyeog/Dev/pe-dashboard
git add electron/src/update-helpers.ts electron/test/update-helpers.test.ts
git commit -m "기능: 종료 후 번들 교체·재실행 bash 스크립트 생성 buildSwapScript"
```

---

## Task 4: updater-unsigned.ts (다운로드·추출·교체 I/O)

**Files:**
- Create: `electron/src/updater-unsigned.ts`

> 이 모듈은 electron/Node/시스템 명령을 쓰는 I/O라 단위 테스트하지 않는다(수동·통합 검증). tsc로만 검증한다.

- [ ] **Step 1: 구현** — `electron/src/updater-unsigned.ts` 생성:

```ts
import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, writeFileSync, promises as fs } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { buildSwapScript, pickArm64ZipUrl, type GithubRelease } from './update-helpers.js';

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
export async function downloadUnsigned(onProgress: (percent: number) => void): Promise<string> {
  onProgress(0);
  const release = await fetchLatestRelease();
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx tsc --noEmit`
Expected: tsc clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/82312411gimjaehyeog/Dev/pe-dashboard
git add electron/src/updater-unsigned.ts
git commit -m "기능: 미서명 업데이트 다운로드·압축해제·교체 I/O 모듈"
```

---

## Task 5: updater.ts 전략 분기

**Files:**
- Modify: `electron/src/updater.ts`

현재 `updater.ts`의 관련 부분:
- `canAutoInstall()` (18-35줄): codesign으로 서명 여부 판정, `signedCache`.
- `checkUpdateStatus()` (54-73줄): `canAutoInstall: canAutoInstall()` (68줄).
- `startInstall(win)` (77-93줄): `autoUpdater.checkForUpdates()` 후 `downloadUpdate()`.
- `restartToUpdate()` (96-98줄): `autoUpdater.quitAndInstall()`.

- [ ] **Step 1: import 추가** — 파일 상단 import 블록에 추가:

```ts
import { accessSync, constants } from 'node:fs';
import { classifyBundlePath, type InstallStrategy } from './update-helpers.js';
import { currentBundlePath, downloadUnsigned, restartWithSwap } from './updater-unsigned.js';
```

- [ ] **Step 2: `canAutoInstall`을 `installStrategy`로 교체** — 기존 `canAutoInstall()` 함수(18-35줄)와 `signedCache`를 아래로 교체한다(서명 판정 로직은 그대로 재사용, 반환만 전략으로 확장):

```ts
let strategyCache: InstallStrategy | undefined;

function isSigned(): boolean {
  try {
    const bundle = currentBundlePath();
    const r = spawnSync('codesign', ['-dvv', bundle], { encoding: 'utf8' });
    const info = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    return (
      /Authority=Developer ID Application/.test(info) ||
      (/TeamIdentifier=/.test(info) && !/TeamIdentifier=not set/.test(info))
    );
  } catch {
    return false;
  }
}

function isBundleWritable(bundle: string): boolean {
  try {
    accessSync(path.dirname(bundle), constants.W_OK);
    accessSync(bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// 설치 전략: 서명됨→squirrel, 미서명+교체가능→custom, 그 외→manual(수동 폴백).
export function installStrategy(): InstallStrategy {
  if (strategyCache !== undefined) return strategyCache;
  if (isSigned()) {
    strategyCache = 'squirrel';
  } else {
    const bundle = currentBundlePath();
    strategyCache = classifyBundlePath(bundle, isBundleWritable(bundle));
  }
  return strategyCache;
}
```

(주: `spawnSync`·`path`는 기존 파일에서 이미 import되어 있다. 기존 `import path from 'node:path'`, `import { spawnSync } from 'node:child_process'` 유지. 만약 `path`가 import되어 있지 않다면 추가한다.)

- [ ] **Step 3: `checkUpdateStatus`의 canAutoInstall 채우기 수정** — 68줄 `canAutoInstall: canAutoInstall(),`를:

```ts
      canAutoInstall: installStrategy() !== 'manual',
```

- [ ] **Step 4: `startInstall` 분기** — 기존 `startInstall` 함수를 아래로 교체:

```ts
// 다운로드 진행률 0~100% 송출. 재시작은 사용자가 '지금 재시작'을 눌러야 한다.
export async function startInstall(win: BrowserWindow): Promise<void> {
  const send = (percent: number) => win.webContents.send('updater:progress', percent);

  if (installStrategy() === 'custom') {
    // 미서명: 커스텀 다운로드+압축해제(교체는 restartToUpdate에서)
    await downloadUnsigned(send);
    return;
  }

  // 서명: electron-updater. 다운로드 전에 같은 세션의 체크 상태를 요구한다.
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  if (!info || !isNewerVersion(info.version, app.getVersion())) {
    throw new Error('설치할 새 버전이 없습니다');
  }
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.removeAllListeners('update-downloaded');
  autoUpdater.on('download-progress', (p) => send(Math.min(99, Math.round(p.percent))));
  autoUpdater.once('update-downloaded', () => send(100));
  send(0);
  await autoUpdater.downloadUpdate();
}
```

- [ ] **Step 5: `restartToUpdate` 분기** — 기존 함수를 아래로 교체:

```ts
// 다운로드된 업데이트를 적용하며 앱을 재시작한다.
export function restartToUpdate(): void {
  if (installStrategy() === 'custom') {
    restartWithSwap();
    return;
  }
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 6: 타입 체크 + 헬퍼 테스트**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx tsc --noEmit && npx vitest run`
Expected: tsc clean(미사용 import·심볼 없음 확인 — `canAutoInstall` 잔존 참조가 없어야 함), 8 tests PASS.

만약 `canAutoInstall` export를 다른 곳에서 import하던 흔적이 tsc 에러로 뜨면 해당 import를 `installStrategy`로 바꾼다(현재 `main.ts`는 `checkUpdateStatus, openReleasePage, restartToUpdate, startInstall`만 import하므로 영향 없음).

- [ ] **Step 7: Commit**

```bash
cd /Users/82312411gimjaehyeog/Dev/pe-dashboard
git add electron/src/updater.ts
git commit -m "기능: 설치 전략 분기(squirrel/custom/manual) — 미서명 자동 업데이트 연결"
```

---

## Task 6: 전체 검증

- [ ] **Step 1: electron 검증**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && npx tsc --noEmit && npx vitest run`
Expected: tsc clean, 8 tests PASS.

- [ ] **Step 2: 서버·웹 회귀 + 린트**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard && npm test && npm run lint`
Expected: 서버 138 · 웹 51 PASS, ESLint 에러 없음.

- [ ] **Step 3: 번들 빌드 확인(런타임 import 깨짐 조기 발견)**

Run: `cd /Users/82312411gimjaehyeog/Dev/pe-dashboard/electron && node build.mjs`
Expected: 에러 없이 `dist/main.cjs` 생성(esbuild가 `updater-unsigned.ts`·`update-helpers.ts`를 정상 번들).

- [ ] **Step 4: 수동 검증(릴리스 후)**

미서명 자동 업데이트는 실제 두 버전이 있어야 검증된다. 별도 배포 단계에서:
- 현재 버전을 0.23.0으로 올려 빌드·배포(`release.sh`)한 뒤, 구버전(0.22.0) 설치본을 실행.
- 업데이트 확인 → 자동 다운로드 진행률(0~100%) → "지금 재시작" → 헬퍼가 번들 교체·재실행 → 버전이 0.23.0인지 확인.
- App Translocation/읽기전용 위치에서 실행 시 "GitHub에서 받기" 폴백이 유지되는지 확인.

---

## Self-Review 메모

- **Spec 커버리지**: ①전략판별→Task 5(`installStrategy`)+Task 1(`classifyBundlePath`) / ②다운로드·추출→Task 2(`pickArm64ZipUrl`)+Task 4(`downloadUnsigned`) / ③교체 헬퍼→Task 3(`buildSwapScript`)+Task 4(`restartWithSwap`) / ④분기 배선→Task 5 / ⑤에러 처리→Task 4·5(throw 수렴, manual 폴백) / ⑥테스트→Task 1·2·3 + Task 6. 누락 없음.
- **타입 일관성**: `InstallStrategy`·`GithubRelease`·`GithubAsset`는 `update-helpers.ts`에서 정의해 `updater-unsigned.ts`·`updater.ts`가 import. `pendingSwapSrc`는 `updater-unsigned.ts` 내부 상태로 `downloadUnsigned`가 설정→`restartWithSwap`가 사용. `currentBundlePath`는 한 곳(`updater-unsigned.ts`)에서 정의해 `updater.ts`가 재사용(중복 제거).
- **electron-free 제약**: 순수 함수는 `update-helpers.ts`에만 두고 electron import 금지 → vitest(node) 통과. I/O는 `updater-unsigned.ts`에 격리.
- **하위호환**: 서명 경로(`squirrel`)·IPC·preload·UpdateModal 불변. `canAutoInstall` 페이로드 필드 의미만 확장.
- **주의(드리프트)**: GitHub repo 슬러그가 `updater.ts`의 `RELEASES_URL`과 `updater-unsigned.ts`의 `RELEASE_API` 두 곳 — 저장소가 바뀌면 양쪽 갱신.
