#!/usr/bin/env python3
"""Summarise the committed CoderMind RPG artefact.

Reads ./rpg.json (the tool output, committed verbatim alongside this script)
and prints the counts, the functional-area tree and the feature nodes that sit
on the four boundaries the brief asks to map.  Nothing here edits the graph;
it only reports what the encoder produced.

    python3 graph-summary.py [path/to/rpg.json]
"""
import collections
import json
import sys

BOUNDARY_FILES = [
    # adapter boundary
    "src/ast-adapters.ts",
    # grammar / language-backend boundary
    "src/lang/core.ts", "src/lang/index.ts", "src/lang/rust.ts", "src/lang/lua.ts",
    "src/lang/c.ts", "src/lang/go.ts", "src/lang/javascript.ts", "src/lang/ruby.ts",
    "src/python-ast.ts", "src/python-units.ts", "src/python-search.ts",
    # provider boundary
    "src/provider.ts", "src/decide.ts", "src/generation.ts", "src/decisions.ts",
    # validator boundary
    "src/tools.ts", "src/harness.ts",
]


def walk(node, ancestors=()):
    yield node, ancestors
    for child in node.get("children") or []:
        yield from walk(child, ancestors + (node["name"],))


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "rpg.json"
    graph = json.load(open(path))
    nodes = list(walk(graph["root"]))

    print(f"repo_name        : {graph['repo_name']}")
    print(f"rpg nodes        : {len(nodes)}")
    print(f"rpg edges        : {len(graph['edges'])}")
    print(f"dep_graph nodes  : {len(graph['dep_graph']['nodes'])}")
    print(f"dep_graph edges  : {len(graph['dep_graph']['edges'])}")
    print(f"excluded files   : {graph['excluded_files']}")

    print("\n## nodes by type")
    for kind, count in collections.Counter(n["node_type"] for n, _ in nodes).most_common():
        print(f"  {count:4d}  {kind}")

    print("\n## edges by relation (and by generator)")
    for rel, count in collections.Counter(e["relation"] for e in graph["edges"]).most_common():
        print(f"  {count:4d}  {rel}")
    gens = collections.Counter((e.get("meta") or {}).get("generator") for e in graph["edges"])
    for gen, count in gens.most_common():
        print(f"  {count:4d}  generator={gen}")

    print("\n## functional areas (level 1) and their subtrees")
    for node, _ in nodes:
        if node["node_type"] == "functional_area":
            sub = list(walk(node))
            leaves = sum(1 for n, _ in sub if n["node_type"] == "feature")
            print(f"  {node['name']:<24} id={node['id']}  nodes={len(sub)}  features={leaves}")

    features = [(n, a) for n, a in nodes if n["node_type"] == "feature"]
    by_file = collections.defaultdict(list)
    for node, anc in features:
        by_file[(node["meta"].get("path") or "").split("::")[0]].append((node, anc))

    print("\n## feature nodes on the boundaries named by the brief")
    for boundary_file in BOUNDARY_FILES:
        hits = by_file.get(boundary_file, [])
        print(f"\n### {boundary_file}  ({len(hits)} feature nodes)")
        for node, anc in hits:
            area = anc[1] if len(anc) > 1 else "?"
            print(f"  {node['id']}")
            print(f"    path  {node['meta'].get('path')}   ({node['meta'].get('type_name')})")
            print(f"    area  {area} / {' / '.join(anc[2:])}")
            print(f"    desc  {node['meta'].get('description')}")


if __name__ == "__main__":
    main()
