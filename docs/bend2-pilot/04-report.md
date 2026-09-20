# Phase 3 — what was built, and what it does and does not claim

Phase 3 of TES-46. The design decision and the tickets it implements are in
`03-tickets.md`; the inspection behind them is in `01-inspection.md` and
`02-graph.md`.

Run environment for every measurement below: Node `v24.21.0`, pnpm `10.30.3`,
Linux x86_64, CPU-only, no GPU, no Bun, no API key, no new paid API spend.
Bend checker: `bendlang/bend` pinned at
`7561656155a4285c1e4ccfcb3505ab59524de973`, referenced by path and never
vendored (see §7).

---

## 1. What was added

| File | Status | Contents |
| --- | --- | --- |
| `src/bend-ast.ts` | new, 317 lines | Bend term types, renderer, the bounded decision loop, the four-stage checker driver, and the `bendAstAdapter` object. |
| `src/lang/index.ts` | modified, +2 −1 | One import and one array element appending `bendAstAdapter` to `bundledAstAdapters()`. |
| `test/bend-ast.test.ts` | new, 321 lines | 23 tests: renderer units, decision-loop units, registry and routing, validation, rejection fixtures, end-to-end, a seeded fuzz round, and two self-checking lints. |
| `docs/bend2-pilot/evidence/subset-spec.md` | new | Ticket T11's candidate baseline: the supported subset, each row cited to a probe. |
| `docs/bend2-pilot/evidence/request-count.mts`, `request-count.txt` | new | The request-count measurement of §6 and its recorded output. |

`src/lang/index.ts` is the only existing source file touched, and the change is
additive. `src/lang/core.ts`, the `Dialect` backends, `src/ast-adapters.ts`,
`src/generation.ts` and the provider layer are unmodified. No existing test was
changed, renamed, deleted or skipped.

Delivered tickets: **T1–T11**, the whole set. The smallest useful slice defined
in `03-tickets.md` §2 was T1–T6 and T8–T10; T7 and T11 rode along as that
section anticipated, and neither proved awkward.

---

## 2. Parse validity — claim 1

**What is claimed.** Every program the generator emits is accepted by the real
Bend 2 parser, `Bend.book_load`, at the pinned commit.

**Evidence.** `src/bend-ast.ts:160` calls `Bend.book_load` on a file written
from the generated source and turns any failure into
`BendCheckError('parse', …)`. The claim is exercised by:

- `test/bend-ast.test.ts:258` — `every program reachable by random decisions
  parses, types and passes ownership`. 12 seeded programs by default; run at
  `JEV_BEND_FUZZ_ROUNDS=400` during development, all accepted.
- `test/bend-ast.test.ts:204` — a fixed valid program reaches all of `parse`,
  `type` and `owned`.
- `test/bend-ast.test.ts:243` — `generateText` rejects a broken adapter's output
  with `/Bend parse failed/`, so a parse failure is visibly a parse failure.

**What this does not establish.** A `book_load` pass says the bytes are a
well-formed Bend book. It says nothing about types, ownership, proofs or
behaviour. The graph's own vocabulary blends these (`03-tickets.md` T10: six
`verify generated source is well formed_*` nodes all describe themselves as
confirming that source "parses and type checks", which is false of
`src/lang/lua.ts:76-80`, a `luac -p` parse check only). That conflation is the
thing this section exists to avoid.

---

## 3. Typing and proofs — claim 2

**What is claimed.** Every program the generator emits is accepted by
`Bend.book_valid` (types, and the linearity/affinity rule enforced there) and by
`Comp.book_owned` (ownership), and contains no holes.

**Evidence.** `src/bend-ast.ts:163` (`book_valid` → `BendCheckError('type', …)`),
`:166` (`Comp.book_owned` → `BendCheckError('owned', …)`), `:169` (`book.hols +
book.open > 0` → `BendCheckError('holes', …)`). Each stage is a separate
`BendStage` value so a failure is attributable to one stage and not smeared
across the others. Rejection fixtures assert the exact stage:

| Fixture | Defect | Refused at |
| --- | --- | --- |
| `evidence/bend-probe/bad1-syntax-error.bend` | unbalanced parameter list | `parse` |
| `evidence/bend-probe/bad2-type-error.bend` | `String` body under a `U32` law | `type` |
| `evidence/design-probe/p4-param-used-twice.bend` | affine parameter consumed twice | `type` |
| `evidence/design-probe/p10-let-reuse.bend` | affine binding consumed twice | `type` |
| `?TODO` in an otherwise valid program | unfilled hole | `holes` |

Each asserts the *exact* stage (`test/bend-ast.test.ts:209-224` and `:226`), so a
fixture that started failing earlier — a type error degrading into a parse
error, say — would fail the test rather than quietly still "reject".

The `?TODO` fixture is worth its own line: `bend2/bend.ts:2004-2007` shows only
the upper-case spelling increments `book.hols`; `?todo` is refused earlier, at
`type`. Both were probed and the test uses the spelling that actually reaches
the holes gate, rather than asserting a stage it does not reach.

**What this does not establish — stated explicitly.** *A passing `book_valid` on
a program containing no proof obligations is not evidence of a proof.* The
generated subset declares no `law` blocks, encodes no propositions and discharges
no obligations, so there is nothing for the checker to prove. `book_valid`
returning cleanly here means "well typed and affine-correct", and that is all it
means. Reading it as "proof-carrying code was produced and verified" would be
false.

---

## 4. Semantic correctness — claim 3

**Not claimed.** Nothing generated is executed. `Comp.compile_book`, the C and
CUDA emitters and `Comp.io_run` are never called, no binary is produced and no
output is compared against an expected value. There is no measurement in this
pilot from which a statement about what a generated program *does* could be
drawn, and no test name, report line or commit message asserts one.

`test/bend-ast.test.ts:276` enforces this mechanically: it reads its own file,
extracts every test name, and fails if any contains `correct`, `correctly`,
`works`, `right answer` or `semantic`. It fails the moment someone names a test
`bend programs are correct` on the strength of a `book_valid` pass.

---

## 5. Test results, measured

| Run | Result |
| --- | --- |
| `pnpm run typecheck` | exit **0** |
| `test/bend-ast.test.ts` with `JEV_BEND_PATH` set | 23 tests, **23 pass**, 0 fail, 0 skipped |
| `test/bend-ast.test.ts` with `JEV_BEND_PATH` unset | 23 tests, 14 pass, 0 fail, **9 skipped** |
| `test/bend-ast.test.ts` at `JEV_BEND_FUZZ_ROUNDS=400` | all pass, 32.5 s |
| `pnpm run test` (full suite) with `JEV_BEND_PATH` set | 332 tests, 320 pass, **1 fail**, 11 skipped, exit **1** |

The nine skips without the checker are **unverified, not passed**: they are the
compiler-backed assertions, and the test file labels them
`set JEV_BEND_PATH to a bendlang/bend checkout` rather than reporting green.

### The one failing test

`test/lang-fuzz.test.ts` → `Go: 12 random programs render and pass go`, failing
with:

```
Go validation failed: mise ERROR No version is set for shim: go
Set a global default version with one of the following:
mise use -g go@1.27.1
```

This is **pre-existing and environmental**, not caused by this work:

- The same failure was recorded on this VPS before any change in this branch was
  made (then: 309 tests, 297 pass, 1 fail, 11 skipped). This branch adds 23
  tests and 23 passes — 332 and 320 — and moves nothing else.
- `test/lang-fuzz.test.ts` is unmodified in this branch (`git diff HEAD` touches
  only `src/lang/index.ts`), and it imports `Dialect` values directly
  (`:6-13`), not the adapter registry, so `bendAstAdapter` is not reachable from
  it at all.
- The cause is the host toolchain: `which go` succeeds because mise installs a
  shim, so the test's `has('go')` guard at `:53` returns true and the test does
  not skip; executing the shim then fails because no Go version is pinned.
  Running `mise use -g go@1.27.1` would clear it, which is a change to the
  machine, outside this worktree and outside this task's authorisation.

So `pnpm run test` is **not green**, and the honest statement is: it is green
except for one pre-existing Go-toolchain failure that predates this branch and
that this branch does not touch.

---

## 6. Request counts

**A request count is not a quality result.** It measures how much work the
decision loop asks of a provider, and nothing else. It is reported here in its
own section, separated from §2, §3 and §4, because it is not evidence for any of
them.

Measured by `evidence/request-count.mts` over 40 programs built from a seeded
RNG provider (no model, no paid API spend); recorded in
`evidence/request-count.txt`:

```
programs=40 total_requests=856 min=4 median=19 max=54 mean=21.4
lines min=6 max=15
```

None of those 40 programs was parsed, type checked or executed in that run. The
parse and type claims come from the separate runs in §2 and §3.

---

## 7. Known limits

**Language subset.** No `match`, no recursion, no ADTs, no user `law`
declarations, no proofs, no `Nat`, no lists, no IO beyond `IO.print`. Types are
`U32`, `String`, `Bool` only, and `Bool` has no literal form — it is reachable
only through a call. Probes p5 and p16 show `match` and recursion do type-check
at this pin, so they are reachable later; they are out of this slice by choice,
not by obstacle. The full subset is specified in `evidence/subset-spec.md`.

**Shape.** Helper definitions take copyable (`+`) parameters and return `U32`;
every `do`-block binder is copyable. That is load-bearing, not cosmetic: probes
p4 and p10 show a non-copyable binder consumed twice is refused at `book_valid`.
Bend 2 is affine, not linear — p3 shows an unused parameter is accepted — so the
restriction is about reuse, not about use.

**Depth and budget.** `MAX_DEPTH = 3` (`src/bend-ast.ts:56`) and
`MAX_STEPS_IN_BLOCK = 6` (`:57`). A callee is offered only when every argument it
needs can still be built inside the remaining depth budget; without that the
generator could strand itself with no way to produce a `Bool`.

**No project support.** `generateProject`/`validateProject` are not implemented,
so `src/generation.ts:47` never selects Bend for multi-file work. Single-file
routing is unaffected.

**The checker must be referenced by path.** `validate` needs
`JEV_BEND_PATH` pointing at a `bendlang/bend` checkout. Without it,
`validateBendSource` **fails closed** — generation is refused with the
toolchain-missing message rather than the source being silently accepted, and
`test/bend-ast.test.ts:191` asserts that valid source is rejected in that state.
This follows the existing rust and lua precedent of requiring an external
toolchain. It is **not vendored**, because the licence question is unresolved
(§8).

**Node type-stripping.** The repository runs `.ts` directly under Node's
strip-only mode, which rejects TypeScript parameter properties; `BendCheckError`
therefore declares `readonly stage` as a field and assigns it in the
constructor rather than using the shorthand.

**Compiler back ends untouched.** No change to `bend2/bend.ts` or any upstream
code; the checker is called through its existing exported functions only.

**Not a blocker.** The Bend checker runs here on CPU only, offline, on existing
resources. There is no GPU requirement and no paid resource to report, so
"compiler-backed checks" are satisfied by the real compiler's front end rather
than by a hand-written substitute.

---

## 8. Standing licence constraint

Unchanged and still binding (`01-inspection.md` §2): the licence question is
**unresolved**. Until the captain answers it, this remains a research and local
prototype — no publishing, no package registry action, no redistribution of
upstream source beyond this fork, and no vendoring of upstream code into another
project. That is why the checker is a referenced checkout and not a dependency.

---

## 9. Retrievals that failed during phase 3

None. No network retrieval was attempted in phase 3; every check ran against the
local pinned checkout.

---

## 10. Follow-ups, recorded and not done here

- `generateProject` / `validateProject` for Bend.
- `match`, ADTs, recursion, `law` declarations and proof obligations — which
  would make "typing and proofs" a claim with real content rather than a
  vacuous one.
- Executing generated programs, which is the only route to any semantic-
  correctness claim.
- Any change to `src/lang/core.ts` or the existing language backends.
- Broader Bend adoption, publishing, packaging, the full eval ladder, and
  anything outside this project.
- Resolving the licence question, which gates all of the above.
