"""Re-express knowledge_graph.json in Neo4j's property-graph vocabulary.

The extractor already emits a property graph: a node's `type` is a Neo4j
*label*, an edge's `relation` is a Neo4j *relationship type*, and everything
else on a node is a *property*. Neo4j's naming rules are the only real
translation -- PascalCase labels, SCREAMING_SNAKE_CASE relationship types.

Neo4j draws this at two levels and so do we:

  schema    the meta-graph -- one circle per label, one arrow per relationship
            type, counts attached as properties. This is what
            `CALL db.schema.visualization()` and `apoc.meta.graph()` return.
  instance  real nodes with real ids, the way Neo4j Browser draws a result set.

Outputs, all regenerated from the graph so a rebuild can never leave a stale
number behind:

  docs/kg-neo4j-schema.json      arrows.app model, importable at arrows.app
  docs/kg-neo4j-instance.json    ditto, for the instance sample
  docs/kg-neo4j-schema.cypher    the schema as Cypher patterns
  docs/kg-neo4j-schema.puml      rendered via `plantuml -tpng`
  docs/kg-neo4j-instance.puml

Usage:  .venv/bin/python kg_neo4j_export.py
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent
GRAPH = BASE / "knowledge_graph.json"
DOCS = BASE / "docs"

# type -> Neo4j node label (PascalCase, per Neo4j's naming conventions).
LABEL = {
    "stream": "Stream",
    "system": "System",
    "document": "Document",
    "process": "Process",
    "spec": "Spec",
}

# Presentation fields the canvas needs; they are not part of the data model.
COSMETIC = {"id", "type", "label", "color", "size", "degree"}

# Fill/border per label, matching TYPE_CONFIG on the Knowledge Graph page.
# Light fills, dark borders -- a dark fill makes the caption unreadable.
PALETTE = {
    "Stream": ("#EDE9FE", "#8B5CF6"),
    "System": ("#E0F2FE", "#0284C7"),
    "Document": ("#F1F5F9", "#64748B"),
    "Process": ("#DCFCE7", "#10B981"),
    "Spec": ("#FFEDD5", "#F97316"),
}

# The instance sample. This one document carries 7 of the 11 relationship
# types across only 7 edges, so it exercises most of the vocabulary without
# turning into a hairball. Chosen by counting distinct relations per document.
SAMPLE_DOC = "doc:SPARK_FS_L2C__SPARK-22877_Interface_Salesforce Complaints_docx.md"

# The ego network drawn by default. Any node id works: `--ego system:S4HANA`,
# `--ego proc:O-020-090`, `--ego spec:SPARK-22877`.
EGO_DEFAULT = "stream:L2C"


def rel_type(relation: str) -> str:
    """belongs_to -> BELONGS_TO."""
    return relation.upper()


def py_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    return "string"


def load() -> dict:
    return json.loads(GRAPH.read_text())


def model(graph: dict) -> dict:
    """Derive the property model: per label, its count and its property types."""
    counts: Counter[str] = Counter()
    props: dict[str, dict[str, str]] = defaultdict(dict)
    for node in graph["nodes"]:
        lab = LABEL[node["type"]]
        counts[lab] += 1
        for key, value in node.items():
            if key in COSMETIC or value in ("", None):
                continue
            props[lab].setdefault(key, py_type(value))

    edges: Counter[tuple[str, str, str]] = Counter()
    by_id = {n["id"]: n for n in graph["nodes"]}
    for edge in graph["edges"]:
        src = LABEL[by_id[edge["source"]]["type"]]
        dst = LABEL[by_id[edge["target"]]["type"]]
        edges[(src, rel_type(edge["relation"]), dst)] += 1

    return {"counts": counts, "props": props, "edges": edges}


# --- arrows.app ---------------------------------------------------------------
# Format taken from neo4j-labs/arrows.app (apps/arrows-ts/src/model): a node is
# {id, position, caption, style, labels, properties} and a relationship is
# {id, type, style, properties, fromId, toId}. `style` at the top level must
# carry every key completeWithDefaults() fills in, or the app falls back to its
# own defaults and the colours are lost.

ARROWS_STYLE = {
    "font-family": "sans-serif",
    "background-color": "#ffffff",
    "background-image": "",
    "background-size": "100%",
    "node-color": "#ffffff",
    "border-width": 4,
    "border-color": "#000000",
    "radius": 50,
    "node-padding": 5,
    "node-margin": 2,
    "outside-position": "auto",
    "node-icon-image": "",
    "node-background-image": "",
    "icon-position": "inside",
    "icon-size": 64,
    "caption-position": "inside",
    "caption-max-width": 200,
    "caption-color": "#000000",
    "caption-font-size": 50,
    "caption-font-weight": "normal",
    "label-position": "inside",
    "label-display": "pill",
    "label-color": "#000000",
    "label-background-color": "#ffffff",
    "label-border-color": "#000000",
    "label-border-width": 4,
    "label-font-size": 40,
    "label-padding": 5,
    "label-margin": 4,
    "directionality": "directed",
    "detail-position": "inline",
    "detail-orientation": "parallel",
    "arrow-width": 5,
    "arrow-color": "#000000",
    "margin-start": 5,
    "margin-end": 5,
    "margin-peer": 20,
    "attachment-start": "normal",
    "attachment-end": "normal",
    "relationship-icon-image": "",
    "type-color": "#000000",
    "type-background-color": "#ffffff",
    "type-border-color": "#000000",
    "type-border-width": 0,
    "type-font-size": 16,
    "type-padding": 5,
    "property-position": "outside",
    "property-alignment": "colon",
    "property-color": "#000000",
    "property-font-size": 16,
    "property-font-weight": "normal",
}


def arrows_node(nid, x, y, labels, properties, caption="", radius=100):
    fill, border = PALETTE[labels[0]]
    return {
        "id": nid,
        "position": {"x": x, "y": y},
        "caption": caption,
        "labels": labels,
        "properties": properties,
        "style": {"node-color": fill, "border-color": border, "radius": radius},
    }


def arrows_rel(rid, from_id, to_id, rel, properties=None):
    return {
        "id": rid,
        "type": rel,
        "fromId": from_id,
        "toId": to_id,
        "properties": properties or {},
        "style": {},
    }


# Star layout: Document in the middle, everything else around it. arrows.app
# y grows downward.
SCHEMA_POS = {
    "Document": (0, 0),
    "Stream": (0, -420),
    "System": (520, 0),
    "Spec": (-520, 0),
    "Process": (0, 420),
}


def schema_arrows(m: dict) -> dict:
    nodes, ids = [], {}
    for i, (lab, (x, y)) in enumerate(SCHEMA_POS.items()):
        ids[lab] = f"n{i}"
        properties = {"count": str(m["counts"][lab])}
        properties.update(m["props"][lab])
        nodes.append(arrows_node(f"n{i}", x, y, [lab], properties))
    rels = [
        arrows_rel(f"r{i}", ids[src], ids[dst], rel, {"count": str(n)})
        for i, ((src, rel, dst), n) in enumerate(sorted(m["edges"].items(), key=lambda kv: -kv[1]))
    ]
    return {"nodes": nodes, "relationships": rels, "style": ARROWS_STYLE}


def instance_arrows(graph: dict) -> dict:
    by_id = {n["id"]: n for n in graph["nodes"]}
    out = [e for e in graph["edges"] if e["source"] == SAMPLE_DOC]
    if not out:
        raise SystemExit(f"sample document not in graph: {SAMPLE_DOC}")

    # Centre the document; stream above, specs left, systems down the right,
    # processes below. Each column is sized from how many neighbours of that
    # label the document actually has -- a fixed slot table breaks the moment a
    # document reaches one more system than it used to.
    column_x = {"Stream": 0, "Spec": -620, "System": 620, "Process": 0}
    column_y = {"Stream": -420, "Process": 420}
    counts: Counter[str] = Counter(LABEL[by_id[e["target"]]["type"]] for e in out)
    slots: dict[str, list[tuple[int, int]]] = {}
    for lab, n in counts.items():
        if lab in column_y:                       # single row above or below
            span = 420
            left = -span * (n - 1) / 2
            slots[lab] = [(int(left + i * span), column_y[lab]) for i in range(n)]
        else:                                     # a column to one side
            step = 320
            top = -step * (n - 1) / 2
            slots[lab] = [(column_x[lab], int(top + i * step)) for i in range(n)]
    used: dict[str, int] = defaultdict(int)

    doc = by_id[SAMPLE_DOC]
    nodes = [arrows_node("n0", 0, 0, ["Document"],
                         {k: str(v) for k, v in doc.items() if k not in COSMETIC},
                         caption=doc["label"], radius=130)]
    ids, rels = {SAMPLE_DOC: "n0"}, []
    for i, edge in enumerate(sorted(out, key=lambda e: e["relation"])):
        target = by_id[edge["target"]]
        lab = LABEL[target["type"]]
        if target["id"] not in ids:
            x, y = slots[lab][used[lab]]
            used[lab] += 1
            nid = f"n{len(ids)}"
            ids[target["id"]] = nid
            nodes.append(arrows_node(nid, x, y, [lab],
                                     {k: str(v) for k, v in target.items() if k not in COSMETIC},
                                     caption=target["label"]))
        rels.append(arrows_rel(f"r{i}", "n0", ids[target["id"]], rel_type(edge["relation"])))
    return {"nodes": nodes, "relationships": rels, "style": ARROWS_STYLE}


# --- Cypher -------------------------------------------------------------------

def schema_cypher(m: dict) -> str:
    lines = [
        "// The Solvay SPARK knowledge graph as a Neo4j schema.",
        "// Generated by kg_neo4j_export.py from knowledge_graph.json.",
        "//",
        f"// {sum(m['counts'].values())} nodes across {len(m['counts'])} labels,",
        f"// {sum(m['edges'].values())} relationships across "
        f"{len({r for _, r, _ in m['edges']})} types.",
        "",
        "// --- node labels and their properties ---",
    ]
    for lab, n in m["counts"].most_common():
        lines.append(f"// (:{lab})  x{n}")
        for key, kind in sorted(m["props"][lab].items()):
            lines.append(f"//     {key}: {kind}")
        lines.append("")
    lines.append("// --- relationship types ---")
    patterns = {k: f"(:{k[0]})-[:{k[1]}]->(:{k[2]})" for k in m["edges"]}
    width = max(len(v) for v in patterns.values())
    for key, n in sorted(m["edges"].items(), key=lambda kv: -kv[1]):
        lines.append(f"// {patterns[key]:<{width}}  x{n}")
    return "\n".join(lines) + "\n"


# --- PlantUML -----------------------------------------------------------------

PUML_HEAD = """@startuml {name}
title {title}

skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam defaultTextAlignment center
skinparam ArrowColor #475569
skinparam ArrowFontColor #0F172A
skinparam ArrowFontSize 11
skinparam ArrowThickness 1.4
skinparam usecase {{
  FontColor #0F172A
  FontSize 13
  BorderThickness 2
}}
skinparam note {{
  BackgroundColor #FFFFFF
  BorderColor #CBD5E1
  FontColor #334155
  FontSize 10
}}
"""


def puml_node(alias: str, caption: str, lab: str, subject: bool = False) -> str:
    # PlantUML wants the border colour without its hash: "#EDE9FE;line:8B5CF6".
    # `subject` bolds the caption of the node an ego diagram is *about*: without
    # it L2C reads as a peer of R2R and I2D rather than the thing being asked
    # about. (";line.bold" is accepted but ignored on a usecase, so it is the
    # text that carries the emphasis.)
    fill, border = PALETTE[lab]
    if subject:
        caption = "**" + caption.replace("\\n", "**\\n**") + "**"
    return f'usecase "{caption}" as {alias} {fill};line:{border.lstrip("#")}'


def schema_puml(m: dict) -> str:
    """The meta-graph, laid out as a star around :Document.

    PlantUML bundles every Document->System arrow into one lane and stacks the
    type names on top of each other, so the direction of each edge is pinned by
    hand: the target label decides which way its arrows leave the centre. The
    count rides on the same line as the type name -- a second line puts it
    halfway down the arrow, far from the name it belongs to.
    """
    out = [PUML_HEAD.format(name="kg-neo4j-schema",
                            title="Solvay SPARK knowledge graph — Neo4j schema (meta-graph)")]
    alias = {lab: lab.upper() for lab in m["counts"]}
    notes = {"Stream": "top", "Spec": "left", "System": "right",
             "Process": "bottom", "Document": "top"}
    for lab in ("Stream", "Spec", "Document", "System", "Process"):
        out.append(puml_node(alias[lab], f":{lab}\\ncount: {m['counts'][lab]}", lab))
        # A note body takes real newlines; "\n" is only honoured inside a label.
        props = "\n".join(f"{k}: {v}" for k, v in sorted(m["props"][lab].items()))
        out.append(f"note {notes[lab]} of {alias[lab]}\n{props}\nend note")
    out.append("")

    # Where each label sits relative to :Document in the star. Edges are
    # emitted arm by arm, busiest first inside each arm: interleaving the
    # directions lets PlantUML park the :SPECIFIES_PROCESS label up among the
    # :System bundle, where it reads as one more System edge.
    direction = {"Stream": "up", "Spec": "left", "System": "right", "Process": "down"}
    arm = {"Stream": 0, "Spec": 1, "System": 2, "Process": 3}
    order = sorted(m["edges"].items(), key=lambda kv: (arm[kv[0][2]], -kv[1]))
    for (src, rel, dst), n in order:
        if src == dst:                       # the :Process self-loop
            out.append(f'{alias[src]} --> {alias[dst]} : ":{rel} · {n}"')
            continue
        out.append(f'{alias[src]} -{direction[dst]}-> {alias[dst]} : ":{rel} · {n}"')
    out.append("@enduml")
    return "\n".join(out) + "\n"


def instance_puml(graph: dict) -> str:
    """The same document as a Neo4j Browser result set: real ids, real edges.

    Laid out as a star for the same reason the schema is -- left to itself
    PlantUML fans every neighbour out in one flat row, which stops looking like
    a graph and starts looking like an org chart.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    out_edges = sorted((e for e in graph["edges"] if e["source"] == SAMPLE_DOC),
                       key=lambda e: e["relation"])
    doc = by_id[SAMPLE_DOC]
    out = [PUML_HEAD.format(name="kg-neo4j-instance",
                            title="One :Document and its neighbours — as Neo4j Browser draws a result set")]

    # The filename is the caption and it is far too long for one line; the
    # underscores that separate its parts are the natural wrap points.
    words = doc["label"].replace("__", "_").replace("_", " ").split()
    lines, row = [], ""
    for word in words:
        if len(row) + len(word) + 1 > 26:
            lines.append(row)
            row = word
        else:
            row = f"{row} {word}".strip()
    lines.append(row)
    out.append(puml_node("DOC", ":Document\\n" + "\\n".join(lines), "Document"))

    direction = {"Stream": "up", "Spec": "left", "System": "right", "Process": "down"}
    arm = {"Stream": 0, "Spec": 1, "System": 2, "Process": 3}
    seen = {}
    for e in out_edges:
        t = by_id[e["target"]]
        if t["id"] not in seen:
            alias = t["type"].upper() + str(len(seen))
            seen[t["id"]] = alias
            out.append(puml_node(alias, f':{LABEL[t["type"]]}\\n{t["label"]}', LABEL[t["type"]]))
    # Four :System nodes all pointed "right" land in one row and their type
    # names collide above them. A hidden edge between siblings stacks each
    # label's nodes into a column instead, without drawing anything.
    column: dict[str, list[str]] = defaultdict(list)
    for nid, alias in seen.items():
        column[LABEL[by_id[nid]["type"]]].append(alias)
    out.append("")
    for members in column.values():
        for above, below in zip(members, members[1:]):
            out.append(f"{above} -[hidden]down- {below}")

    out.append("")
    for e in sorted(out_edges, key=lambda e: (arm[LABEL[by_id[e["target"]]["type"]]], e["relation"])):
        lab = LABEL[by_id[e["target"]]["type"]]
        out.append(f'DOC -{direction[lab]}-> {seen[e["target"]]} : ":{rel_type(e["relation"])}"')
    out.append("@enduml")
    return "\n".join(out) + "\n"


# --- ego network ---------------------------------------------------------------
# "How is stream:L2C connected to everything else?" is a two-hop question, not a
# one-hop one: a :Stream has no edge to a :System anywhere in the graph. Its only
# direct neighbours are the documents that named it, and the systems, processes
# and tickets hang off those. Neo4j answers this with
#
#   MATCH (s:Stream {code: 'L2C'})<-[:BELONGS_TO]-(d:Document)-[r]->(n)
#   RETURN type(r), labels(n), count(*)
#
# and that count(*) is the point -- 48 documents reaching 543 tickets is a
# hairball drawn literally, so the middle is drawn once and annotated.

def neighbourhood(graph: dict, node_id: str) -> dict:
    """Two hops out from one node, aggregated by relationship type and label."""
    by_id = {n["id"]: n for n in graph["nodes"]}
    if node_id not in by_id:
        raise SystemExit(f"no such node: {node_id}")
    out, inc = defaultdict(list), defaultdict(list)
    for e in graph["edges"]:
        out[e["source"]].append(e)
        inc[e["target"]].append(e)

    # Hop one: whatever touches it, in either direction.
    first = [(e, "in") for e in inc[node_id]] + [(e, "out") for e in out[node_id]]
    hop1 = Counter((e["relation"], direction) for e, direction in first)
    bridges = [e["source"] if d == "in" else e["target"] for e, d in first]

    # Hop two: where those neighbours go next, skipping the way we came.
    named: dict[str, Counter] = defaultdict(Counter)   # small labels, by name
    bulk: dict[str, Counter] = defaultdict(Counter)    # big labels, by count
    distinct: dict[str, set] = defaultdict(set)
    for b in bridges:
        for e in out[b]:
            if e["target"] == node_id:
                continue
            t = by_id[e["target"]]
            lab = LABEL[t["type"]]
            distinct[lab].add(e["target"])
            if lab in ("System", "Stream"):           # fixed lists, safe to name
                named[t["label"]][rel_type(e["relation"])] += 1
            else:
                bulk[lab][rel_type(e["relation"])] += 1

    return {
        "node": by_id[node_id],
        "hop1": hop1,
        "bridge_label": LABEL[by_id[bridges[0]]["type"]] if bridges else "",
        "bridges": len(set(bridges)),
        "named": named,
        "bulk": bulk,
        "distinct": {k: len(v) for k, v in distinct.items()},
    }


def ego_puml(graph: dict, node_id: str, name: str = "kg-neo4j-ego") -> str:
    """One node, its bridge bundle, and everything two hops out.

    Four arms, not one fan: the subject sits above the bundle, the systems hang
    below it, the other streams go right and the bulk labels left. Pointing all
    eleven targets the same way makes PlantUML stack every relationship name in
    one strip at the top, where none of them can be read.
    """
    n = neighbourhood(graph, node_id)
    node, lab = n["node"], LABEL[n["node"]["type"]]
    out = [PUML_HEAD.format(
        name=name,
        title=f'{node["label"]} — everything it reaches, and what it reaches through')]

    out.append(puml_node("EGO", f':{lab}\\n{node["label"]}', lab, subject=True))
    bridge = n["bridge_label"]
    out.append(puml_node("HUB", f':{bridge}\\n×{n["bridges"]}', bridge))
    out.append("")

    # Hop one. The subject goes above the bundle whichever way the edge points.
    for (rel, direction), count in n["hop1"].most_common():
        arrow = "HUB -up-> EGO" if direction == "in" else "EGO -down-> HUB"
        out.append(f'{arrow} : ":{rel_type(rel)} ×{count}"')
    out.append("")

    stream_names = {t["label"] for t in graph["nodes"] if t["type"] == "stream"}
    arms: dict[str, list[str]] = defaultdict(list)

    for i, (name_, rels) in enumerate(sorted(n["named"].items(),
                                             key=lambda kv: -sum(kv[1].values()))):
        alias = f"N{i}"
        target_lab = "Stream" if name_ in stream_names else "System"
        # A sibling of the subject goes right; a system goes below.
        side = "right" if target_lab == lab else "down"
        arms[side].append(alias)
        out.append(puml_node(alias, f":{target_lab}\\n{name_}", target_lab))
        for rel, count in rels.most_common():
            out.append(f'HUB -{side}-> {alias} : ":{rel} ×{count}"')

    for j, (target_lab, rels) in enumerate(sorted(n["bulk"].items(),
                                                  key=lambda kv: -sum(kv[1].values()))):
        alias = f"B{j}"
        arms["left"].append(alias)
        out.append(puml_node(alias, f':{target_lab}\\n{n["distinct"][target_lab]} distinct', target_lab))
        for rel, count in rels.most_common():
            out.append(f'HUB -left-> {alias} : ":{rel} ×{count}"')

    # Stack each arm so it grows away from the bundle instead of sideways.
    out.append("")
    for side, members in arms.items():
        grow = "right" if side == "down" else "down"
        for a, b in zip(members, members[1:]):
            out.append(f"{a} -[hidden]{grow}- {b}")
    out.append("@enduml")
    return "\n".join(out) + "\n"


def ego_arrows(graph: dict, node_id: str) -> dict:
    n = neighbourhood(graph, node_id)
    node, lab = n["node"], LABEL[n["node"]["type"]]
    nodes = [arrows_node("n0", 0, -500, [lab],
                         {k: str(v) for k, v in node.items() if k not in COSMETIC},
                         caption=node["label"], radius=130),
             arrows_node("n1", 0, 0, [n["bridge_label"]],
                         {"count": str(n["bridges"])},
                         caption=f'×{n["bridges"]}', radius=110)]
    rels = []
    for i, ((rel, direction), count) in enumerate(n["hop1"].most_common()):
        a, b = ("n1", "n0") if direction == "in" else ("n0", "n1")
        rels.append(arrows_rel(f"r{i}", a, b, rel_type(rel), {"count": str(count)}))

    stream_names = {s["label"] for s in graph["nodes"] if s["type"] == "stream"}
    spread = list(n["named"].items()) + [(k, v) for k, v in n["bulk"].items()]
    step = 380
    left = -step * (len(spread) - 1) / 2
    for i, (name, relcounts) in enumerate(spread):
        nid = f"n{i + 2}"
        if name in n["bulk"]:
            target_lab, caption, props = name, f'{n["distinct"][name]} distinct', {
                "count": str(n["distinct"][name])}
        else:
            target_lab = "Stream" if name in stream_names else "System"
            caption, props = name, {}
        nodes.append(arrows_node(nid, int(left + i * step), 520, [target_lab], props,
                                 caption=caption))
        for rel, count in relcounts.most_common():
            rels.append(arrows_rel(f"r{len(rels)}", "n1", nid, rel, {"count": str(count)}))
    return {"nodes": nodes, "relationships": rels, "style": ARROWS_STYLE}


def main() -> None:
    graph = load()
    m = model(graph)

    ego_id = EGO_DEFAULT
    if "--ego" in sys.argv:
        ego_id = sys.argv[sys.argv.index("--ego") + 1]
    slug = re.sub(r"[^a-z0-9]+", "-", ego_id.lower()).strip("-")

    writes = {
        "kg-neo4j-schema.json": json.dumps(schema_arrows(m), indent=2) + "\n",
        "kg-neo4j-instance.json": json.dumps(instance_arrows(graph), indent=2) + "\n",
        "kg-neo4j-schema.cypher": schema_cypher(m),
        "kg-neo4j-schema.puml": schema_puml(m),
        "kg-neo4j-instance.puml": instance_puml(graph),
        f"kg-neo4j-ego-{slug}.puml": ego_puml(graph, ego_id, f"kg-neo4j-ego-{slug}"),
        f"kg-neo4j-ego-{slug}.json": json.dumps(ego_arrows(graph, ego_id), indent=2) + "\n",
    }
    for name, text in writes.items():
        (DOCS / name).write_text(text)
        print(f"  wrote docs/{name}  ({len(text):,} bytes)")

    print(f"\n{sum(m['counts'].values())} nodes / {sum(m['edges'].values())} relationships")
    for lab, n in m["counts"].most_common():
        print(f"  :{lab:<10} {n:>4}")
    print()
    for (src, rel, dst), n in sorted(m["edges"].items(), key=lambda kv: -kv[1]):
        print(f"  (:{src})-[:{rel}]->(:{dst})  x{n}")

    ego = neighbourhood(graph, ego_id)
    print(f"\nego network of {ego_id} ({ego['node']['label']}):")
    for (rel, direction), c in ego["hop1"].most_common():
        arrow = "<-" if direction == "in" else "->"
        print(f"  hop 1  {arrow} :{rel_type(rel)} x{c}  ({ego['bridges']} distinct :{ego['bridge_label']})")
    for name, rels in sorted(ego["named"].items(), key=lambda kv: -sum(kv[1].values())):
        print(f"  hop 2  {name:<24} " + ", ".join(f":{r} x{c}" for r, c in rels.most_common()))
    for lab, rels in sorted(ego["bulk"].items(), key=lambda kv: -sum(kv[1].values())):
        print(f"  hop 2  :{lab:<23} {ego['distinct'][lab]} distinct via "
              + ", ".join(f":{r} x{c}" for r, c in rels.most_common()))


if __name__ == "__main__":
    main()
