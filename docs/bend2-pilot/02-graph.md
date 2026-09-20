# Bend 2 generation pilot — phase 1 (part 2): the repository planning graph

Lane: TES-46. Date of record: 2026-09-20. Status: phase 1 (inspection and graph
only; no implementation code was written in this phase).

Companion to `01-inspection.md`, which carries the pins, the licence finding, the
boundary map and the Bend 2 toolchain measurements. This document covers only the
graph: how it was produced, what it actually contains, where it is weak, and the
answer to TES-36's deduplication question.

Same convention as `01-inspection.md`: **assertions the tool made** are kept
separate from **our synthesis**. Every number below is reproducible from the
committed artefacts by the committed scripts.

Linked human capture: `Jev-code Bend 2 generation pilot.md` (human wiki folder,
read-only to agents — linked and cited, never reproduced or edited).

---

## 1. How the graph was produced

### Assertions

Exact command, run from the worktree root:

```
cmind script rpg_encoder/run_encode.py --json --repo-dir . --repo-name jev-code
```

| | |
| --- | --- |
| `cmind-cli` version | `0.1.9` (`/home/firstmate/.local/bin/cmind`) |
| encoder entry point | `cmind_cli/core_pack/scripts/rpg_encoder/run_encode.py` |
| interpreter | CPython 3.12.3 (the `cmind-cli` tool venv) |
| repository under analysis | this worktree at `a7585c9fde77357afcc3bf3188bfe1105ae4ef92` |
| started / finished | 2026-09-20T12:49:07.931322 → 2026-09-20T13:02:44.380633 |
| wall clock | 13m 36s |
| exit status | 0; final JSON `"status": "success"` |

Encoder parameters, as the tool logged them at `evidence/graph/encode-run.log:4`:

```
repo_info_iters=3, exclude_votes=1, parse_iters=5, min_batch=10000,
max_batch=50000, class_ctx=10, func_ctx=10, workers=1,
refactor_ctx=10, refactor_iters=5
```

The encoder's LLM calls were routed through `common/llm_client.py`, which shells
out to the `claude` CLI (`.cmind/config.toml` → `ai_cli_cmd = "claude"`). That is
the subscription path. The keyed, paid path is a different module,
`common/llm_api_client.py`, and it was not used; no `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` was present in the environment. **No new paid API spend was
incurred by this encode.**

`cmind init` wrote two files into the worktree as part of setting the workspace
up: the `.gitignore` block marked "CoderMind ignores (managed by `cmind init/update`)"
and `.cmind/config.toml` (which the tool itself annotates "Safe to commit"). Both
are committed. `cmind init` also wrote `.claude/settings.json`, a local
`SessionStart` hook that prints RPG status; that is local tooling rather than part
of this deliverable and is deliberately **not** committed.

### Committed artefacts

All under `evidence/graph/`, copied verbatim from the tool's output directories:

| File | sha256 | Origin |
| --- | --- | --- |
| `rpg.json` | `4915e90b764a38dc03952b389c420bc449cfba566215e82b612692f6ff48cf36` | `<workspace>/data/rpg.json` |
| `rpg.html` | `616ace13e730acba729af5e21e624c89334dd1812ec7605938b22ccade9e1685` | `.cmind/reports/rpg.html` (tool-generated visualisation) |
| `encode-trajectory-20260920-124907.json` | `4f03f4c39343fa73c19f7ffce07cc1977eb40154f63092c87a33de8ed6e89ee7` | `<workspace>/data/trajectory/` |
| `encode-run.log` | `cd0e0b472766ecf72acab431e7d5f9d21905a1c490dee86b7c5935c7fe2bf971` | stdout of the command above |
| `encode-run.stderr.txt` | (empty) | stderr of the command above |

`<workspace>` is
`~/.cmind/workspaces/home-firstmate-treehouse-jev-code-22114f-1-jev-code`.

The graph is tool-generated. Nothing in `rpg.json` was hand-drawn, hand-edited or
hand-extended; the analysis scripts in `evidence/graph/` only read it.

---

## 2. What the graph contains

### Assertions

Reproduce with:

```
python3 docs/bend2-pilot/evidence/graph/graph-summary.py \
        docs/bend2-pilot/evidence/graph/rpg.json
```

Full output: `evidence/graph/graph-summary.txt` (1149 lines).

| Quantity | Value |
| --- | --- |
| RPG nodes | 649 |
| RPG edges | 724 |
| dependency-graph nodes | 752 |
| dependency-graph edges | 1310 |
| dependency nodes mapped onto RPG nodes | 385 |
| functional areas | 7 |

Node types: 520 `feature`, 52 `feature_group`, 35 `subcategory`, 34 `category`,
7 `functional_area`, 1 `repo`. The tree is five levels deep below the repo node.

The seven functional areas the encoder settled on, with subtree sizes:

| Functional area | Node id | nodes | features |
| --- | --- | --- | --- |
| DecisionSdk | `DecisionSdk_ccc6004a` | 94 | 76 |
| ModelDecisionGateway | `ModelDecisionGateway_c8ab7e67` | 36 | 29 |
| CodeSynthesis | `CodeSynthesis_ae656d47` | 242 | 208 |
| AgentOrchestration | `AgentOrchestration_926c7a01` | 84 | 68 |
| SessionPresentation | `SessionPresentation_5eacc869` | 131 | 92 |
| CommandLineInterface | `CommandLineInterface_5d1c1070` | 46 | 36 |
| EvaluationHarness | `EvaluationHarness_0a0a58d8` | 15 | 11 |

Every one of the 520 feature nodes carries a `meta.path` of the form
`<file>::<symbol>` or `<file>::<Class>::<method>`, covering 54 distinct source
files.

The encoder excluded six paths from analysis, recorded in `rpg.json`
(`excluded_files`): `docs`, `eval`, `examples`, `examples/dependency-tree.ts`,
`examples/router.ts`, `test`.

### Synthesis

The area decomposition is usable for this pilot. `CodeSynthesis` is the largest
area and is exactly where a Bend backend would live: it contains both the
adapter-registry subtree and the per-dialect render/validate subtrees. The
adapter, grammar and validator boundaries from `01-inspection.md` §3 land in
distinct, named places in the tree rather than being smeared across it.

The exclusion of `test` and `eval` matters for phase 2. Acceptance checks for the
tickets will have to name test files that have **no corresponding graph node**,
because the encoder never parsed them. A ticket may be *derived* from a graph
node while its acceptance check points at an unparsed test path; that is a
property of the graph's scope, not a licence to derive tickets from our own
reading of the code.

---

## 3. Where the four boundaries land in the graph

### Assertions

Extracted by `graph-summary.py`; full listing with descriptions in
`evidence/graph/graph-summary.txt` under "feature nodes on the boundaries named
by the brief". Feature-node counts per boundary file:

| Boundary (from `01-inspection.md` §3) | File | Feature nodes |
| --- | --- | --- |
| adapter | `src/ast-adapters.ts` | 27 |
| grammar / language backend | `src/lang/core.ts` | 13 |
| grammar / language backend | `src/lang/index.ts` | 1 |
| grammar / language backend | `src/lang/rust.ts` | 16 |
| grammar / language backend | `src/lang/lua.ts` | 19 |
| grammar / language backend | `src/lang/c.ts` | 22 |
| grammar / language backend | `src/lang/go.ts` | 19 |
| grammar / language backend | `src/lang/ruby.ts` | 18 |
| grammar / language backend (Python) | `src/python-ast.ts` | 23 |
| provider | `src/provider.ts` | 2 |
| provider | `src/decisions.ts` | 14 |
| provider | `src/generation.ts` | 8 |
| validator | `src/tools.ts` | 16 |
| validator | `src/harness.ts` | 33 |

The nodes a Bend backend would have to attach to, quoted with the tool's own ids
and its own one-line descriptions:

| Node id | `meta.path` | Tool's own description, quoted verbatim |
| --- | --- | --- |
| `expose dialect as language adapter_63ac8363` | `src/lang/core.ts::adapterFor` | Wraps a language definition so the rest of the system can generate and validate that language uniformly. |
| `build program through bounded decisions_c05d6bfd` | `src/lang/core.ts::generateProgram` | Constructs a complete program for an objective by choosing each construct from a legal set rather than emitting text. |
| `list built in language adapters_1a088811` | `src/lang/index.ts::bundledAstAdapters` | Provides the language adapters that ship with the tool so they are available without installation. |
| `validate adapter identity_9c4922f3` | `src/ast-adapters.ts::AstRegistry::register` | Rejects adapters lacking a well-formed identifier so registry keys stay predictable. |
| `reject conflicting extension or language claims_4fa737a4` | `src/ast-adapters.ts::AstRegistry::register` | Blocks adapters that would make file extension or language routing ambiguous. |
| `select adapter by target file extension_15e151d1` | `src/ast-adapters.ts::AstRegistry::resolve` | Picks the language adapter matching the file being written when a target path is known. |
| `resolve adapter module from specifier_b9f3417b` | `src/ast-adapters.ts::loadAstModule` | Locates an adapter implementation from a builtin name, workspace path, or installed package identifier. |
| `verify generated source is well formed_36724074` | `src/lang/rust.ts::validate` | Confirms that generated source parses and type checks before it is accepted or written. |
| `report missing language toolchain clearly_0f76ad5c` | `src/lang/rust.ts::validate` | Explains which tool must be installed when the required checker is unavailable. |
| `enforce validity of generated content_1e0a7e01` | `src/generation.ts::generateText` | Requires generated source to pass its language check and to stay within size limits before it is accepted. |
| `route generation to language builder_fb270475` | `src/generation.ts::generateText` | Selects the grammar directed builder matching the target language or command rather than decoding raw characters. |
| `replace file contents indivisibly_6b0757a2` | `src/tools.ts::atomicWrite` | Writes new file contents so readers never observe a partially written file. |

The single edge that describes the dialect extension point:

```
expose dialect as language adapter_63ac8363
  --invokes--> build program through bounded decisions_c05d6bfd
  meta.content = "src_dep=src/lang/core.ts:adapterFor,
                  dst_dep=src/lang/core.ts:generateProgram"
  meta.generator = "dep_graph"
```

### Synthesis

The graph independently reproduces the structural claim `01-inspection.md` §3.2
made from reading the source: `adapterFor` is the seam, and it reaches the shared
decision loop rather than any per-language code. It also independently separates
"render source" from "verify with toolchain" inside each dialect's subtree —
`src/lang/rust.ts::validate` is described by the tool as two distinct features,
*verify generated source is well formed* and *report missing language toolchain
clearly*. That matches the idiom `01-inspection.md` §3.2 recorded from `rust.ts`
and `lua.ts`: a missing toolchain is a hard validation error, never a silent
fallback.

Note what this does **not** establish. These are model-authored descriptions of
existing code. They are evidence about how the repository decomposes; they are
not evidence that any described behaviour is correct.

Two of those descriptions must not be inherited as written, and they show the
limit of the feature layer concretely.

The tool gives **all six** dialect `validate` nodes — `c.ts`, `go.ts`,
`javascript.ts`, `lua.ts`, `ruby.ts`, `rust.ts` — the identical sentence
"Confirms that generated source parses **and type checks** before it is accepted
or written." That is boilerplate, and it fuses two of the three claims this lane
is required to keep apart. It happens to be true of `rust.ts:54-73`, which runs
`rustc --edition 2021 --crate-type bin --emit=metadata`. It is false of
`lua.ts:76-81`, where `luac -p` only parses.

The `javascript.ts` node is wrong twice over. The graph gives it both
"Confirms that generated source parses and type checks" and a sibling feature
"report missing language toolchain clearly". `src/lang/javascript.ts:60-64`
validates in-process with `ts.transpileModule(..., reportDiagnostics: true)`:
there is no external toolchain to be missing, and `transpileModule` reports
syntactic diagnostics rather than type errors.

So the graph's vocabulary cannot carry the parse / typing / semantics
distinction, and in places it asserts behaviour the code does not have. That
distinction has to come from `01-inspection.md` §4.5 and from test and commit
wording in phase 3, never from a node description.

---

## 4. Known weaknesses in this graph

### Assertions

Measured from the committed `rpg.json`:

- All 724 RPG edges have `relation = "invokes"` and `meta.generator = "dep_graph"`.
  There is no other relation type in the artefact.
- **All 724 RPG edges are same-file. Zero are cross-file.**
- 365 of 520 feature nodes have at least one edge; **155 are isolated** (degree 0).
  Isolated nodes include `list built in language adapters_1a088811`
  (`src/lang/index.ts::bundledAstAdapters`), every
  `src/ast-adapters.ts::AstRegistry::register` feature, and both
  `src/lang/rust.ts::validate` features.
- In the underlying dependency graph, edge types are 751 `contains`, 305
  `imports`, 254 `invokes`.
- There are 311 import nodes. **305 carry `resolved: false`,
  `confidence: "unresolved"`, `heuristic: true`; the remaining 6 carry no
  resolution field at all. Zero are resolved.**
- Restricting to intra-repository relative imports: **219 such import nodes, 0
  resolved.**

### Synthesis

The graph's *feature layer* is dense and useful; its *structural layer* is thin.
Because no import was resolved, no call or dependency edge crosses a module
boundary, so the graph cannot answer questions of the form "what else would break
if this changed". Concretely, it does not contain an edge from
`src/lang/index.ts::bundledAstAdapters` to the individual dialect modules it
lists, even though that edge exists in the source (`01-inspection.md` §3.2).

For phase 2 this is a scoping constraint rather than a blocker: tickets are
derived from graph *nodes*, which are sound, and the two edges we rely on
(`adapterFor → generateProgram`, and the containment hierarchy) are present. Any
ticket that would need cross-module reachability must say so and cite file and
line from `01-inspection.md` for that part, rather than implying the graph
supplied it.

This unresolved-import behaviour is a second, distinct defect class from the one
TES-36 recorded. It is reported here as a finding about the tool, not fixed —
changing CoderMind is outside this task's scope.

---

## 5. TES-36's line-overlap deduplication defect — does it affect this graph?

**Answer: no, it does not affect this graph artefact. It would affect other
CoderMind stages run against this repository, and we measured that it does.**

### Assertions — the mechanism (installed `cmind-cli` 0.1.9 sources)

Traced in `evidence/dedup-defect-check.txt`:

- `scripts/lang_parser/extractors/fallback.py:184` sets each unit's `code` to the
  literal source slice of its own line range.
- `scripts/lang_parser/_ecmascript_parser.py:240-265` emits method units whose
  line ranges lie strictly inside their enclosing class unit's range.
- `scripts/common/code_dedup.py:24-31` deduplicates on exact whitespace-stripped
  string equality (`key = code.strip()`). A method slice is never byte-equal to
  the class slice containing it, so both survive and the method body appears
  twice.

### Assertions — it does not reach this artefact

Reproduce with:

```
python3 docs/bend2-pilot/evidence/graph/dedup-reachability.py \
        <cmind-cli>/core_pack/scripts \
        docs/bend2-pilot/evidence/graph/rpg.json
```

Full output: `evidence/graph/dedup-defect-graph-check.txt`.

1. **Static reachability.** The import closure of the encode entry point
   `rpg_encoder/run_encode.py` is 12 modules. **None** of them references
   `common.code_dedup`. Across the whole installed script tree there are exactly
   two importers, and neither is in the encode path:
   - `scripts/plan_tasks.py:25`
   - `scripts/func_design/interfaces_store.py:20`
2. **The artefact stores no source text.** Of 649 RPG nodes, **0** have a
   non-empty `meta.content`. Of 752 dependency-graph nodes, **0** carry a `code`
   field; their fields are `type`, `module`, `name`, `code_path`, `rpg_nodes` —
   a path, not a slice. A defect that duplicates source slices cannot corrupt an
   artefact that contains no source slices.

### Assertions — but it does reproduce on this repository's code

Measured on this worktree with `evidence/dedup-probe.py`; full output in
`evidence/dedup-defect-check.txt`. Feeding this repository's files through the
same parser and `dedup_file_code` the affected stages use:

| File | nested unit pairs | original bytes | after dedup | inflation |
| --- | --- | --- | --- | --- |
| `src/harness.ts` | 7 | 24150 | 44501 | **1.84x** |
| `src/decisions.ts` | 9 | 6800 | 9284 | 1.37x |
| `src/ast-adapters.ts` | 5 | 8411 | 10317 | 1.23x |
| `src/lang/core.ts` | 0 | 26663 | 23746 | 0.89x |
| `src/tools.ts` | 0 | 14843 | 10153 | 0.68x |
| `src/generation.ts` | 0 | 8871 | 4932 | 0.56x |

In every case 100% of input blocks survived deduplication — nothing was removed.

### Synthesis

The defect is class-specific: it bites exactly where a TypeScript `class` wraps
methods, and not at all in this repository's function-only modules. `src/lang/`,
`src/tools.ts` and `src/generation.ts` — the three places a Bend backend would
touch most — are function-only and show zero nested pairs. `src/harness.ts` and
`src/ast-adapters.ts` do contain classes and would inflate.

So: recorded as checked, with the answer in both directions. The committed graph
is unaffected. If a later lane runs CoderMind's `plan_tasks` or `func_design`
stages against this repository, it should expect up to 1.84x context inflation on
the class-bearing files and should not read that inflation as richer information.

---

## 6. Retrievals that failed during the encode

The brief requires failed retrievals be recorded as failed rather than summarised
from memory.

### Assertions

- The encode's trajectory records 11 LLM calls in step `parse_rpg`; **9 succeeded
  and 2 failed** after exhausting their internal retries. Steps `dep_graph`,
  `save_rpg` and `visualize` made no LLM calls.
- The trajectory records those two failures only as
  `LLM call failed with return code 1: ` with an empty stderr, which does not say
  why. The reason is in the sub-agent session transcripts.
- Enumerated from those transcripts by
  `evidence/graph/refused-subagent-calls.py`, output in
  `evidence/graph/refused-subagent-calls.txt`: **7 sub-agent invocations in the
  encode window were refused by a safety classifier**, each recording
  `model_refusal_no_fallback` and the message "Opus 5's safeguards flagged this
  message … This sometimes happens with safe, normal conversations." with
  `Details: [reasoning_extraction]`. Request IDs are retained in that file.
- The refused prompts were all the same encoder prompt — "You are an expert
  software architect and repository analyst" — asking it to refine the repository's
  functional-area grouping.
- CoderMind's own retry logic absorbed all seven: `common/llm_client.py:413`
  retries up to three times per call, and `:912` retries the call up to three
  times again. The encode completed with `"status": "success"`.

### Synthesis

Nothing was worked around and no prompt was rewritten to evade the classifier;
the encoder's ordinary retry path recovered on its own and the run finished. The
refusals are recorded because a reader of the trajectory would otherwise see two
unexplained `return code 1` entries and have no way to tell a classifier refusal
from a broken toolchain. Treat this as a reliability note for anyone re-running
the encode: expect intermittent refusals on the functional-area refinement prompt.

No other retrieval failed during this phase. The failed retrievals from the
earlier part of phase 1 are recorded in `01-inspection.md` §5.

---

## 7. Cost of the encode — a request count, not a quality result

### Assertions

| Measure | Value |
| --- | --- |
| `claude` CLI sub-agent invocations in the encode window | 16 |
| of those, completed normally | 9 |
| of those, refused by the classifier | 7 |
| LLM calls as the trajectory counts them (retries collapsed) | 11 |
| summed in-call seconds | 812.8 s |
| wall clock | 13 m 36 s |
| paid API spend | none (subscription CLI path; no API key in environment) |

### Synthesis

These are cost and reliability figures. **They say nothing about whether the
graph is good.** They are reported here separately, and deliberately not in the
same table as any correctness claim, because this lane's brief requires request
counts never be presented as quality results. The graph's usefulness is argued in
§3 from what it contains and bounded in §4 by what it does not.

---

## 8. Phase 1 conclusion (graph part)

- A real, tool-generated repository planning graph exists in the tree at
  `docs/bend2-pilot/evidence/graph/rpg.json`, with its run log, trajectory and
  visualisation committed alongside it. It was not hand-drawn.
- It decomposes the repository into 7 functional areas and 520 feature nodes and
  places all four boundaries from `01-inspection.md` §3 at identifiable node ids.
- Its edge layer is weak: no import was resolved, so there are no cross-file
  edges and 155 feature nodes are isolated. Phase 2 must derive tickets from
  nodes and say plainly when a claim needed file-and-line evidence instead.
- TES-36's deduplication defect was checked in both directions: it cannot affect
  this artefact, and it does reproduce on this repository's class-bearing files
  if other CoderMind stages are ever run here.
- Nothing in phase 1 argues against proceeding as scoped. The one question that
  could have blocked the pilot — whether real Bend compiler validation is
  obtainable offline on this CPU-only host — was answered yes and measured
  (`01-inspection.md` §4.4).

Phase 2 (scoped tickets derived from these graph nodes, and the native-AST vs
typed-IR vs bounded-grammar decision) begins only after this phase is committed.
