"""Telling a real connection from an artefact of the graph's shape.

`knowledge_graph.py` links a document to a stream when the stream's code
appears in its filename or its first 600 characters. That is a useful label and
a terrible edge: every L2C document ends up adjacent to every other L2C
document through one node. BFS then finds a four-hop "path" between any two
systems in the stream, and the graph's own narrator presents it as an
integration route -- fluent, specific and meaningless.

Measured on this corpus, three nodes carry that risk:

    Lead to Cash (L2C)                 degree  43   a label, not a system
    SAP S/4HANA                        degree  43   a real system, still a hub
    SPARK L2C L1-L4 Processes (xlsx)   degree 508   names every code, so links
                                                    to nearly everything

A path through a stream, or through a document that over-matched, says nothing.
A path through S/4HANA may be real, so it is flagged rather than discarded.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import knowledge_graph  # noqa: E402

# A node this well connected is a junction, not a step in a route.
HUB_DEGREE = int(__import__("os").environ.get("EVIDENCE_HUB_DEGREE", "40"))

# Relations that record a label, not a flow of data.
LABEL_RELATIONS = {"belongs_to", "subprocess_of"}


@dataclass
class PathVerdict:
    hops: int
    steps: list[dict]
    node_ids: list[str]
    edge_ids: list[str]
    meaningful: bool
    via_hubs: list[str]
    via_label_edges: list[str]
    reason: str

    def as_dict(self) -> dict:
        return {
            "hops": self.hops,
            "steps": self.steps,
            "node_ids": self.node_ids,
            "edge_ids": self.edge_ids,
            "meaningful": self.meaningful,
            "warning": "" if self.meaningful else self.reason,
            "note": self.reason,
        }


def hubs(graph: dict | None = None) -> dict[str, int]:
    g = graph or knowledge_graph.extract_graph()
    return {n["id"]: n.get("degree", 0) for n in g["nodes"] if n.get("degree", 0) >= HUB_DEGREE}


def judge(graph: dict, path: dict | None) -> PathVerdict | None:
    """Classify a BFS result as a real route or an artefact of the topology."""
    if not path:
        return None
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = {e["id"]: e for e in graph["edges"]}
    hub = hubs(graph)

    interior = path["nodes"][1:-1]
    via_hubs = [nodes[n]["label"] for n in interior if n in hub]
    via_streams = [n for n in interior if nodes[n]["type"] == "stream"]
    label_edges = [edges[e]["relation"] for e in path["edges"]
                   if e in edges and edges[e]["relation"] in LABEL_RELATIONS]

    steps = []
    for eid in path["edges"]:
        e = edges.get(eid)
        if not e:
            continue
        steps.append({
            "from": nodes[e["source"]]["label"],
            "relation": e["relation"],
            "to": nodes[e["target"]]["label"],
            "is_label_edge": e["relation"] in LABEL_RELATIONS,
        })

    if via_streams:
        names = ", ".join(nodes[n]["label"] for n in via_streams)
        return PathVerdict(
            path["hops"], steps, path["nodes"], path["edges"], False, via_hubs, label_edges,
            f"NOT a real connection: this route only exists because both ends sit in the "
            f"{names} stream. Stream membership is a label, not an interface. Look for an "
            f"interface specification in the corpus instead.",
        )

    if label_edges:
        return PathVerdict(
            path["hops"], steps, path["nodes"], path["edges"], False, via_hubs, label_edges,
            f"NOT a real connection: {len(label_edges)} hop(s) of this route are "
            f"{'/'.join(sorted(set(label_edges)))} edges, which record classification rather "
            f"than any flow of data between systems.",
        )

    if via_hubs:
        return PathVerdict(
            path["hops"], steps, path["nodes"], path["edges"], True, via_hubs, label_edges,
            f"Passes through {', '.join(via_hubs)}, which is connected to a large share of the "
            f"graph. The route may be real, but confirm it against an interface specification "
            f"before relying on it.",
        )

    return PathVerdict(
        path["hops"], steps, path["nodes"], path["edges"], True, [], [],
        "Every hop is a content-derived relation and no hub mediates it.",
    )


def shortest(graph: dict, a: str, b: str) -> PathVerdict | None:
    return judge(graph, knowledge_graph.find_shortest_path(graph, a, b))
