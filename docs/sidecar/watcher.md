# Bend sidecar watcher

`watchBendChanges` turns two in-memory Bend file sets into deterministic JSON. It does not run Bend, call Jev, read credentials, or suggest shell commands. The result is the offline input that a later sidecar may judge.

```ts
import { watchBendChanges } from 'jev-code';

const result = watchBendChanges(
  { files: { 'main.bend': oldSource } },
  { files: { 'main.bend': newSource } },
);
```

The function emits one chunk for each added, changed, or removed top-level `def`, `law`, or `type`. File paths and chunks are sorted before output. SHA-256 hashes bind each chunk to its old and new declaration text, so a consumer can reject advice after the diff changes.

## What a chunk records

Each chunk has `state`, `questions`, and `characterCount` fields. `characterCount` is the number of characters in `JSON.stringify({ state, questions })`.

The state records:

- old and new structural node kinds, literals, callees, signatures, call edges, spans, source hashes, and bounded source slices;
- laws with a normalized proposition, dependencies, paired definition, open or filled status, and a `type_only` or `behavioral_property` classification;
- connected property and test definitions that call the changed symbol, including literal input and boundary summaries, a syntactic oracle signal, and a `not_run` result;
- hole, `@unsafe`, and foreign-definition counts;
- parameter quantities and use counts, duplicate binders, shadowing, copied values, and dropped values.

The ownership result is always `not_run`. Only the Bend compiler can establish an ownership pass or failure. In the same way, a clean structural state does not claim that parsing, typing, proof checking, tests, or properties passed.

Law classification is deliberately syntactic. A law with equality, inequality, ordering, bounds, preservation, invariant terms, or another proposition in braces is behavioral. A result type such as `U32` or `IO(Unit)` is type-only. This distinction catches the verifier-versus-law case: `dbl : U32 -> U32` constrains the type but does not say that `dbl(a)` equals `a + a`.

Property and test discovery follows names and paths. Definitions named with `property`, `prop`, or `check` count as properties. Definitions in test or spec paths, or with test in the name, count as tests. The watcher connects one to a root when its body calls that root. This is exact and predictable, but it does not replace a project-specific manifest for unconventional test names.

## Questions are data

Every chunk contains four TypeSafe-shaped questions: `property_missing`, `intent_conflict`, `risk_evidence`, and `next_evidence`. They have only `type`, `instructions`, and `criteria`. Choice criteria include `abstain`; the Noul instructions define uncertainty near 0.5 as abstention.

The watcher never submits these questions. It also does not turn them into prose advice. A live sidecar would send all questions for one unchanged chunk together, apply calibrated thresholds, and discard stale or abstaining answers.

## Character budget and chunking

`WATCH_CHUNK_CHARACTER_LIMIT` is 24,000 characters per declaration payload. Chunking follows the changed root symbol and keeps its connected laws, properties, and tests together. It never splits a declaration at an arbitrary line.

The watcher applies this fixed compaction order when a payload is too large:

1. Remove bounded source slices while retaining hashes and spans.
2. Cap structural lists and binder lists, then truncate unusually long names.
3. Remove connected evidence records from the sorted tail and record the count.
4. Shorten normalized propositions and dependency lists.
5. Remove additional same-name laws from the sorted tail, retaining at least one.

The `omitted` counts make every reduction visible. If the structural record still cannot fit, the watcher throws instead of emitting an oversized or silently incomplete chunk.

The eight cases in `benchmark/bend2/verifier-vs-law/defects.json` feed the watcher fixture in `benchmark/bend2/verifier-vs-law/watcher-fixture.ts`. Each mutation produces a `dbl` state and a question that names the gap: the only law gives a function type, not a behavioral property. The focused tests also cover deterministic ordering, behavioral-law classification, connected tests, holes, trust markers, ownership changes, and budget compaction.
