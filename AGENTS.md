# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Running the tests

`pnpm run test` shells out to real toolchains and skips a language when its
binary is missing (`test/lang-fuzz.test.ts:53`). A skip is *unverified*, not
passed — read the skip list before calling a run green.

The Bend adapter's compiler-backed tests need `JEV_BEND_PATH` set to a
`bendlang/bend` checkout; upstream Bend is referenced by path and deliberately
not vendored, because the licence question is unresolved. Without it `validate`
fails closed and those tests skip. See `docs/bend2-pilot/04-report.md`.

`corepack pnpm run benchmark:bend2` prepares the pinned Bend checkout and runs
the offline semantic suite. Its cases, measurements, live-budget gate, and
troubleshooting notes are documented in `docs/bend2-semantic-benchmark.md`.

The optional Pi 0.85.1 Bend sidecar, including its per-session enablement and
read-only boundaries, is documented in `docs/sidecar/pi-extension.md`. Its tests
use a stub `jevhelper`; the normal test suite makes no live Jev calls.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
