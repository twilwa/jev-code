#!/usr/bin/env bash
set -euo pipefail

readonly BEND_REVISION=7561656155a4285c1e4ccfcb3505ab59524de973
readonly BEND_REPOSITORY=https://github.com/bendlang/bend.git
readonly TOOL_ROOT="${JEV_BENCH_TOOL_ROOT:-.benchmark-tools}"
readonly BEND_ROOT="$TOOL_ROOT/bend"

mkdir -p "$TOOL_ROOT"
if [[ ! -d "$BEND_ROOT/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$BEND_REPOSITORY" "$BEND_ROOT"
fi

git -C "$BEND_ROOT" fetch --depth=1 origin "$BEND_REVISION"
git -C "$BEND_ROOT" checkout --detach "$BEND_REVISION"
test "$(git -C "$BEND_ROOT" rev-parse HEAD)" = "$BEND_REVISION"
test -f "$BEND_ROOT/bend2/bend.ts"
test -f "$BEND_ROOT/bend2/comp.ts"
if [[ -n "$(git -C "$BEND_ROOT" status --porcelain --untracked-files=all)" ]]; then
  printf 'Bend checkout has local modifications: %s\n' "$BEND_ROOT" >&2
  exit 1
fi

printf 'Bend 2 toolchain ready: %s\n' "$BEND_REVISION"
