#!/usr/bin/env bash
# PE Dashboard 릴리스 자동화.
# gh release create 한 번에 대용량 zip을 몰면 업로드 중 실패해 draft로 남는 사고가 반복됐다(v0.17.0).
# 그래서 '작은 에셋으로 먼저 게시 → zip 분리 업로드 → 검증 → 설치' 순서로 안전하게 진행한다.
#
# 사용법:
#   1) electron/package.json 버전 업 + 커밋  (별도 리뷰 커밋)
#   2) npm run app:build                      (electron/release/* 생성)
#   3) npm run release -- "릴리스 노트(마크다운)"
set -euo pipefail

cd "$(dirname "$0")/.."

NOTES="${1:-}"
VERSION="$(node -p "require('./electron/package.json').version")"
TAG="v${VERSION}"
ZIP="electron/release/PE-Dashboard-${VERSION}-arm64-mac.zip"
BLOCKMAP="${ZIP}.blockmap"
YML="electron/release/latest-mac.yml"

echo "▶ 릴리스 ${TAG} 준비"

# 0. 빌드 산출물 확인
for f in "$ZIP" "$BLOCKMAP" "$YML"; do
  if [ ! -f "$f" ]; then
    echo "✗ $f 가 없습니다 — 먼저 'npm run app:build'를 실행하세요" >&2
    exit 1
  fi
done

# 1. 같은 태그 릴리스 중복 방지
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "✗ 릴리스 ${TAG} 가 이미 존재합니다 (중복 게시 방지)" >&2
  exit 1
fi

# 2. 커밋 푸시 (태그는 release create가 생성)
echo "▶ git push"
git push

# 3. 작은 에셋(yml·blockmap)만으로 먼저 'draft'로 생성 — zip 업로드가 끝날 때까지
#    latest-mac.yml을 공개하지 않는다. 예전엔 여기서 바로 정식 게시해, 게시~zip 업로드 사이에
#    클라이언트가 새 버전을 발견하고 아직 없는 zip을 받으려다 404로 업데이트가 깨지는 창이 있었다.
echo "▶ 릴리스 draft 생성 (메타 + 작은 에셋)"
gh release create "$TAG" "$YML" "$BLOCKMAP" --draft --title "$TAG" --notes "${NOTES:-$TAG}"

# 4. 대용량 zip 분리 업로드 (아직 draft라 클라이언트에 노출되지 않는다)
echo "▶ zip 업로드 ($(du -h "$ZIP" | cut -f1))"
gh release upload "$TAG" "$ZIP" --clobber

# 5. 에셋 3종 검증 (자동 업데이트에 zip·blockmap·yml 모두 필요)
COUNT="$(gh release view "$TAG" --json assets --jq '[.assets[].name] | length')"
if [ "$COUNT" -lt 3 ]; then
  echo "✗ 에셋이 3개 미만입니다 (${COUNT}개) — 업로드 누락 확인 (draft 유지)" >&2
  exit 1
fi

# 6. 모든 에셋이 준비된 뒤에만 정식 게시(draft 해제) — 여기서부터 클라이언트가 업데이트를 본다
echo "▶ 정식 게시 (draft 해제)"
gh release edit "$TAG" --draft=false
DRAFT="$(gh release view "$TAG" --json isDraft --jq .isDraft)"
if [ "$DRAFT" != "false" ]; then
  echo "✗ 릴리스가 여전히 draft 상태입니다 — 수동 확인 필요" >&2
  exit 1
fi
echo "✓ 릴리스 검증 OK — 에셋 ${COUNT}개, draft=false"

# 7. 로컬 설치 — 기존 번들을 먼저 지우고 풀어(ditto는 덮어쓰기만 하고 사라진 파일은 안 지움)
#    이전 버전의 잔재 파일이 번들에 누적되지 않게 한다.
echo "▶ ~/Applications 설치"
rm -rf "$HOME/Applications/PE Dashboard.app"
ditto -x -k "$ZIP" "$HOME/Applications/"

URL="$(gh release view "$TAG" --json url --jq .url)"
echo "✅ ${TAG} 배포 완료 — ${URL}"
