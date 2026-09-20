#!/usr/bin/env bash
# Re-run every design probe against the pinned Bend 2 checker.
#
#   ./run-all.sh
#
# check.mjs imports ../bend/bend2/{bend,comp}.ts relative to this directory, so
# a clone of bendlang/bend at 7561656155a4285c1e4ccfcb3505ab59524de973 must be
# placed at ../bend first. It is deliberately NOT committed here: the jev-code
# licence question is unresolved (see ../../01-inspection.md section 2), so
# upstream source is referenced by path and never vendored.
#
# Node 22+ is required (.ts imports are resolved by type-stripping, no build).
# Each probe prints PARSE / TYPE / OWNED / HOLES separately; do not collapse
# them into a single pass-fail verdict.
set -u
for f in p*.bend; do
  printf '== %s\n' "$f"
  sed 's/^/   | /' "$f"
  node check.mjs "$f"
  printf '   exit=%d\n\n' "$?"
done
