# Bend 2 semantic benchmark

This benchmark asks the existing Bend AST generator to build a program, runs
that program, and compares its output with an expected result written before
and separately from the candidate. Output comparison is the pass criterion.
Parse, type, and ownership checks remain in the report as separate signals.

The first pilot stopped after those three compiler checks. This suite extends
the pilot without replacing its adapter, probes, or reports in
[`docs/bend2-pilot`](bend2-pilot/README.md).

## What it is useful for

Use the suite to catch a generated Bend program that compiles but computes the
wrong result. It suits small, deterministic tasks with exact text output, such
as arithmetic, comparison, and string construction in the generator's current
subset. A case can also expose a generation error, compiler error, runtime
error, timeout, or output mismatch.

Do not use these results as evidence for theorem proving, broad Bend language
coverage, performance, security, or general coding ability. Three small
fixtures cannot establish those claims. The offline strategies exercise the
generation and execution path reproducibly. They do not measure Jev.
Seeded random decision tests elsewhere in the pilot measure generator paths and
request counts only. They do not measure Jev efficacy.

## Pinned toolchain and compatibility result

The whole-suite toolchain is pinned as follows.

| Tool | Pin |
| --- | --- |
| Node.js | `24.21.0` in `.node-version` |
| pnpm | `10.30.3` in `package.json` |
| TypeScript and `tsx` | exact resolutions in `pnpm-lock.yaml` |
| Bend | version `2.0.20`, commit `7561656155a4285c1e4ccfcb3505ab59524de973` |

The installed Node runtime loaded the pinned Bend checker and compiler on
2026-09-20. All three compiler stages and the JavaScript target ran
successfully. This is compatible with the `bend-build` guidance: the suite uses
the stock compiler, executes the public program path, keeps expected results
independent, and records the trusted toolchain. No compiler fork, patched
output, foreign implementation, or vendored Bend source is involved.

The setup script clones Bend into the ignored `.benchmark-tools/bend`
directory and checks out the exact commit. The benchmark refuses a different
Bend revision, Bend version, or Node version.

## Setup and one-command run

Start from a clean checkout with Node `24.21.0` selected. This one command
installs the locked dependencies, prepares Bend, and runs the whole suite:

```bash
corepack pnpm install --frozen-lockfile && corepack pnpm run benchmark:bend2
```

The second command prepares the pinned Bend checkout and runs every offline
case. It writes `benchmark/bend2/results/offline-latest.json`, which Git
ignores because timestamps and timings change on every machine. No API key,
GPU, native compiler, or paid service is needed. After setup, candidate
generation and execution make no network requests.

The CI workflow in `.github/workflows/bend2-semantic.yml` runs the same setup,
focused tests, and offline suite on Ubuntu 24.04.

## Case format

Case files live in `benchmark/bend2/cases` and follow `case.schema.json`:

```json
{
  "$schema": "../case.schema.json",
  "schemaVersion": 1,
  "id": "add-two",
  "task": "Print the sum of 20 and 22 as a decimal number.",
  "expected": { "stdout": "42\n", "exitCode": 0 },
  "offlineStrategy": "add-two.json"
}
```

Write `expected` from the task specification. Never run a candidate and copy
its output into the case, and never calculate the expectation by importing the
candidate. The parser rejects candidate source fields in a case. The separate
file under `strategies` lists deterministic choices for ambiguous generator
slots. It has no expected output and cannot change the oracle.

The checked-in examples cover addition, equality, and string joining. They run
in CI as part of the suite and have focused format and classification tests in
`test/bend-semantic-benchmark.test.ts`.

## Execution and result classes

For each case, the runner does the following:

1. Sends the case task to `generateBendAst` with either the offline strategy or
   an explicitly authorized live provider.
2. Loads the generated source with the pinned Bend parser.
3. Runs `book_valid` and `book_owned`, recording each stage separately.
4. Compiles the checked book with Bend's JavaScript target.
5. Runs the compiled program in an isolated child process with a 10 second
   timeout and a 64 KiB output limit.
6. Compares the exact exit code and standard output with the case expectation.

A case reports `outcome` as `pass` or `fail`. A failure has one of these
classes:

- `generation_error`: the generator or its provider could not finish a source
- `compile_error`: Bend rejected or could not compile the source
- `runtime_error`: the compiled program failed or exceeded its output limit
- `timeout`: checking, compilation, or execution exceeded the deadline
- `wrong_output`: the program ran but its exit code or output differed

A clean parse, type, and ownership result does not make a case pass. A
`wrong_output` case can have all three compiler signals set to `pass`.

## Measurements

Each case and the run summary store these values as separate fields:

- `successCount` and `failureCount`
- `requestCount`
- input, output, and total `tokenCount`
- `providerLatencyMs`, the time spent waiting for decision providers
- `wallTimeMs`, which also includes generation, compilation, and execution

Offline strategies return zero input and output tokens. Their request count is
still useful as an operational measurement, but it is not a quality score. A
dated local record is in
`docs/bend2-semantic-benchmark/offline-measurement-2026-09-20.json`.

## Live Jev comparison and the missing authorization

The live path is ready but has not been run. No paid API call was made for this
milestone. The current authorization lacks exact positive caps for all three
of these environment variables:

- `JEV_BENCH_MAX_PAID_REQUESTS`
- `JEV_BENCH_MAX_PAID_INPUT_TOKENS`
- `JEV_BENCH_MAX_PAID_OUTPUT_TOKENS`

Those are the exact missing caps. The command refuses to construct a live run
until all three are positive integers. Once an authorized budget supplies
them, and the normal Jev credential is available, run:

```bash
JEV_BENCH_MAX_PAID_REQUESTS=... \
JEV_BENCH_MAX_PAID_INPUT_TOKENS=... \
JEV_BENCH_MAX_PAID_OUTPUT_TOKENS=... \
corepack pnpm exec tsx benchmark/bend2/run.ts --live
```

The provider stops before another request when any cap is reached. Token usage
arrives with a response, so a single response can cross a token cap; the runner
then records the overage and makes no further request. Set authorized token
caps with enough headroom for one bounded decision response.

## Limits

The generator still supports only the subset documented in
`docs/bend2-pilot/evidence/subset-spec.md`. Cases take no stdin or command-line
arguments. Expected output is exact, with no normalization. Runs are
sequential, single-file, CPU-only, and use Bend's JavaScript target. The suite
does not measure native or GPU performance.

The unresolved jev-code licence question remains a release gate. It does not
prevent this local research, but this benchmark does not authorize publishing,
registry release, or redistribution. Bend itself stays in an ignored checkout
at its Apache-2.0-licensed upstream revision.

## Troubleshooting

`Node mismatch` means the active runtime does not match `.node-version`.
Select Node `24.21.0` and rerun the command.

If setup cannot fetch Bend, check GitHub access and rerun
`corepack pnpm run benchmark:bend2:setup`. The script reuses a valid clone and
always resets it to the pinned detached commit.

`Offline strategy expected slot ...` means the generator's decision sequence
changed. Review the generator change and update the strategy only if the task
still produces the same independently specified result. Do not change the
expected output to make a new candidate pass.

For a failed case, inspect `errorClass`, `detail`, `signals`, `actual`, and
`expected` in the JSON report. A compiler signal tells you where Bend rejected
the source. `wrong_output` means Bend accepted and ran it, so debug the
generated program or strategy rather than the checker setup.
