#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd -P)"

if [[ -n "${JEV_BEND_PATH:-}" ]]; then
  bend_root="$JEV_BEND_PATH"
else
  bend_root="${JEV_BENCH_TOOL_ROOT:-$REPOSITORY/.benchmark-tools}/bend"
fi

if [[ "$bend_root" != /* ]]; then
  bend_root="$REPOSITORY/$bend_root"
fi

printf '%s\n' "$bend_root"
