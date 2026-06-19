# 미서명 빌드 자동 업데이트 (in-app 다운로드·교체)

작성일: 2026-06-19
상태: 구현 완료 (main)

## 배경 / 문제

이 앱은 코드 서명(Developer ID)이 없다. macOS 자동 업데이트(Squirrel.Mac)는 정식 서명을
요구하므로 미서명 빌드는 `quitAndInstall()`이 서명 검증에 실패한다(`updater.ts`의
`canAutoInstall()`가 codesign으로 이를 감지). 그래서 현재 미서명 빌드는 업데이트 시
`openReleasePage()`로 GitHub 릴리스 페이지만 열고, 사용자가 직접 zip을 받아
`~/Applications`의 앱을 교체해야 한다.

자동 설치가 막힌 이유는 다운로드가 아니라 Squirrel의 서명 검증이다. zip을 받아 직접 풀고
번들을 교체하는 방식은 Squirrel을 거치지 않으므로 미서명이어도 동작한다 — `release.sh`가
로컬에서 하는 일과 같은 원리.

## 목표

미서명 빌드에서도 앱 안에서 **자동 다운로드 + 압축 해제 + 번들 교체 + 재실행**을 지원한다.
UX는 서명된 빌드와 동일하게: 다운로드는 자동(진행률 표시), 교체+재시작은 사용자가
"지금 재시작" 클릭 시. 내부 메커니즘만 Squirrel 대신 커스텀 교체를 쓴다.

비목표(YAGNI): 무인(완전 자동) 교체·재시작, Windows/Intel 대응(현재 arm64 mac 전용 빌드),
blockmap 델타 업데이트.

## 접근법 (승인: A — 분리된 셸 헬퍼 스크립트)

실행 중인 앱은 자기 번들을 덮을 수 없으므로, "지금 재시작" 시 임시 bash 스크립트를
detached로 띄우고 `app.quit()` 한다. 스크립트가 우리 PID 종료를 기다렸다가 새 번들로
교체하고 재실행한다. 추가 바이너리 없이 미서명에서 확실히 동작한다.

## ① 설치 전략 판별 (`updater.ts`)

`canAutoInstall(): boolean`을 `installStrategy(): 'squirrel' | 'custom' | 'manual'`로 확장한다.

- 서명됨 → `squirrel` (기존 electron-updater 경로 유지)
- 미서명 + 번들 경로가 쓰기 가능 & 비-translocation → `custom` (신규)
- 미서명 + 읽기전용/App Translocation(경로에 `/AppTranslocation/` 포함) → `manual` (기존 폴백)

경로 판정은 순수 헬퍼 `classifyBundlePath(bundlePath, isWritable): 'custom' | 'manual'`로
분리해 테스트한다. `checkUpdateStatus`의 `canAutoInstall` 필드는 `strategy !== 'manual'`로
채운다. 즉 미서명이어도 대부분 true가 되어 UpdateModal이 자동 다운로드 UI를 보여준다.

서명 감지 로직(codesign)과 캐시는 기존 `canAutoInstall()` 내부 로직을 `installStrategy()`로
옮겨 재사용한다.

## ② 다운로드 + 압축 해제 (신규 `electron/src/updater-unsigned.ts`)

- `pickArm64ZipUrl(release): string` — GitHub `releases/latest` JSON의 `assets[]`에서
  `name`이 `*-arm64-mac.zip`인 에셋의 `browser_download_url` 반환. 없으면 throw. 순수 함수.
- `fetchLatestRelease(): Promise<release>` — `https://api.github.com/repos/jehyukkim674/pe-dashboard/releases/latest`
  조회(JSON). User-Agent 헤더 필수(GitHub API 요구).
- `downloadUnsigned(onProgress): Promise<string>` — `pickArm64ZipUrl`로 얻은 URL을
  Node `https.get`(리다이렉트 추적)으로 `app.getPath('temp')/pe-update-<version>/app.zip`에
  스트리밍 저장, `content-length` 기준 0~99% 송출 → `spawnSync('/usr/bin/ditto', ['-x','-k', zip, extractDir])`로
  해제(앱 번들 심볼릭링크·권한 보존) → 추출 디렉터리에서 `*.app` 경로 반환, 100% 송출.

## ③ 종료 후 교체 헬퍼 (`updater-unsigned.ts`)

- `buildSwapScript({ pid, srcApp, destApp }): string` — 순수 함수. 경로는 작은따옴표로
  감싸 공백·특수문자 안전 처리. 생성 결과:
  ```bash
  #!/bin/bash
  while kill -0 PID 2>/dev/null; do sleep 0.2; done
  /usr/bin/ditto 'SRC' 'DEST.new' && rm -rf 'DEST' && mv 'DEST.new' 'DEST'
  /usr/bin/xattr -dr com.apple.quarantine 'DEST' 2>/dev/null || true
  /usr/bin/open 'DEST'
  ```
- `restartWithSwap(srcApp, destApp): void` — 스크립트를 temp에 쓰고
  `spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref()` 후
  `app.quit()`.

`destApp`(현재 번들)은 `path.resolve(app.getPath('exe'), '..','..','..')`로 구한다
(`canAutoInstall`이 쓰던 것과 동일).

## ④ 분기 배선

- `startInstall(win)`: `installStrategy()`가
  - `custom` → `downloadUnsigned(send)` 호출, 반환된 `.app` 경로를 모듈 변수
    `pendingSwapSrc`에 저장(다운로드까지만; 재시작은 클릭).
  - `squirrel` → 기존 `autoUpdater.downloadUpdate()`.
  - 둘 다 같은 `win.webContents.send('updater:progress', percent)` 사용.
- `restartToUpdate()`: `custom`이면 `restartWithSwap(pendingSwapSrc, destApp)`,
  `squirrel`이면 `autoUpdater.quitAndInstall()`.
- IPC(`main.ts`)·preload·UpdateModal **시그니처 변경 없음**. UpdateModal은 `canAuto`가
  미서명에서도 true가 되어 자동 분기(Progress → "지금 재시작")를 그대로 탄다.
  `manual` 전략일 때만 기존 "GitHub에서 받기" 폴백이 보인다.

## ⑤ 에러 처리

- 다운로드/추출 실패 → `startInstall`에서 throw → UpdateModal의 `install()` catch가
  `message.error` 표시, 진행률 리셋.
- 전략이 `manual`이면 자동 다운로드를 시도하지 않고 기존 수동 폴백 유지.
- 교체 스크립트의 quarantine 제거는 best-effort(`|| true`). 교체(ditto/mv) 실패 시 앱은
  종료되었지만 구버전이 그대로 남아 다음 실행에 다시 업데이트를 제안받는다(데이터 손실 없음).
- GitHub API rate limit/네트워크 오류는 throw로 수렴해 동일 처리.

## ⑥ 테스트 (electron 워크스페이스에 vitest 추가)

electron에 테스트 환경이 없으므로 `vitest`와 `"test": "vitest run"` 스크립트를 추가하고,
순수 함수 위주로 검증한다(다운로드·spawn·ditto는 I/O라 수동 검증).

- `pickArm64ZipUrl`: 샘플 릴리스 JSON → arm64 zip URL 선택, blockmap·yml·다른 arch는
  무시, 해당 에셋 없으면 throw.
- `buildSwapScript`: pid/src/dest 주입 시 `kill -0 <pid>`·`ditto`·`xattr`·`open`과 정확한
  경로가 포함되고 경로가 따옴표로 감싸지는지 검증.
- `classifyBundlePath`: `/AppTranslocation/` 포함 또는 비쓰기 → `manual`, 그 외 → `custom`.

수동 검증: v0.23.0 빌드·배포 후, 구버전(0.22.0) 패키징 앱에서 업데이트 확인 → 자동
다운로드 진행률 → "지금 재시작" → 새 번들 교체·재실행까지 확인.

## 하위호환 / 영향

- 서명된 빌드 경로는 코드·동작 불변(전략 `squirrel`).
- `UpdateCheck` 페이로드 형태(`canAutoInstall: boolean`)는 그대로. 의미만 "Squirrel 가능"에서
  "자동 설치(스쿼럴 또는 커스텀) 가능"으로 넓어진다.
- 신규 의존성 없음(Node 내장 `https`, 시스템 `ditto`/`xattr`/`open`/`bash` 사용).
