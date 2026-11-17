#!/bin/sh
# Build a throwaway "todo web app" project with this checkout's VibeRail installed, so a
# person can play the vibe coder and walk the whole cycle (intent → … → retro) by hand.
# Same starting point every run. Re-running wipes only a folder this script made.
# usage: scripts/sandbox.sh [dir]   (default /tmp/viberail-sandbox)
set -eu
QH="$(cd "$(dirname "$0")/.." && pwd)/bin/qh.js"
DIR=${1:-/tmp/viberail-sandbox}
MARK=.git/viberail-sandbox
if [ -e "$DIR" ]; then
  [ -f "$DIR/$MARK" ] || { echo "멈춤: $DIR 는 이 스크립트가 만든 폴더가 아니다" >&2; exit 1; }
  rm -rf "$DIR"
fi
mkdir -p "$DIR" && cd "$DIR"
git init -q -b main && touch "$MARK"
printf '{\n  "name": "todo",\n  "private": true\n}\n' > package.json
printf '# 할 일 목록\n' > README.md
git add -A && git commit -qm "첫 커밋"
node "$QH" init .
git add -A && git commit -qm "chore: qh 설치"
echo
echo "준비됨: $DIR"
echo "다음: cd $DIR && claude  → 바이브코더처럼 \"할 일 목록 웹앱 만들어줘\""
