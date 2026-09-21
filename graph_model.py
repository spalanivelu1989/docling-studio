"""Serve the generated Neo4j Data Importer model to the UI.

`docs/kg-data-importer-model.json` is produced by `kg_data_importer_model.py`
from `knowledge_graph.json`. This module flattens it into the shape the model
view draws -- labels with their positions and properties, relationship types
with their endpoints -- and attaches, per label, how many nodes of that type the
graph holds and a sample of them, so a label on the canvas can be opened into
the data it stands for.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
MODEL_FILE = BASE_DIR / "docs" / "kg-data-importer-model.json"

# Label token -> node `type` in knowledge_graph.json. The model is generated
# from those types, so this is a spelling change, not a mapping decision.
LABEL_TYPE = {
    "Stream": "stream",
    "System": "system",
    "Document": "document",
    "Process": "process",
    "Spec": "spec",
}

SAMPLE = 14


def _instances(graph: dict[str, Any], node_type: str | None) -> list[dict[str, Any]]:
    """A few real nodes for a label, most connected first.

    :Process is sorted by taxonomy depth instead, so the sample reads as a
    hierarchy: sorting it by degree buries 4.0 Lead to Cash below its own
    children and drops whole value chains off the end of the list.
    """
    if not node_type:
        return []
    pool = [n for n in graph["nodes"] if n["type"] == node_type]
    if node_type == "process":
        pool.sort(key=lambda n: (_depth(n.get("code", "")), -n.get("degree", 0), n.get("code", "")))
    else:
        pool.sort(key=lambda n: (-n.get("degree", 0), n.get("code") or n.get("label", "")))

    out = []
    for n in pool[:SAMPLE]:
        detail = n.get("description") or ""
        if n.get("jira_key"):
            detail = f"{detail} · {n['jira_key']}" if detail else n["jira_key"]
        if n["type"] == "spec" and n.get("is_primary"):
            detail = "primary specification"
        out.append({
            "id": n["id"],
            "label": n.get("code") or n.get("ticket") or n["label"],
            "detail": detail,
            "degree": n.get("degree", 0),
        })
    return out


def _depth(code: str) -> int:
    """Taxonomy depth of a process code. "4.0" is a value chain, "4.5.1.1" an
    L4 step; a legacy letter code (O-020-090) sorts after every numbered one."""
    if not code:
        return 99
    if code[0].isdigit():
        return 1 if code.endswith(".0") else len(code.split("."))
    return 50 + len(code.split("-"))


def load_model(graph: dict[str, Any] | None = None) -> dict[str, Any]:
    if not MODEL_FILE.is_file():
        raise FileNotFoundError(
            f"{MODEL_FILE.name} is missing; run kg_data_importer_model.py"
        )
    raw = json.loads(MODEL_FILE.read_text(encoding="utf-8"))
    schema = raw["dataModel"]["graphSchemaRepresentation"]["graphSchema"]
    positions = {n["id"]: n["position"] for n in raw.get("visualisation", {}).get("nodes", [])}

    if graph is None:
        import knowledge_graph
        graph = knowledge_graph.extract_graph()

    counts: dict[str, int] = {}
    for n in graph["nodes"]:
        counts[n["type"]] = counts.get(n["type"], 0) + 1
    rel_counts: dict[str, int] = {}
    for e in graph["edges"]:
        rel_counts[e["relation"]] = rel_counts.get(e["relation"], 0) + 1

    labels_by_id = {n["$id"]: n for n in schema["nodeLabels"]}
    node_label = {
        n["$id"]: labels_by_id[n["labels"][0]["$ref"].lstrip("#")]
        for n in schema["nodeObjectTypes"]
    }
    rel_token = {r["$id"]: r["token"] for r in schema["relationshipTypes"]}

    # Key and existence constraints, per label, so the panel can show them.
    constraints: dict[str, list[dict[str, str]]] = {}
    prop_token = {
        p["$id"]: p["token"] for n in schema["nodeLabels"] for p in n["properties"]
    }
    for c in schema.get("constraints", []):
        ref = c.get("nodeLabel", {}).get("$ref", "").lstrip("#")
        token = labels_by_id[ref]["token"] if ref in labels_by_id else ""
        if not token:
            continue
        constraints.setdefault(token, []).append({
            "type": c["constraintType"],
            "property": ", ".join(prop_token.get(p["$ref"].lstrip("#"), "?") for p in c["properties"]),
        })

    nodes = []
    for obj in schema["nodeObjectTypes"]:
        label = node_label[obj["$id"]]
        token = label["token"]
        node_type = LABEL_TYPE.get(token)
        nodes.append({
            "id": obj["$id"],
            "token": token,
            "position": positions.get(obj["$id"], {"x": 0, "y": 0}),
            "properties": [
                {"name": p["token"], "type": p["type"]["type"], "nullable": p["nullable"]}
                for p in label.get("properties", [])
            ],
            "constraints": constraints.get(token, []),
            "built_as": node_type,
            "count": counts.get(node_type, 0) if node_type else 0,
            "instances": _instances(graph, node_type),
        })

    relationships = [
        {
            "id": r["$id"],
            "type": rel_token[r["type"]["$ref"].lstrip("#")],
            "from": r["from"]["$ref"].lstrip("#"),
            "to": r["to"]["$ref"].lstrip("#"),
            "count": rel_counts.get(rel_token[r["type"]["$ref"].lstrip("#")].lower(), 0),
        }
        for r in schema["relationshipObjectTypes"]
    ]

    return {
        "version": raw.get("version", ""),
        "nodes": nodes,
        "relationships": relationships,
        "stats": {
            "labels": len(nodes),
            "relationship_types": len(relationships),
            "constraints": len(schema.get("constraints", [])),
            "nodes": len(graph["nodes"]),
            "edges": len(graph["edges"]),
        },
    }


if __name__ == "__main__":
    m = load_model()
    print(json.dumps(m["stats"], indent=2))
    for n in m["nodes"]:
        cons = " · ".join(f"{c['type']}({c['property']})" for c in n["constraints"])
        print(f"  :{n['token']:<9} {n['count']:>4}  {cons}")
