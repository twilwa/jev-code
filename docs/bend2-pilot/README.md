# Bend 2 generation pilot (TES-46)

Working record for the jev-code Bend 2 AST-generation pilot. Written to be
consumed directly by a wiki intake: assertions the sources make are kept separate
from our synthesis, every claim carries a source URL, pinned commit, file and
line, and retrievals that failed are recorded as failed rather than summarised
from memory.

The linked human capture is `Jev-code Bend 2 generation pilot.md`, which lives in
the human wiki folder and is read-only to agents. It is cited from these
documents and never reproduced or edited here.

| Document | Phase | Contents |
| --- | --- | --- |
| `01-inspection.md` | 1 | Pinned revisions, the unresolved licence, the four boundary maps, and what Bend 2 actually is and requires. |
| `02-graph.md` | 1 | The CoderMind/RPG graph: how it was produced, what it contains, where it is weak, and the TES-36 deduplication answer. |

`evidence/` holds the raw material those documents cite — command output,
probes, and the graph artefacts — so every number can be re-derived without
re-running the tooling.

## Standing constraint

The licence question is unresolved (`01-inspection.md` §2). Until the captain
answers it, this is a research and local prototype: no publishing, no package
registry action, no redistribution of upstream source beyond this fork, and no
vendoring of upstream code into another project.

## Three claims, kept separate

**Parse validity**, **typing and proofs**, and **semantic correctness** are three
different claims with three different bodies of evidence. A program that parses
is not thereby typed; a program that type-checks or satisfies encoded laws is not
thereby semantically correct. Nothing in this pilot may let one stand in for
another in a test name, a report line or a commit message.
