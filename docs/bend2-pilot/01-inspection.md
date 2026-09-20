# Bend 2 generation pilot — phase 1: pins, licence, boundaries, Bend 2

Lane: TES-46. Date of record: 2026-09-20. Status: phase 1 (inspection only; no
implementation code was written in this phase).

This document separates **assertions the sources make** from **our synthesis**.
Every assertion carries its source URL, pinned commit, file and line. Retrievals
that failed are recorded as failed, not summarised from memory.

Linked human capture: `Jev-code Bend 2 generation pilot.md` (human wiki folder,
read-only to agents — linked and cited here, never reproduced or edited).

Coordinates with TES-43 (Bend 2 evaluation) and TES-36 (repository planning,
decision ledger, CoderMind/RPG code-scan pilot).

---

## 1. Pinned source revisions

Re-resolved with `git ls-remote` on 2026-09-20 rather than assumed. Commands and
raw output: `evidence/pins.txt`.

| Source | Ref | Resolved SHA | Brief's expected value | Drift |
| --- | --- | --- | --- | --- |
| this clone | `HEAD` | `a7585c9fde77357afcc3bf3188bfe1105ae4ef92` | same | none |
| `twilwa/jev-code` (fork) | `refs/heads/main` | `a7585c9fde77357afcc3bf3188bfe1105ae4ef92` | same | none |
| `rhighs/jev-code` (upstream) | `refs/heads/main` | `a7585c9fde77357afcc3bf3188bfe1105ae4ef92` | same | none |
| `bendlang/bend` | `refs/heads/main` | `7561656155a4285c1e4ccfcb3505ab59524de973` | same | none |

**No drift from the values stated in the brief.** Fork and upstream `main` were
identical at the moment of resolution, so the fork carries no divergent commits.

All Bend assertions below are read from `bendlang/bend` at
`7561656155a4285c1e4ccfcb3505ab59524de973` only. The older `HigherOrderCO/Bend`
is a different language; none of its documentation is used or substituted here.

---

## 2. Licence — unresolved

### Assertions (what the tree actually contains)

- There is no `LICENSE`, `COPYING`, `NOTICE` or `COPYRIGHT` file anywhere in the
  repository. A filename search across the whole tree returned nothing:
  `find . -iname '*licen[cs]e*' -o -iname '*copying*' -o -iname '*notice*' -o -iname '*copyright*'`
  → empty. Raw output: `evidence/licence-scan.txt`.
- `package.json` has **no** `license` field. It carries `"private": true`
  (`package.json:4`) and `"name": "jev-code"`, `"version": "0.2.0"`.
- A content grep over every tracked file for `copyright`, `licence`/`license`,
  `SPDX`, `MIT`, `Apache-2`, `GPL`, `BSD`, `all rights reserved` returned
  **exactly one** text hit in 130 tracked files:
  - `docs/brainstorms/2026-09-19-typed-decision-program-sdk-requirements.md:112`
    — "Actual npm publication pending owner-controlled package naming and license
    decisions."
  - `git grep` additionally reported `docs/media/session.gif` as a "Binary file
    matches". That is a byte-sequence coincidence in a GIF, not a notice; it is
    recorded here so the raw evidence and this summary agree.
- `README.md` contains no licence or copyright section (verified head and tail;
  the document ends with a `SEE ALSO` section at `README.md`).
- GitHub API licence metadata for the repository is null (stated in the TES-46
  filing; not independently re-fetched in this phase — see failed retrievals).

### Synthesis

The licence is **unresolved**. The single notice found is upstream's own record
that the licence decision has not been made. `"private": true` is an npm publish
guard, not a licence grant, and nothing is inferred from it. Nothing is inferred
from the licences of dependencies. No licence file was added.

**Operating constraint until the captain resolves this**: this work is research
and local prototype only. No publishing, no package registry action, no
redistribution of upstream source beyond this fork, and no vendoring of upstream
code into another project. Release and commercial permission must be cleared
before any distribution.

Separately and not to be conflated: `bendlang/bend` **is** licensed. Its
repository root carries an Apache License 2.0 at `LICENSE:1-13` (pinned commit
`7561656155a4285c1e4ccfcb3505ab59524de973`). That covers Bend, not jev-code, and
grants nothing with respect to this repository.

---

## 3. Boundary map

All citations are `path:line` at `a7585c9fde77357afcc3bf3188bfe1105ae4ef92`.

### 3.1 Adapter boundary — `src/ast-adapters.ts`

- `AstAdapter` interface: `src/ast-adapters.ts:12-22`. Required members are
  `id`, `extensions`, `languages`, `generate(decisions, state, field, options)`
  and `validate(source, signal)`. The comment at `src/ast-adapters.ts:17` states
  the contract directly: *"Reject invalid source; validation is mandatory before
  a write."*
- Optional multi-file contract: `generateProject` (`:20`) and `validateProject`
  (`:21`). `generateProject` returns "a JSON manifest of path to source, for the
  `write_files` tool" (`:19`); `validateProject` takes the parsed
  `Record<string, string>`.
- `AstRegistry` class: `src/ast-adapters.ts:28-60`. Registration rules in
  `register()` (`:31-42`):
  - id must match `/^[a-z][a-z0-9-]{0,63}$/` (`:32`);
  - ids are globally unique — duplicate id throws (`:33`);
  - extensions must be a non-empty array matching `/^\.[a-z0-9]+$/` (`:34`);
  - languages must be a non-empty array matching `/^[a-z][a-z0-9-]*$/` (`:35`);
  - `generate` and `validate` must both be functions (`:36`);
  - **extensions and languages must not collide with any already-registered
    adapter** (`:37-40`) — this is the cross-adapter uniqueness rule, and it is
    the constraint a new Bend adapter must satisfy.
  - the stored adapter is a defensive copy (`:41`).
- Constructor (`:30`) always registers `pythonAstAdapter` first, then the
  bundled language adapters when `bundled` is true, then caller-supplied ones.
- `resolve(state)` (`:45-59`) picks an adapter by file extension from
  `argumentsSoFar.path` when present, otherwise by last-mentioned language name
  or extension in the task prompt.
- Installation extension points: `loadAstModule` (`:71-83`) accepts a
  `builtin:<id>` specifier resolved against `bundledAstAdapters()` (`:72-77`) or
  an external module that must export a non-empty `astAdapters` array (`:81`).
  Installed adapters are persisted to `.jev/asts.json` (`:62-70`, `:94-100`),
  capped at 64 (`:109`).

### 3.2 Grammar / language-backend boundary — `src/lang/`, `src/python-*.ts`

- `src/lang/index.ts:9` — `bundledAstAdapters()` returns the fixed list
  `[javascript, typescript, c, rust, go, lua, ruby]`. **This single line is the
  registration point for a new bundled backend.**
- `src/lang/core.ts` is a shared, language-neutral typed IR plus a generic
  grammar-driven generator:
  - IR types: `Expr` (`src/lang/core.ts:14-24`, 10 node kinds including `hole`),
    `Stmt` (`:26-38`, 12 node kinds), `Program` (`:40`), `ValueType` (`:10`),
    `BinOp` (`:11`), `CmpOp` (`:12`).
  - `Dialect` interface: `:48-60` — `id`, `extensions`, `languages`, `name`,
    `keywords`, `builtins`, `features`, `typed`, `render(program)`,
    `validate(source, signal)`.
  - `Features` flags: `:46` — `functions`, `while`, `range`, `foreach`, `list`,
    `index`, `compareStrings`, `concat`. A backend switches productions off by
    setting these false.
  - `generateProgram(dialect, …)`: `:107-364` — the shared decision loop. It
    offers Jev only the productions the dialect's `features` and scope permit
    (`:249-358` for statements, `:176-247` for expressions).
  - `adapterFor(dialect)`: `:366-370` — **converts a `Dialect` into an
    `AstAdapter`**. This is the intended extension point: a new language is a
    `Dialect` value, not a new adapter implementation.
  - Bounds: `maxBlockStatements = 16` (`:65`), `maxDepth = 6` (`:66`).
- Worked backend examples: `src/lang/rust.ts` (82 lines; `rustDialect` at
  `:77-80`, `rustAstAdapter = adapterFor(rustDialect)` at `:82`),
  `src/lang/lua.ts` (90 lines; `:85-90`), plus `c.ts`, `go.ts`, `javascript.ts`,
  `ruby.ts`.
- Each backend's `validate` shells out to a **real external compiler**:
  - `src/lang/rust.ts:54-73` spawns `rustc --edition 2021 --crate-type bin
    --emit=metadata`, 30 s timeout, and at `:62` raises *"Rust validation needs
    rustc on PATH."* when the binary is absent (`ENOENT`).
  - `src/lang/lua.ts:76-81` tries `luac -p -` then `lua -e assert(load(...))`,
    and at `:80` raises *"Lua validation needs luac or lua on PATH."* when
    neither is present.
  This is the established idiom: **a missing toolchain is a hard validation
  error, never a fallback to a hand-written checker.**
- The Python backend is separate and older: `src/python-ast.ts` (507 lines),
  `src/python-units.ts` (118), `src/python-search.ts` (40). It is the only
  adapter implementing the multi-file `generateProject`/`validateProject` pair
  (`src/ast-adapters.ts:23-26`).

### 3.3 Provider boundary — `src/provider.ts`, `src/decide.ts`, `src/generation.ts`, `src/decisions.ts`, `src/sdk/`

- `src/provider.ts:4-10` — `JevProvider implements DecisionProvider`, a thin
  wrapper over `TypeSafeClient.systemOne` with a 30 s timeout (`:5`). This is
  the only place the network provider is constructed.
- `src/decisions.ts:40-136` — `Decisions`, the internal facade over the public
  SDK session. It owns the request budget (`requests` `:41`, `exhausted` `:42`,
  `assertRequestBudget` `:75-84`), cancellation (`signal` `:44`), usage
  accounting (`:43`), and the decision-event observer (`:86-101`). Question
  kinds exposed: `choose` (`:103`), `probability` (`:108`), `score` (`:113`),
  `chooseMany` (`:119`).
- `src/generation.ts:43-80` — `generateText`, the dispatcher that routes a field
  to a backend. Ordering matters:
  - `field === 'command'` → bash AST (`:44`);
  - `field === 'files'` + `write_files` → the project path (`:45-58`);
  - `field === 'content'` → `registry.resolve(state)`; if an adapter matches,
    the AST path runs (`:59-70`);
  - otherwise text planning / structured text / experimental grid (`:71-79`).
- `src/sdk/` is the public surface: `decisions.ts` (321), `program.ts` (569),
  `resources.ts` (327), `router.ts` (68), `tree.ts` (329), `types.ts` (160),
  `validation.ts` (23). `src/sdk/tree.ts` carries an independent bounded-grammar
  facility (`validateGrammar` `:132`, `TreeValidator` `:44`) distinct from
  `src/lang/core.ts`.

### 3.4 Validator boundary — where validation is actually enforced before a write

This is the boundary with the largest gap between the stated contract and the
enforced behaviour, and it matters directly for a Bend adapter.

**Enforced on the generation path:**
- `src/generation.ts:66` — `await adapter.validate(source, decisions.signal)`.
  This runs after generation and after the byte/size check at `:65`, and before
  the value is returned to the tool layer. A throw here aborts the field.
- `src/generation.ts:54` — `await adapter.validateProject!(parseManifest(manifest), decisions.signal)`
  for the multi-file path, with the size check at `:53`.
- `src/generation.ts:73` — `syntaxFeedback(...)` gates the non-AST text plan;
  `syntaxFeedback` itself (`:34-41`) only handles `.js/.ts/.jsx/.tsx` via
  `ts.transpileModule` and returns `[]` for every other extension.

**Not enforced at the tool layer:**
- `src/tools.ts:197-209` — the `write_file` tool calls `atomicWrite` at `:206`
  with **no** language validation of any kind. There is no adapter lookup in
  this path.
- `src/tools.ts:210-229` — the `write_files` tool hardcodes
  `await validatePythonProject(files, context.signal)` at `:224`, imported at
  `src/tools.ts:7`. The generic multi-file write tool is wired directly to the
  Python validator; its own description (`:211`) says "Write a multi-module
  Python project".
- `src/tools.ts:230-249` — `edit_file` calls `atomicWrite` at `:246` with no
  validation.

**Registry wiring into the harness:**
- `src/harness.ts:54` constructs the `AstRegistry` from `options.astAdapters`
  and `options.bundledAsts ?? true`.
- `src/harness.ts:88-91` — `registerAst(adapter)` allows host registration
  between runs.
- `src/harness.ts:232` passes `astRegistry: this.astRegistry` into the
  generation options, which is how `generateText` reaches the adapter.

#### Synthesis

The comment at `src/ast-adapters.ts:17` — "validation is mandatory before a
write" — is accurate **only for source that Jev generates through
`generateText`**. It is not a property of the write tools. A host that calls
`builtInTools()` directly, or a Jev run that reaches `write_file` with content
produced by any non-AST path, writes unvalidated bytes. `write_files` is worse
than unvalidated: it applies the *Python* validator to whatever it is given.

For this pilot that means: a Bend adapter's `validate` **will** be called on the
`content` field when the registry resolves to it, so real compiler validation is
reachable without touching the tool layer. It also means a Bend adapter must not
rely on the `write_files` path, because that path is Python-specific and fixing
it is out of scope here (recorded as a follow-up).

---

## 4. Bend 2 — parser, compiler, and whether it can run here

All assertions from `bendlang/bend` at `7561656155a4285c1e4ccfcb3505ab59524de973`.
Source: https://github.com/bendlang/bend

### 4.1 What the repository contains

- `bend2/` holds the implementation: `bend.ts` (128.9 KB), `comp.ts`
  (183.8 KB), `main.ts` (23.8 KB), `base.bend` (62.8 KB), `bend.lean`
  (962.8 KB), plus `docs/`, `effs/`, `pack/`.
- **The Bend 2 parser and compiler are written in TypeScript.** This is the
  single most consequential finding for this pilot: jev-code is a TypeScript
  project, so the checker is reachable as a library, not only as a subprocess.
- Version string: `main.ts:31` — `const VERSION = "2.0.20"`.
- CLI usage, `main.ts:33-38`:
  - `bend <file.bend> [args]` — check the file, then run `main`
  - `bend <file.bend> -o <out>` — build a binary; `<out>.c` emits C, `<out>.js` JS
  - `bend <file.bend> --check-only` — **check the file and its imports; run nothing**
  - `bend <file.bend> --publish` — publish to the hub

### 4.2 Programmatic API — the real entry points

The CLI's own check pipeline is `book_read` at `main.ts:577-596`. It is four
steps, and they are genuinely separate:

1. `Bend.book_nil()` (`bend.ts:966`) — empty `Book`.
2. `await Bend.book_load(book, file, "", seen)` (`bend.ts:1013`) — **parse** the
   file and transitively load its imports.
3. `Bend.book_valid(book, done)` (`bend.ts:3773`) — **type-check**. Internally
   calls `term_check(...)` per top-level declaration (`bend.ts:3798`).
4. `Comp.book_owned(book, Comp.SYNTH)` (`comp.ts:2866`, `SYNTH` at
   `comp.ts:2863`) — **linearity / ownership** check.
5. `main.ts:591-595` then rejects any remaining holes:
   `book.hols + book.open > 0` → *"N TODOs found. The code is incomplete, and
   not a valid proof yet."*

Key types: `Book` (`bend.ts:311`), `TLD = ADT | Def` (`bend.ts:310`),
`Def` (`bend.ts:309`), `HTerm` (`bend.ts:300`), `Span` (used in every error).

Compiler back ends, for completeness: `Comp.js_book(book)` (JS emission,
`main.ts:295`), `Comp.compile_book(book)` (C emission, `main.ts:297`),
`Comp.io_run(book, argv)` (`main.ts:625`).

### 4.3 Toolchain requirements — measured, not assumed

`main.ts:1` is `#!/usr/bin/env bun`, and `main.ts:22` imports
`type { BunPlugin } from "bun"`. Taken at face value that reads as a hard Bun
dependency. It is not, for the checking path:

| File | `Bun.*` runtime API uses | Non-`node:` imports |
| --- | --- | --- |
| `bend2/bend.ts` | **0** | none (`node:fs`, `node:os`, `node:path`, `node:url` only — `bend.ts:234-237`) |
| `bend2/comp.ts` | **0** | none (`node:fs` at `comp.ts:5`, `./bend.ts` at `comp.ts:7`) |
| `bend2/main.ts` | 4 | `bun` (type-only import) |

The parser, type checker and ownership checker have **zero** Bun runtime
dependency. Only the CLI wrapper does.

### 4.4 Can it be obtained and run offline on this CPU-only VPS? — Yes. Measured.

Probe script and raw output: `evidence/bend-probe/`. Environment: Node v24.21.0,
Linux x86_64, no Bun installed, no GPU, no network access used during the check
itself, no API key, zero paid resources.

Driving `book_load` → `book_valid` → `book_owned` directly from a Node ESM
module (Node's built-in TypeScript type-stripping resolves the `.ts` imports):

```
$ node check.mjs ok.bend          # import Base / law main: U32 / def main(): 0
PARSE+LOAD ok, n0 = 479
TYPECHECK ok
OWNERSHIP ok
hols = 0 open = 0

real    0m0.365s
```

**A full parse + type-check + ownership check of a Bend 2 program, including the
479 declarations of `base.bend`, completes in 0.37 s on Node 24 with no Bun, no
GPU and no paid resources.**

Therefore: **"compiler-backed checks" are satisfiable for this pilot.** There is
no blocker here, and no hand-written substitute checker is needed or permitted.

Caveats, stated rather than glossed:
- This exercises the **checking** path only. Binary/GPU code generation
  (`Comp.compile_book`, the C and CUDA back ends) was **not** attempted and is
  not claimed to work here. The pilot needs only checking.
- Node's `.ts` import support is used without a build step. If that proves
  fragile, vendoring is not an option under the unresolved-licence constraint
  (§2); the fallback is a pinned local clone referenced by path, which is what
  the probe already does.

### 4.5 The three stages are separately observable — measured

This is the evidence for keeping **parse validity**, **typing and proofs**, and
**semantic correctness** as three distinct claims.

| Probe | Program | `book_load` | `book_valid` | Interpretation |
| --- | --- | --- | --- | --- |
| A | `def main(: 0` (syntax error) | **fails** — `expected: 'a name', observed: "':'"` | not reached | parse invalid |
| B | `law main: U32` / `def main(): "hello"` | **passes** (n0 = 479) | **fails** — type mismatch | parses, does not type |
| C | `law main: U32` / `def main(): 0` | passes | passes | parses and types |

Probe B is the important one: **a program that parses cleanly can still fail the
type checker.** Parse success is not typing success.

And neither is semantic correctness. Bend errors are thrown as structured
objects carrying `exp` (expected), `obs` (observed) and `spn` (source span), so
the stage that rejected a program is machine-distinguishable — the adapter can
report which of the three claims failed rather than collapsing them.

Upstream jev-code already states the same distinction for Python, at
`docs/guide.md:96`: *"Compilation checks syntax and control-flow legality; it
does not prove runtime behavior or task correctness."* That sentence is the
standard this pilot holds itself to for Bend.

### 4.6 Bend 2 surface syntax, as read from pinned test fixtures

From `tests/check/*.bend` at the pinned commit (e.g.
`tests/check/alpha_equivalence.bend`, `tests/check/array_boxed_default.bend`):

- `import Base` pulls in the 479-declaration prelude; `U32`, `Nat`, `IO` and
  friends are undefined without it (measured: omitting it fails with
  `expected: 'a defined name'`).
- A top-level definition is a `law <name>:` block giving the type, followed by
  `def <name>(params): <body>`. `for x: T` lines in a `law` bind parameters.
- `type N is Data:` introduces an ADT with `Ctor{field: T}` constructors.
- `match x: case C{a, b}: …` is the eliminator.
- Fixtures embed their expected output as trailing `#|` comment lines, including
  full error text and `#|exit 1` for rejection cases.

---

## 5. Retrievals that failed or were not attempted

Recorded as failed rather than summarised from memory.

- **GitHub licence metadata for `twilwa/jev-code` and `rhighs/jev-code`: not
  re-fetched in this phase.** The null-licence claim is carried from the TES-46
  filing. It is corroborated but not proven by the local tree scan in §2, which
  independently shows no licence file and no `license` field. Treat the API
  value as unverified-in-this-lane.
- **Bend binary / GPU back end: not attempted.** No `bend` binary was installed
  and no Bun runtime was installed. `Comp.compile_book` (C emission) and the GPU
  path were not exercised. No claim is made about them.
- **`bend2/bend.lean` (962.8 KB): not read.** The Lean development was not
  inspected; no claim is made about what it proves.
- **Upstream jev-code eval ladder: not re-run.** All eval numbers in §6 are read
  from the committed `docs/guide.md` at the pinned commit, not reproduced.

---

## 6. Upstream capability prior — what the evidence actually supports

### Assertions

From `docs/guide.md` at `a7585c9fde77357afcc3bf3188bfe1105ae4ef92`:

- `docs/guide.md:249` — a live run on 2026-09-17 with the objective "Create a
  simple Python hello world. Run it with python3 to verify it." completed in
  3 turns and 16 requests. The same line states: *"These are narrow smoke tests,
  not a general coding benchmark."*
- `docs/guide.md:268-280` — the eval results table, 2026-09-18, one run per task.
  Every row of every listed grammar-only baseline is `fail` across
  `guessing-game`, `file-io-script` and `multi-file-package`. Worst cases:
  2000 requests / 11 min 24 s (`guessing-game`, `87849a1`), 3000 requests /
  13 min 23 s (`file-io-script`, `3925414`), 3294 requests / 18 min 34 s
  (`multi-file-package`, `1f7f88c`).
- `docs/guide.md:282` — *"In those grammar-only baseline runs, no task passed."*
  The same line attributes remaining failures to "decision quality" and gives
  concrete defects: `randint(range(1 + 100, 100), 100)`,
  `print('Too low', None)`. It also records that `--search-width 3` "spends the
  same request budget in a third of the turns without a better program, so the
  request budget, not candidate count, is the binding limit."
- `docs/guide.md:98` — the Python grammar is explicitly "a bounded subset";
  "the harness accepts arbitrary objectives, but this grammar and model do not
  yet solve arbitrary coding tasks."

### Synthesis

This is **not** a demonstrated efficient general coding agent, and nothing in
this pilot may be written as if it were. The honest prior is: narrow, bounded
subsets with a real compiler in the loop can produce small correct programs;
every non-trivial task on the recorded ladder failed, several after thousands of
requests.

Two consequences for phase 3:
1. The Bend subset must be **deliberately tiny**. Matching upstream's Python
   grammar in scope would be scoping to a documented failure.
2. **Request counts are a cost measure, never a quality result.** A run that
   spends 2000 requests and fails is a failure that cost 2000 requests. These
   must be reported on separate lines with separate labels.

---

## 7. Phase 1 conclusion

- Pins verified, no drift (§1).
- Licence unresolved; research-and-local-prototype constraint in force (§2).
- Four boundaries mapped with line citations; the real validation enforcement
  point is `src/generation.ts:66`, and `adapterFor` in `src/lang/core.ts:366` is
  the intended extension point (§3).
- Bend 2's checker runs offline, CPU-only, on Node 24, in 0.37 s, with no Bun
  and no GPU. **Compiler-backed validation is available; no blocker** (§4).
- Parse / typing / semantic correctness are separately observable in the real
  toolchain, so the three-claim separation is enforceable, not aspirational (§4.5).
- The upstream capability prior is weak and must not be overstated (§6).
- The repository planning graph is the second half of phase 1 and is written up
  separately in `02-graph.md`, with its artefacts under `evidence/graph/`. That
  document also carries the answer to TES-36's deduplication question.

The design choice between a native Bend AST, a typed IR and a bounded grammar is
deliberately **not** made in this document. It belongs to phase 2, after the
graph, and is recorded in `03-tickets.md` with the evidence that decided it.
