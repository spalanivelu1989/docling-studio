"""The knowledge graph build must be a pure function of the corpus.

Run: python test_graph_determinism.py

Same files in, same graph out -- not merely the same nodes and edges, but the
same bytes. That property is what makes a change to an extraction rule
reviewable: rebuild, diff, and the diff is exactly what the rule did.

It was lost for a while, and quietly. `extract_graph` iterated
`set(CODE_RE.findall(content))` and `set(TICKET_RE.findall(haystack))`
directly, so the order it created process and spec nodes in came from string
hashing, which Python seeds per process. Two builds of an unchanged corpus
produced identical content in a different order: same 2,389 nodes, same 4,780
edges, same stats, and a 38,000-line diff in a tracked file that said nothing
at all. Noise like that does not announce itself -- it just trains everyone to
stop reading the diff, which is where a real change would have been.

The check has to cross a process boundary, because PYTHONHASHSEED is fixed for
the life of an interpreter: building twice inside one process cannot fail even
when the bug is present.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent

# Built with cache=False: the point is to compare two BUILDS, and a cache hit
# would compare one build with itself and pass regardless.
BUILD = """
import hashlib, json, sys
sys.path.insert(0, %r)
import knowledge_graph as kg
g = kg.extract_graph(force=True, cache=False)
print(hashlib.sha256(json.dumps(g).encode()).hexdigest())
print(json.dumps(g["stats"]["types"]))
"""


def build(seed: str) -> tuple[str, str]:
    """(digest, type counts) from a fresh interpreter with this hash seed."""
    out = subprocess.run(
        [sys.executable, "-c", BUILD % str(BASE)],
        capture_output=True, text=True, env={"PYTHONHASHSEED": seed, "PATH": "/usr/bin:/bin"},
        cwd=BASE, check=True,
    ).stdout.split("\n")
    return out[0].strip(), out[1].strip()


def test_two_builds_under_different_hash_seeds_are_byte_identical():
    a, types_a = build("1")
    b, types_b = build("2")
    assert types_a == types_b, f"the graph itself differs: {types_a} vs {types_b}"
    assert a == b, (
        "two builds of the same corpus produced different bytes.\n"
        f"  seed 1: {a[:16]}\n  seed 2: {b[:16]}\n"
        "Something in extract_graph iterates a set (or another unordered "
        "collection) and lets that reach the output. Sort it before iterating."
    )


def test_the_cached_graph_matches_a_fresh_build():
    """A served cache must be the graph a rebuild would produce.

    Otherwise the file on disk and the graph the agents traverse drift apart,
    and the one nobody rebuilt is the one being cited."""
    import knowledge_graph as kg

    fresh = kg.extract_graph(force=True, cache=False)
    cached = json.loads((BASE / "knowledge_graph.json").read_text())
    if cached.get("stats", {}).get("sources") != fresh["stats"]["sources"]:
        print("  skip  the cached graph was built from a different file set")
        return
    for key in ("total_nodes", "total_edges", "types", "categories"):
        assert cached["stats"][key] == fresh["stats"][key], (
            f"the cached graph disagrees with a fresh build on {key}: "
            f"{cached['stats'][key]} vs {fresh['stats'][key]}"
        )
    digest = lambda g: hashlib.sha256(  # noqa: E731
        json.dumps([n["id"] for n in g["nodes"]] + [e["id"] for e in g["edges"]]).encode()
    ).hexdigest()
    assert digest(cached) == digest(fresh), (
        "the cached graph holds the same nodes and edges in a different order, "
        "so every rebuild rewrites the file for no reason"
    )


if __name__ == "__main__":
    import traceback

    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception:
            failed += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
