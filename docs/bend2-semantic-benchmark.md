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
directory and checks out the exact commit. Set `JEV_BENCH_TOOL_ROOT` to put
the tool directory elsewhere, or set `JEV_BEND_PATH` to use a specific Bend
checkout. `JEV_BEND_PATH` takes precedence in both setup and execution. Relative
override paths resolve from the jev-code repository root. The benchmark refuses
a different Bend revision, Bend version, or Node version.

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

The authorized live record is in
`docs/bend2-semantic-benchmark/live-measurement-2026-09-21.json`. Its error
stack keeps every frame but replaces the disposable checkout prefix with
`<repository>`.

## Live Jev comparison

Firstmate authorized one live run on 2026-09-21 with these caps:

| Measurement | Authorized cap | Observed |
| --- | ---: | ---: |
| Requests | 300 | 35 |
| Input tokens | 600,000 | 33,547 |
| Output tokens | 60,000 | 2,943 |

The run used the clean PR head
`3c91ec521bc57a9710fd7e5ef359a13b5b724735` and the pinned Bend checkout. The
TypeSafe key entered the process through the environment and is not stored in
the report. The benchmark has no OpenRouter arm, so it made zero OpenRouter
requests.

No case passed the semantic criterion:

| Case | Result | Expected stdout | Actual stdout | Compiler signals | Requests | Input tokens | Output tokens | Provider latency | Wall time |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `add-two` | `wrong_output` | `42\n` | `80\n` | parse, type, ownership passed | 14 | 13,209 | 1,063 | 1,670.990 ms | 2,355.660 ms |
| `compare-numbers` | `wrong_output` | `True\n` | `False\n` | parse, type, ownership passed | 12 | 11,328 | 940 | 1,447.965 ms | 2,013.209 ms |
| `join-words` | `generation_error` | `semantic check\n` | not run | parse, type, ownership not run | 9 | 9,010 | 940 | 1,143.505 ms | 1,153.968 ms |

The run recorded zero successes, three failures, 36,490 total tokens,
4,262.461 ms of provider latency, and 5,574.735 ms of wall time. The first two
programs compiled and ran, but computed the wrong result. The third case
stopped during generation because Jev returned an invalid choice distribution.
This is a direct Jev result, unlike the seeded random generator tests. It is
also only one run over three small cases, so it does not establish broader Jev
quality.

The command still requires explicit positive caps. A future run needs a new
authorization and the normal Jev credential:

```bash
JEV_BENCH_MAX_PAID_REQUESTS=... \
JEV_BENCH_MAX_PAID_INPUT_TOKENS=... \
JEV_BENCH_MAX_PAID_OUTPUT_TOKENS=... \
corepack pnpm exec tsx benchmark/bend2/run.ts --live
```

The provider stops before another request when any cap is reached. Token usage
arrives with a response, so a single response can cross a token cap; the runner
then records the overage and makes no further request. Set authorized token
caps with enough headroom for one bounded decision response. The request count
is reserved before dispatch, so rejected and timed-out provider calls still
consume the request cap.

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
checks out the pinned detached commit. It refuses tracked or untracked local
changes instead of reporting a modified compiler as reproducible. Remove those
changes yourself or choose a fresh `JEV_BENCH_TOOL_ROOT`.

If you set `JEV_BEND_PATH`, setup checks that checkout instead of the path under
`JEV_BENCH_TOOL_ROOT`. A dirty `JEV_BEND_PATH` checkout fails before setup
fetches or changes it. Remove the local changes yourself or point
`JEV_BEND_PATH` at a clean checkout of the pinned revision. The execution
command repeats the cleanliness check before it generates a candidate, so a
direct live command cannot spend from its request budget with a modified
compiler.

`Offline strategy expected slot ...` means the generator's decision sequence
changed. Review the generator change and update the strategy only if the task
still produces the same independently specified result. Do not change the
expected output to make a new candidate pass.

For a failed case, inspect `errorClass`, `detail`, `signals`, `actual`, and
`expected` in the JSON report. A compiler signal tells you where Bend rejected
the source. `wrong_output` means Bend accepted and ran it, so debug the
generated program or strategy rather than the checker setup.
