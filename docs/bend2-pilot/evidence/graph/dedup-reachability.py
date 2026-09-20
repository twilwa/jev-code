#!/usr/bin/env python3
"""Does TES-36's line-overlap dedup defect reach THIS graph artefact?

Two independent checks:
  1. Static: walk the import closure of the encode entry point
     (rpg_encoder/run_encode.py) and report any reachable module that
     references common.code_dedup, the helper carrying the defect.
  2. Empirical: count how many nodes in the produced rpg.json carry any
     source text at all.  The defect duplicates *source slices*; a graph
     that stores no source cannot carry duplicated source.

    python3 dedup-reachability.py <cmind-scripts-dir> <rpg.json>
"""
import ast
import json
import os
import sys


def import_closure(scripts_dir: str, entry: str):
    """Return (modules_visited, modules_referencing_the_dedup_helper)."""
    def resolve(module: str):
        candidate = os.path.join(scripts_dir, module.replace(".", "/") + ".py")
        if os.path.exists(candidate):
            return os.path.relpath(candidate, scripts_dir)
        candidate = os.path.join(scripts_dir, module.replace(".", "/"), "__init__.py")
        if os.path.exists(candidate):
            return os.path.relpath(candidate, scripts_dir)
        return None

    seen, stack, hits = set(), [entry], []
    while stack:
        rel = stack.pop()
        if rel in seen:
            continue
        seen.add(rel)
        source = open(os.path.join(scripts_dir, rel), errors="replace").read()
        if "dedup_file_code" in source or "dedup_code_blocks" in source:
            hits.append(rel)
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                targets = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            else:
                continue
            stack.extend(r for r in map(resolve, targets) if r)
    return seen, hits


def walk(node):
    yield node
    for child in node.get("children") or []:
        yield from walk(child)


def main() -> None:
    scripts_dir, rpg_path = sys.argv[1], sys.argv[2]

    seen, hits = import_closure(scripts_dir, "rpg_encoder/run_encode.py")
    print("CHECK 1 - static reachability from the encode entry point")
    print(f"  modules in the import closure            : {len(seen)}")
    print(f"  of those, referencing common.code_dedup  : {hits or 'NONE'}")

    graph = json.load(open(rpg_path))
    nodes = list(walk(graph["root"]))
    with_content = [n for n in nodes if (n.get("meta") or {}).get("content")]
    dep_nodes = graph["dep_graph"]["nodes"]
    with_code = [k for k, v in dep_nodes.items() if isinstance(v, dict) and v.get("code")]

    print("\nCHECK 2 - does the artefact store source text at all?")
    print(f"  rpg nodes                                : {len(nodes)}")
    print(f"  rpg nodes with non-empty meta.content    : {len(with_content)}")
    print(f"  dep_graph nodes                          : {len(dep_nodes)}")
    print(f"  dep_graph nodes with a 'code' field      : {len(with_code)}")
    sample = next(iter(dep_nodes))
    print(f"  dep_graph node fields                    : {list(dep_nodes[sample].keys())}")


if __name__ == "__main__":
    main()
