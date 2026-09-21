"""Generate a Neo4j Data Importer model from the built knowledge graph.

Everything here is derived from `knowledge_graph.json`: the node labels are the
node types, the relationship types are the edge relations, the properties and
their nullability are read off the nodes that actually carry them, and the
key constraints follow whichever property identifies each label.

The file format is the Neo4j graph schema JSON used by Data Importer
(https://github.com/neo4j/graph-schema-json-js-utils). Its shape, in short:

    graphSchema.nodeLabels           tokens -- the label names and their properties
    graphSchema.relationshipTypes    tokens -- the relationship type names
    graphSchema.nodeObjectTypes      instances -- a node that carries label(s)
    graphSchema.relationshipObjectTypes  instances -- type + from + to
    graphSchema.constraints          key/uniqueness/existence, by $ref

Tokens and object types are kept apart deliberately: a label is a name, an
object type is a node in the model that wears it. Everything cross-references
by `$id` / `$ref`, never by name.

Usage:  .venv/bin/python kg_data_importer_model.py [--validate]
Output: docs/kg-data-importer-model.json  (open it at import.neo4j.io)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
GRAPH = BASE_DIR / "knowledge_graph.json"
OUT = BASE_DIR / "docs" / "kg-data-importer-model.json"
SCHEMA_URL = "https://raw.githubusercontent.com/neo4j/graph-schema-json-js-utils/main/packages/json-schema/json-schema.json"

# Neo4j naming: labels PascalCase, relationship types SCREAMING_SNAKE_CASE.
LABEL = {
    "stream": "Stream",
    "system": "System",
    "document": "Document",
    "process": "Process",
    "spec": "Spec",
}

# The property that identifies each label, which becomes its key constraint.
KEY_PROPERTY = {
    "Stream": "code",
    "System": "code",
    "Document": "filename",
    "Process": "code",
    "Spec": "ticket",
}

# Presentation fields the canvas needs. They are not part of the data model and
# would otherwise show up as properties of every label.
COSMETIC = {"id", "type", "label", "color", "size", "degree"}

# Where each label sits on the Data Importer canvas. The schema is a star -- the
# document is the only thing joined to anything else -- so it is drawn as one,
# at roughly the scale Data Importer lays models out at.
POSITION = {
    "Document": (0, 0),
    "Stream": (0, -420),
    "System": (520, 60),
    "Spec": (-520, 60),
    "Process": (0, 430),
}

# Neo4j property types, from the schema's PropertyTypesEnum.
def _type_of(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    return "string"


def build(graph: dict[str, Any]) -> dict[str, Any]:
    by_id = {n["id"]: n for n in graph["nodes"]}

    # --- properties, read off the data -------------------------------------
    # A property is nullable when some node of that label does not carry it,
    # which is how `jira_key` ends up optional on :Process: only the steps
    # that came from the register have one.
    seen: dict[str, dict[str, str]] = {}
    counts: dict[str, int] = {}
    present: dict[str, dict[str, int]] = {}
    for node in graph["nodes"]:
        token = LABEL[node["type"]]
        counts[token] = counts.get(token, 0) + 1
        props = seen.setdefault(token, {})
        here = present.setdefault(token, {})
        for key, value in node.items():
            if key in COSMETIC or value is None or value == "":
                continue
            props.setdefault(key, _type_of(value))
            here[key] = here.get(key, 0) + 1

    # --- tokens -------------------------------------------------------------
    node_labels, prop_ids = [], {}
    pid = 0
    for i, token in enumerate(sorted(seen), start=1):
        entries = []
        for name in sorted(seen[token]):
            pid += 1
            prop_ids[(token, name)] = f"p:{pid}"
            entries.append({
                "$id": f"p:{pid}",
                "token": name,
                "type": {"type": seen[token][name]},
                "nullable": present[token][name] < counts[token],
            })
        node_labels.append({"$id": f"nl:{i}", "token": token, "properties": entries})
    label_id = {n["token"]: n["$id"] for n in node_labels}

    # One relationship type per distinct relation, with the edge's UI label
    # carried as a property -- it is real data on every edge.
    relations = sorted({e["relation"] for e in graph["edges"]})
    rel_types = []
    for i, relation in enumerate(relations, start=1):
        pid += 1
        rel_types.append({
            "$id": f"rt:{i}",
            "token": relation.upper(),
            "properties": [{
                "$id": f"p:{pid}",
                "token": "label",
                "type": {"type": "string"},
                "nullable": False,
            }],
        })
    rel_type_id = {r["token"]: r["$id"] for r in rel_types}

    # --- object types -------------------------------------------------------
    node_objects, node_object_id = [], {}
    for i, token in enumerate(sorted(seen), start=1):
        node_object_id[token] = f"n:{i}"
        node_objects.append({"$id": f"n:{i}", "labels": [{"$ref": f"#{label_id[token]}"}]})

    # A relationship object type is one (source label, type, target label)
    # triple. Every relation in this graph connects exactly one pair, so the
    # triples are derived rather than assumed -- if that ever stops being true
    # the extra pair shows up here as its own object type.
    triples = sorted({
        (LABEL[by_id[e["source"]]["type"]], e["relation"].upper(), LABEL[by_id[e["target"]]["type"]])
        for e in graph["edges"]
    })
    rel_objects = [
        {
            "$id": f"r:{i}",
            "type": {"$ref": f"#{rel_type_id[rel]}"},
            "from": {"$ref": f"#{node_object_id[src]}"},
            "to": {"$ref": f"#{node_object_id[dst]}"},
        }
        for i, (src, rel, dst) in enumerate(triples, start=1)
    ]

    # --- constraints --------------------------------------------------------
    # Two kinds, following what Data Importer itself writes: a `key` constraint
    # on the property that identifies the label, and a `propertyExistence`
    # constraint on every other property that is never missing. The second kind
    # is only honest because nullability was measured -- `jira_key` is absent
    # from half the :Process nodes, so it gets neither.
    constraints = []
    cid = 0
    for token in sorted(seen):
        key = KEY_PROPERTY.get(token)
        if key and (token, key) in prop_ids:
            cid += 1
            constraints.append({
                "$id": f"c:{cid}",
                "name": f"{key}_{token}_key",
                "constraintType": "key",
                "entityType": "node",
                "nodeLabel": {"$ref": f"#{label_id[token]}"},
                "properties": [{"$ref": f"#{prop_ids[(token, key)]}"}],
            })
        for name in sorted(seen[token]):
            if name == key or present[token][name] < counts[token]:
                continue
            cid += 1
            constraints.append({
                "$id": f"c:{cid}",
                "name": f"{name}_{token}_propertyExistence",
                "constraintType": "propertyExistence",
                "entityType": "node",
                "nodeLabel": {"$ref": f"#{label_id[token]}"},
                "properties": [{"$ref": f"#{prop_ids[(token, name)]}"}],
            })

    # --- the documents the graph was built from are its data sources --------
    sources = sorted(
        n.get("filename", "") for n in graph["nodes"] if n["type"] == "document"
    )

    return {
        "version": "3.0.0",
        "visualisation": {
            "nodes": [
                {"id": node_object_id[token], "position": {"x": float(x), "y": float(y)}}
                for token, (x, y) in POSITION.items()
                if token in node_object_id
            ]
        },
        "dataModel": {
            "version": "3.0.0",
            "graphSchemaRepresentation": {
                "version": "1.0.0",
                "graphSchema": {
                    "nodeLabels": node_labels,
                    "relationshipTypes": rel_types,
                    "nodeObjectTypes": node_objects,
                    "relationshipObjectTypes": rel_objects,
                    "constraints": constraints,
                    "indexes": [],
                },
            },
            "graphSchemaExtensionsRepresentation": {
                "nodeKeyProperties": [],
                "relationshipKeyProperties": [],
            },
            "graphMappingRepresentation": {
                "dataSourceSchema": {
                    "type": "local-unstructured",
                    "tableSchemas": [
                        {"name": name, "expanded": False, "fields": []} for name in sources
                    ],
                },
                "nodeMappings": [],
                "relationshipMappings": [],
            },
            "configurations": {"idsToIgnore": [], "arrayDelimiter": "|", "vectorDelimiter": "|"},
        },
    }


def main() -> None:
    graph = json.loads(GRAPH.read_text())
    model = build(graph)
    OUT.write_text(json.dumps(model, indent=2) + "\n")

    schema = model["dataModel"]["graphSchemaRepresentation"]["graphSchema"]
    print(f"wrote {OUT.relative_to(BASE_DIR)}")
    print(f"  {len(schema['nodeLabels'])} node labels, "
          f"{len(schema['relationshipTypes'])} relationship types, "
          f"{len(schema['relationshipObjectTypes'])} relationship object types, "
          f"{len(schema['constraints'])} constraints")
    for nl in schema["nodeLabels"]:
        props = ", ".join(
            f"{p['token']}:{p['type']['type']}{'?' if p['nullable'] else ''}"
            for p in nl["properties"]
        )
        print(f"    :{nl['token']:<9} {props}")

    if "--validate" in sys.argv:
        import urllib.request

        import jsonschema

        with urllib.request.urlopen(SCHEMA_URL) as fh:
            spec = json.load(fh)
        jsonschema.validate(
            {"graphSchemaRepresentation":
                model["dataModel"]["graphSchemaRepresentation"]},
            spec,
        )
        print("\n  validates against the official Neo4j graph schema JSON")


if __name__ == "__main__":
    main()
