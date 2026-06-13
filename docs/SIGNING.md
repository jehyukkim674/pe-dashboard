# macOS 코드 서명 · 공증 (자동 업데이트 활성화)

## 왜 필요한가

macOS 자동 업데이트(electron-updater → Squirrel.Mac)는 **Apple Developer ID 정식 서명**을 요구한다.
현재 빌드는 서명 인증서가 없어 **ad-hoc 서명**(`codesign -dv` → `Signature=adhoc`, `TeamIdentifier=not set`)이라,
업데이트 다운로드는 되지만 `quitAndInstall`이 서명 검증에 실패해 **적용되지 않는다**.

그동안의 대응: 미서명 빌드에서는 업데이트 모달이 자동 설치 대신 **‘GitHub에서 받기’**(릴리스 페이지)로
안내한다(`updater.ts`의 `canAutoInstall()`이 codesign으로 서명 여부를 판별). 서명을 켜면 자동으로
원래의 ‘업데이트 → 지금 재시작’ 흐름으로 돌아간다.

## 준비물

1. **Apple Developer 계정** ($99/년)
2. **Developer ID Application 인증서** — Keychain에 설치하거나 `.p12`로 내보내기
3. 공증용 **앱 전용 암호**(App-Specific Password)와 **Team ID**

## 활성화 방법

### 1) `electron/electron-builder.yml`의 `mac:` 블록에 추가

```yaml
mac:
  category: public.app-category.developer-tools
  hardenedRuntime: true                       # 공증 필수
  entitlements: build/entitlements.mac.plist  # 이미 준비됨
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true                              # @electron/notarize 사용 (APPLE_* 환경변수)
  target:
    - target: zip
      arch: [arm64]
```

### 2) 빌드 시 환경변수 제공

```bash
# Developer ID 인증서 (.p12 경로와 암호) — Keychain에 있으면 생략 가능
export CSC_LINK="/path/to/DeveloperID.p12"
export CSC_KEY_PASSWORD="인증서 암호"
# 공증
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

npm run app:build      # 서명 + 공증된 zip 생성
npm run release -- "릴리스 노트"
```

### 3) 검증

```bash
codesign -dv --verbose=2 ~/Applications/"PE Dashboard.app"
#   Authority=Developer ID Application: ... (TEAMID)
#   TeamIdentifier=ABCDE12345        ← not set 이 아니어야 함
spctl -a -vvv ~/Applications/"PE Dashboard.app"   # accepted: Notarized Developer ID
```

서명·공증이 적용되면 `canAutoInstall()`이 `true`가 되어 앱 안에서 자동 업데이트가 정상 동작한다.

## 참고

- 인증서 없이 빌드하면 electron-builder가 자동으로 ad-hoc 서명한다(현재 상태). `notarize: true`라도
  Developer ID 서명이 아니면 공증은 건너뛴다.
- `build/entitlements.mac.plist`는 이미 저장소에 있다(Hardened Runtime에서 Electron 실행에 필요한 권한).
