# Empirical verifier versus Bend law

## Result

The empirical verifier caught all eight seeded defects. The Bend law gate
caught none. This is the expected distinction for the declaration under test:
the law gives `dbl` the type `U32 -> U32`, but does not state that the result
equals `a + a`. Every defective implementation still had that type, obeyed the
ownership rules, and contained no holes.

The run finished at `2026-09-22T04:21:26.293Z`. It used Node `24.21.0`, pnpm
`10.30.3`, and stock Bend `2.0.20` at commit
`7561656155a4285c1e4ccfcb3505ab59524de973`. Both arms used only the local
compiler. Each result therefore cost $0, with 0 paid calls and 0 input or output
tokens.

| Seeded defect | Replacement for `dbl` | Empirical verifier | Bend law gate | Verifier latency | Law latency | Verifier cost | Law cost |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `identity` | `a` | caught | missed | 547.652 ms | 523.211 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `constant-zero` | `0` | caught | missed | 528.514 ms | 156.642 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `add-one` | `U32.add(a, 1)` | caught | missed | 591.752 ms | 216.344 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `square` | `U32.mul(a, a)` | caught | missed | 592.254 ms | 169.073 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `double-plus-one` | `U32.add(U32.add(a, a), 1)` | caught | missed | 769.371 ms | 140.389 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `subtract-self` | `U32.sub(a, a)` | caught | missed | 704.759 ms | 204.924 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `double-minus-one` | `U32.sub(U32.add(a, a), 1)` | caught | missed | 476.231 ms | 85.295 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `triple` | `U32.add(U32.add(a, a), a)` | caught | missed | 520.823 ms | 94.553 ms | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |

Detection rates were 8 of 8 for the empirical verifier and 0 of 8 for the law
gate. These rates describe this fixture only.

## Property and method

The pilot already contains this Bend declaration in
`evidence/design-probe/p8-copyable-param.bend`:

```bend
law dbl:
  for +a: U32
  U32
```

In this Bend version, the declaration gives `dbl` its function type. It does
not express an equality between the returned value and `U32.add(a, a)`.

The empirical property is stronger. For each input in
`[0, 1, 2, 7, 21, 100]`, `dbl(a)` must equal `U32.add(a, a)`. The verifier
compiles the candidate with Bend's JavaScript target, runs it, and compares
exact standard output with `0\n2\n4\n14\n42\n200\n`.

`benchmark/bend2/verifier-vs-law/defects.json` supplies eight replacement
bodies for `dbl`. The runner gives the same replacement to two independent
checks:

1. The law arm loads the candidate, runs `book_valid` and `book_owned`, and
   rejects remaining holes. Only a `BendCheckError` from those validation
   stages counts as the law catching a defect.
2. The empirical arm compiles and runs a separate candidate. An execution
   failure or exact-output mismatch counts as the verifier catching a defect.

A missing checker module, temporary-file error, or other infrastructure failure
aborts the run. It never receives credit as a law rejection.

The pinned checkout lived outside the repository at
`/tmp/jc-bend2-run-comparison-tools/bend`. The repository setup script created
it with:

```bash
JEV_BENCH_TOOL_ROOT=/tmp/jc-bend2-run-comparison-tools \
  corepack pnpm run benchmark:bend2:setup
```

Before the comparison, the pilot's `evidence/design-probe/check.mjs` smoke
check ran `p8-copyable-param.bend` against that checkout. Parse, type,
ownership, and hole checks all passed. The comparison then ran with:

```bash
JEV_BEND_PATH=/tmp/jc-bend2-run-comparison-tools/bend \
  corepack pnpm run benchmark:bend2:verifier-vs-law
```

The command verifies the Bend revision, Bend version, Node version, and clean
checkout before measuring candidates. It writes the raw report to
`benchmark/bend2/results/verifier-vs-law-latest.json`. Git ignores that file
because its timestamp and timings vary by machine.

## Caveats

- The empirical verifier samples six values. It can miss a defect that agrees
  on those values and fails elsewhere. It is not a proof over all `U32` values.
- The Bend law states only a type. Passing its gate means the implementation
  has that type, obeys ownership rules, and has no holes. It does not prove the
  doubling property.
- A failed empirical check reports wrong behavior for the sampled inputs. It
  does not identify a Bend checking stage that should reject the program.
- Each latency is one wall-clock observation, not a distribution. It includes
  compiler startup and file-system noise. The runner checks the law arm before
  the empirical arm for every defect, and the first row can include cold-cache
  work.
- The verifier and law latencies cover different work. Their absolute values
  are recorded for reproducibility, not as a speed comparison.
- The cost fields cover paid API use only. They do not price local CPU time or
  electricity.
- The run used the stock pinned compiler on Linux x86_64, CPU only. It used no
  Bun runtime, GPU, API key, account, or paid service.
- The unresolved jev-code licence question is unchanged. The Bend checkout was
  referenced by path, not vendored or published.
