# The supported Bend 2 subset — specification and candidate baseline

Ticket T11 of [`../03-tickets.md`](../03-tickets.md). This is the specification
the generator in `src/bend-ast.ts` is measured against, and the probe set is its
candidate baseline. Every construct below names the probe that establishes it,
and `test/bend-ast.test.ts` asserts that each cited probe exists and has a
recorded `PARSE`/`TYPE`/`OWNED` verdict of `ok` in
`design-probe/probe-output.txt`.

The subset is deliberately tiny. Everything Bend 2 can do that is not listed
here is a known limit, not an oversight; see `../04-report.md`.

## Program shape

```
import Base

def <name>(+<p>: U32, …) -> U32:          # p17-inline-typed-def.bend, p18-inline-copyable-param.bend
  <U32 expression>

def main() -> IO(Unit):                    # p14-compare-bool.bend
  do IO<Unit>:                             # p1-io-print.bend
    +<id> : U32    = <U32 expression>      # p11-copyable-let.bend
    +<id> : String = <String expression>   # p15-string-concat.bend
    u<n> : Unit <- IO.print(<String>)      # p7-two-prints.bend
    IO.print(<String expression>)          # p1-io-print.bend
```

At most one helper definition, at most six statements before the final
`IO.print`, and expression nesting at most three deep.

## Binders are always copyable

Every `def` parameter and every do-block binding is emitted with the `+`
prefix. This is not cosmetic. Bend 2 bindings are affine: dropping one is legal
(`p3-unused-param.bend`) but consuming one twice is refused by the **type**
checker (`p4-param-used-twice.bend`, `p10-let-reuse.bend`), and `+` is what
lifts that restriction (`p8-copyable-param.bend`, `p11-copyable-let.bend`).
Emitting `+` unconditionally means no sequence of generator decisions can
produce the p4/p10 failure.

## Expressions

| Form | Type | Probe |
| --- | --- | --- |
| U32 literal | `U32` | `p6-do-let-seq.bend` |
| String literal | `String` | `p15-string-concat.bend` |
| bound name | its binder's type | `p11-copyable-let.bend` |
| `U32.add(a, b)` / `U32.sub` / `U32.mul` | `U32` | `p13-arith-nested.bend` |
| `U32.is_eq(a, b)` | `Bool` | `p14-compare-bool.bend` |
| `U32.show(a)` | `String` | `p6-do-let-seq.bend` |
| `Bool.show(b)` | `String` | `p14-compare-bool.bend` |
| `String.append(a, b)` | `String` | `p15-string-concat.bend` |
| call to a generated `def` | `U32` | `p12-assign-via-param.bend` |

`U32.eq` is **not** in the table: it does not exist. The pinned Base prelude
defines `U32.is_eq` (`bend2/base.bend:1418`). A probe that used `U32.eq` failed
with `expected "a defined name", observed Ref U32.eq`, and the correction is
recorded rather than silently applied.

Bool has no literal form in this subset, so a `Bool` is only reachable through
`U32.is_eq`. `Bool.show` is therefore the only consumer.

## Deliberately excluded

`match` (`p5-bool-match.bend` shows it type-checks), recursion
(`p16-while-as-recursion.bend` likewise), separate `law` declarations, ADT
declarations, proofs, `IO` beyond `IO.print`, multi-file projects, and code
generation. Each is reachable later; none is in the first slice.

## What this baseline does and does not establish

It establishes that each listed construct **parses** and **type checks** under
the pinned checker, and passes the ownership check. It establishes nothing about
whether a generated program computes what a prompt asked for: nothing here is
executed, so semantic correctness is not measured and is not claimed.

## Baseline probes — every stage recorded `ok`

These are the probes that back the constructs above. `test/bend-ast.test.ts`
asserts each one exists and has `PARSE   ok`, `TYPE    ok` and `OWNED   ok`
recorded in `design-probe/probe-output.txt`.

- `p1-io-print.bend`
- `p2-typed-fn-linear.bend`
- `p3-unused-param.bend`
- `p5-bool-match.bend`
- `p6-do-let-seq.bend`
- `p7-two-prints.bend`
- `p8-copyable-param.bend`
- `p9-copyable-string.bend`
- `p11-copyable-let.bend`
- `p12-assign-via-param.bend`
- `p13-arith-nested.bend`
- `p14-compare-bool.bend`
- `p15-string-concat.bend`
- `p16-while-as-recursion.bend`
- `p17-inline-typed-def.bend`
- `p18-inline-copyable-param.bend`

## Rejection baseline — recorded as refused by the **type** checker

Refused at `book_valid`, not at `book_owned` and not at parse. They are the
rejection fixtures for `test/bend-ast.test.ts`, and the reason the renderer
emits `+` unconditionally.

- `p4-param-used-twice.bend`
- `p10-let-reuse.bend`

## Requirements this baseline depends on

**Node 22.18 or newer.** Reproducing any of it means loading the checker, and
the loader imports its TypeScript entry points and relies on Node stripping
their types, with no build step. Type stripping is only unflagged from Node
22.18; on Node 22.0–22.17 the same run needs `--experimental-strip-types`, and
below Node 22 the checker cannot be loaded at all. The repository's
`package.json` says `node >= 22`, which is looser than this. It is recorded as
a limit rather than repaired: upstream packaging is not this pilot's to rewrite,
and avoiding the `.ts` import would mean building or vendoring the checker,
which the unresolved licence question forbids.

## Measured: what the checker does not catch

A duplicate parameter binder — `def dup(+a: U32, +a: U32) -> U32` — is
**accepted** at all three stages; the checker treats the second binder as
shadowing rather than as an error. Recorded here because it marks the edge of
what a clean three-stage run is evidence of. Nothing in this baseline may be
read as "the checker would have caught it": for this defect it demonstrably does
not, and the generator guards it at the point of construction instead.
