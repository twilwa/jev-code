# Empirical verifier versus Bend law

## Result

The comparison did not run because the pinned Bend checkout was absent. The
runner looked for
`.benchmark-tools/bend/bend2/bend.ts`, with no `JEV_BEND_PATH` override set,
and stopped before checking any candidate. It made no API requests and spent
nothing on paid services.

This is an unavailable result, not a clean test or proof result. The table
keeps those two results separate even though neither was measured.

| Seeded defect | Replacement for `dbl` | Empirical verifier caught | Bend law gate caught | Verifier latency | Law latency | Verifier cost | Law cost |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `identity` | `a` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `constant-zero` | `0` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `add-one` | `U32.add(a, 1)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `square` | `U32.mul(a, a)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `double-plus-one` | `U32.add(U32.add(a, a), 1)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `subtract-self` | `U32.sub(a, a)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `double-minus-one` | `U32.sub(U32.add(a, a), 1)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |
| `triple` | `U32.add(U32.add(a, a), a)` | not run | not run | not measured | not measured | $0, 0 calls, 0 tokens | $0, 0 calls, 0 tokens |

## Property and method

The pilot already contains this Bend declaration in
`evidence/design-probe/p8-copyable-param.bend`:

```bend
law dbl:
  for +a: U32
  U32
```

In this version of Bend, that `law` declares the function type. It establishes
that `dbl` accepts a copyable `U32` and returns a `U32`. It does not state that
the returned value equals `a + a`.

The empirical property is stronger: for each input in
`[0, 1, 2, 7, 21, 100]`, `dbl(a)` must equal `U32.add(a, a)`. The verifier runs
the candidate through Bend's JavaScript target and compares exact standard
output with `0\n2\n4\n14\n42\n200\n`.

The fixture in
`benchmark/bend2/verifier-vs-law/defects.json` replaces the body of `dbl` with
each expression in the table. Both arms receive the same replacement:

1. The law arm loads the candidate, runs `book_valid` and `book_owned`, and
   checks for holes. A rejection means the law gate caught the defect.
2. The empirical arm compiles and runs a separate candidate, then compares its
   output with the fixed expectation. An execution failure or output mismatch
   means the verifier caught the defect.

The JSON report stores a separate Boolean, wall-clock latency, diagnostic and
cost object for each arm and each defect. Cost records paid calls, input tokens,
output tokens and US dollars. Every value is zero because the runner uses only
the local compiler. Run it with:

```bash
JEV_BEND_PATH=/path/to/pinned/bend corepack pnpm run benchmark:bend2:verifier-vs-law
```

The command verifies the Bend revision, Bend version and Node version before it
starts. It writes `benchmark/bend2/results/verifier-vs-law-latest.json`, which
Git ignores because timestamps and timings vary by machine. It does not install
or download Bend.

## Checks completed without Bend

`corepack pnpm exec tsx --test test/bend-verifier-vs-law.test.ts` passed four
tests. They check the fixture count, distinct mutations, source injection and
the separation between compiler signals and the empirical verdict.
`corepack pnpm run typecheck` also passed.

## Limits

No defect outcome or latency was measured in this checkout. The likely outcome
must not be copied into the table as evidence. A machine with the pinned Bend
checkout still needs to run the command and preserve its JSON report before
making a detection-rate claim.

The empirical verifier samples six values. It can miss a defect that agrees on
those values and fails elsewhere. It is not a proof over all `U32` values.

The Bend law is only the type declaration shown above. Passing its gate says
the implementation has that type, obeys ownership rules and has no holes. It
does not prove the doubling property. Conversely, a failed empirical check does
not say which Bend checking stage would reject a program. The two columns are
not substitutes for one another.

The latency is a single wall-clock observation per arm and defect, not a
benchmark distribution. It includes startup and file-system noise. The cost
fields measure paid API use only. They do not estimate CPU time or electricity.
