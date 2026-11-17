#!/bin/sh
# Compare skills/vendor/mattpocock-skills with an upstream checkout (you check out the
# commit yourself). Shows diff -r; only with --apply replaces the copy and rewrites UPSTREAM.
# usage: scripts/vendor-pocock.sh <upstream-path> <commit> [--apply]
set -eu
UP=${1:?upstream path}; COMMIT=${2:?commit}; V="$(dirname "$0")/../skills/vendor/mattpocock-skills"
SKILLS="grill-with-docs domain-modeling codebase-design improve-codebase-architecture tdd to-spec to-tickets retro grilling writing-for-agents"
NEW=$(mktemp -d); trap 'rm -rf "$NEW"' EXIT
for s in $SKILLS; do cp -R "$(ls -d "$UP"/skills/*/"$s")" "$NEW/$s"; done
mkdir "$NEW/agents-docs"
for f in issue-tracker-local triage-labels domain; do cp "$UP/skills/engineering/setup-matt-pocock-skills/$f.md" "$NEW/agents-docs/"; done
cp "$UP/LICENSE" "$NEW/LICENSE"
printf '%s\n%s\n' "$(sed -n 1p "$V/UPSTREAM")" "$COMMIT" > "$NEW/UPSTREAM"
find "$NEW" -name .DS_Store -delete
diff -r "$V" "$NEW" && echo "no difference" || true
[ "${3:-}" = "--apply" ] || { echo "(dry run: add --apply to replace the copy)"; exit 0; }
rm -rf "$V" && cp -R "$NEW" "$V" && echo "applied: $COMMIT"
