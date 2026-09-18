"""
knowledge_graph.py — Entity & Relationship Extraction Engine for Docling Studio.

Extracts a semantic enterprise knowledge graph from Markdown documents located in
solvay-spark/pkg/markdown/ and knowledge_base/.
Discovers:
- Business Streams (L2C, I2D, R2R, P2P)
- Core Enterprise Systems (SAP S/4HANA, SAP ECC, Salesforce, SOVOS, Fiori, eCommerce)
- BPML Process Codes & Subprocesses (O-xxx-xxx, M-xxx-xxx, L-xxx-xxx)
- SPARK Functional Specifications & Enhancements (SPARK-XXXXX)
- Source Documents with metadata & relationships
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger("docling_studio.graph")

BASE_DIR = Path(__file__).resolve().parent
SOLVAY_DIR = BASE_DIR / "solvay-spark" / "pkg" / "markdown"
KB_DIR = BASE_DIR / "knowledge_base"
CACHE_FILE = BASE_DIR / "knowledge_graph.json"

# Core Enterprise Streams
STREAMS = {
    "L2C": {
        "label": "Lead to Cash (L2C)",
        "desc": "End-to-end sales order management, pricing, billing, logistics, and customer collections.",
        "color": "#8b5cf6",
    },
    "I2D": {
        "label": "Idea to Delivery (I2D)",
        "desc": "Transit times, shipping logistics, warehouse operations, and physical goods delivery.",
        "color": "#ec4899",
    },
    "R2R": {
        "label": "Record to Report (R2R)",
        "desc": "Financial accounting, commissions settlement, general ledger, and financial reporting.",
        "color": "#10b981",
    },
    "P2P": {
        "label": "Procure to Pay (P2P)",
        "desc": "Procurement, vendor purchase orders, goods receipt, and invoice verification.",
        "color": "#f59e0b",
    },
}

# Core Systems
SYSTEMS = {
    "S4HANA": {
        "label": "SAP S/4HANA",
        "desc": "Target ERP platform for global sales, billing, master data, and central finance.",
        "color": "#0284c7",
    },
    "ECC": {
        "label": "SAP ECC",
        "desc": "Legacy ERP environment being migrated to SAP S/4HANA under Solvay SPARK.",
        "color": "#475569",
    },
    "Salesforce": {
        "label": "Salesforce (CRM)",
        "desc": "Customer relationship management platform handling customer complaints, accounts, and order intake.",
        "color": "#0ea5e9",
    },
    "SOVOS": {
        "label": "SOVOS (Tax Engine)",
        "desc": "Global tax determination and automated electronic compliance engine integrated with billing.",
        "color": "#dc2626",
    },
    "Fiori": {
        "label": "SAP Fiori",
        "desc": "Modern UX role-based applications for custom enhancements and business user dashboards.",
        "color": "#2563eb",
    },
    "eCommerce": {
        "label": "Solvay@eCommerce",
        "desc": "Digital portal for customer direct ordering, product catalog, and invoice visibility.",
        "color": "#16a34a",
    },
}

CODE_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9]{0,3})-(\d{2,3}(?:-\d{2,3})+)\b")
TICKET_RE = re.compile(r"\bSPARK[-_ ]?(\d{4,6})\b", re.I)


def extract_graph(force: bool = False) -> dict[str, Any]:
    """Extracts entities and relations from all markdown files in solvay-spark and knowledge_base."""
    if not force and CACHE_FILE.is_file():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("nodes") and data.get("edges"):
                    return data
        except Exception as e:
            logger.warning("Failed to load cached graph: %s", e)

    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str]] = set()

    def add_node(id_: str, label: str, type_: str, **props):
        if id_ not in nodes:
            nodes[id_] = {"id": id_, "label": label, "type": type_, **props}

    def add_edge(src: str, tgt: str, relation: str, label: str = ""):
        key = (src, tgt, relation)
        if key not in seen_edges and src in nodes and tgt in nodes:
            seen_edges.add(key)
            edges.append(
                {
                    "id": f"{src}->{tgt}:{relation}",
                    "source": src,
                    "target": tgt,
                    "relation": relation,
                    "label": label or relation.replace("_", " "),
                }
            )

    # 1. Add Stream Hub Nodes
    for sid, sinfo in STREAMS.items():
        add_node(
            f"stream:{sid}",
            sinfo["label"],
            "stream",
            code=sid,
            description=sinfo["desc"],
            color=sinfo["color"],
        )

    # 2. Add System Nodes
    for sys_id, sys_info in SYSTEMS.items():
        add_node(
            f"system:{sys_id}",
            sys_info["label"],
            "system",
            code=sys_id,
            description=sys_info["desc"],
            color=sys_info["color"],
        )

    # 3. Gather Markdown Files
    files_to_process: list[tuple[Path, str]] = []
    if SOLVAY_DIR.is_dir():
        for p in sorted(SOLVAY_DIR.glob("*.md")):
            if not p.name.startswith((".", "~$")):
                files_to_process.append((p, f"solvay-spark/pkg/markdown/{p.name}"))
    if KB_DIR.is_dir():
        for p in sorted(KB_DIR.glob("*.md")):
            if not p.name.startswith((".", "~$")):
                # Avoid duplicate names if already collected
                if not any(f[0].name == p.name for f in files_to_process):
                    files_to_process.append((p, f"knowledge_base/{p.name}"))

    # Track process descriptions if found in content
    proc_descriptions: dict[str, str] = {}

    for path, rel_source in files_to_process:
        doc_id = f"doc:{path.name}"
        title = path.stem
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        # Format detection
        m_title = re.search(r"\((\w+)\)$", title.strip())
        m_fmt = re.search(r"_([a-zA-Z0-9]+)\.md$", path.name)
        if m_title:
            fmt = m_title.group(1).upper()
        elif m_fmt and m_fmt.group(1).lower() not in ("md", "markdown"):
            fmt = m_fmt.group(1).upper()
        else:
            fmt = path.suffix.replace(".", "").upper() or "MD"

        add_node(
            doc_id,
            title,
            "document",
            filename=path.name,
            source=rel_source,
            format=fmt,
            size=path.stat().st_size,
            chars=len(content),
            color="#64748b",
        )

        # Connect Document to Stream
        for sid in STREAMS:
            if sid.lower() in path.name.lower() or sid in content[:600]:
                add_edge(doc_id, f"stream:{sid}", "belongs_to", "Belongs to Stream")

        # Connect Document to Systems
        if any(k in content for k in ["S/4", "S4", "S4HANA", "S/4HANA"]):
            add_edge(doc_id, "system:S4HANA", "runs_on", "Executes on S/4")
        if "ECC" in content:
            add_edge(doc_id, "system:ECC", "interacts_with", "Interacts with ECC")
        if "Salesforce" in content or "salesforce" in content:
            add_edge(doc_id, "system:Salesforce", "integrates_with", "Integrates with CRM")
        if "SOVOS" in content or "sovos" in content:
            add_edge(doc_id, "system:SOVOS", "interfaces_with", "Tax Engine Interface")
        if "Fiori" in content or "fiori" in content:
            add_edge(doc_id, "system:Fiori", "uses_ui", "Fiori Custom App")
        if "eCommerce" in content or "ecommerce" in content:
            add_edge(doc_id, "system:eCommerce", "connects_to", "eCommerce Portal")

        # Extract BPML Process Codes
        found_codes = set(CODE_RE.findall(content))
        for prefix, code_num in found_codes:
            full_code = f"{prefix}-{code_num}"
            proc_id = f"proc:{full_code}"

            # Extract possible short title or header near the code
            match_line = ""
            for line in content.splitlines():
                if full_code in line and len(line.strip()) < 100:
                    match_line = line.strip().strip("#* -")
                    break

            add_node(
                proc_id,
                full_code,
                "process",
                code=full_code,
                description=match_line or f"BPML Process Step {full_code}",
                color="#10b981",
            )
            add_edge(doc_id, proc_id, "specifies_process", "Specifies Process")

            # Hierarchy: Link sub-process to parent process
            parts = code_num.split("-")
            if len(parts) > 1:
                parent_code = f"{prefix}-" + "-".join(parts[:-1])
                parent_id = f"proc:{parent_code}"
                add_node(
                    parent_id,
                    parent_code,
                    "process",
                    code=parent_code,
                    description=f"Parent Process {parent_code}",
                    color="#059669",
                )
                add_edge(proc_id, parent_id, "subprocess_of", "Subprocess of")

        # Extract Tickets / Functional Specifications
        found_tickets = set(TICKET_RE.findall(content))
        for t_num in found_tickets:
            ticket_id = f"SPARK-{t_num}"
            t_node = f"spec:{ticket_id}"

            # Check if this document is the primary spec for this ticket
            is_primary = ticket_id.lower() in path.name.lower()

            add_node(
                t_node,
                ticket_id,
                "spec",
                ticket=ticket_id,
                is_primary=is_primary,
                color="#f97316" if is_primary else "#fb923c",
            )
            add_edge(
                doc_id,
                t_node,
                "implements_ticket" if is_primary else "references_ticket",
                "Primary Specification" if is_primary else "References Ticket",
            )

    # Compute node degrees (number of connections) for sizing
    degrees: dict[str, int] = defaultdict(int)
    for edge in edges:
        degrees[edge["source"]] += 1
        degrees[edge["target"]] += 1

    for nid, node in nodes.items():
        node["degree"] = degrees[nid]
        # Calculate dynamic display size based on connectivity
        if node["type"] == "stream":
            node["size"] = 28 + min(node["degree"] * 0.4, 20)
        elif node["type"] == "system":
            node["size"] = 22 + min(node["degree"] * 0.3, 16)
        elif node["type"] == "document":
            node["size"] = 12 + min(node["degree"] * 0.5, 12)
        elif node["type"] == "process":
            node["size"] = 10 + min(node["degree"] * 0.5, 10)
        else:  # spec
            node["size"] = 9 + min(node["degree"] * 0.5, 10)

    # Type counts
    by_type: dict[str, int] = defaultdict(int)
    for n in nodes.values():
        by_type[n["type"]] += 1

    result = {
        "nodes": list(nodes.values()),
        "edges": edges,
        "stats": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "types": dict(by_type),
            "streams": list(STREAMS.keys()),
            "systems": list(SYSTEMS.keys()),
        },
    }

    # Cache to disk
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
    except Exception as e:
        logger.warning("Failed to cache graph: %s", e)

    return result


def find_shortest_path(
    graph_data: dict[str, Any], start_id: str, end_id: str
) -> dict[str, Any] | None:
    """Finds the shortest path between two nodes using Breadth-First Search (BFS)."""
    if start_id == end_id:
        return {"nodes": [start_id], "edges": [], "hops": 0}

    nodes_map = {n["id"]: n for n in graph_data["nodes"]}
    if start_id not in nodes_map or end_id not in nodes_map:
        return None

    # Build undirected adjacency
    adj = defaultdict(list)
    for e in graph_data["edges"]:
        adj[e["source"]].append((e["target"], e["id"], e["relation"]))
        adj[e["target"]].append((e["source"], e["id"], e["relation"]))

    queue = [(start_id, [start_id], [])]
    visited = {start_id}

    while queue:
        curr, path_nodes, path_edges = queue.pop(0)

        for neighbor, edge_id, rel in adj[curr]:
            if neighbor == end_id:
                final_nodes = path_nodes + [neighbor]
                final_edges = path_edges + [edge_id]
                return {
                    "nodes": final_nodes,
                    "edges": final_edges,
                    "hops": len(final_edges),
                    "steps": [
                        {
                            "from_id": final_nodes[i],
                            "from": nodes_map[final_nodes[i]]["label"],
                            "from_type": nodes_map[final_nodes[i]]["type"],
                            "to_id": final_nodes[i + 1],
                            "to": nodes_map[final_nodes[i + 1]]["label"],
                            "to_type": nodes_map[final_nodes[i + 1]]["type"],
                            "relation": rel,
                        }
                        for i in range(len(final_edges))
                    ],
                }

            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path_nodes + [neighbor], path_edges + [edge_id]))

    return None


def generate_graph_answer(query: str, res: dict[str, Any], graph: dict[str, Any]) -> str:
    """Generates a structured, rich Markdown answer grounded in the knowledge graph."""
    nodes_map = {n["id"]: n for n in graph["nodes"]}
    node_ids = res.get("node_ids", [])
    edge_ids = res.get("edge_ids", [])
    mode = res.get("mode", "subgraph")
    path = res.get("path")

    matched_nodes = [nodes_map[nid] for nid in node_ids if nid in nodes_map]
    systems = [n for n in matched_nodes if n["type"] == "system"]
    streams = [n for n in matched_nodes if n["type"] == "stream"]
    processes = [n for n in matched_nodes if n["type"] == "process"]
    specs = [n for n in matched_nodes if n["type"] == "spec"]
    docs = [n for n in matched_nodes if n["type"] == "document"]

    parts: list[str] = []

    # Direct Answer Header
    parts.append(f"### Direct Answer: *\"{query}\"*\n")

    if mode == "path" and path and path.get("steps"):
        start_id = path["nodes"][0]
        end_id = path["nodes"][-1]
        s_name = nodes_map.get(start_id, {}).get("label", start_id)
        e_name = nodes_map.get(end_id, {}).get("label", end_id)
        hops = path["hops"]

        parts.append(
            f"In the Solvay SPARK enterprise architecture, **{s_name}** communicates with **{e_name}** through a **{hops}-hop integration route** "
            f"mediated by functional interface specifications and data conversion flows.\n"
        )

        parts.append("#### Multi-Hop Integration Path:")
        for idx, step in enumerate(path["steps"], 1):
            fr_lbl = step["from"]
            fr_type = step.get("from_type", "entity").upper()
            to_lbl = step["to"]
            to_type = step.get("to_type", "entity").upper()
            rel = step["relation"].replace("_", " ").title()
            parts.append(f"{idx}. `[{fr_type}]` **{fr_lbl}** ➔ *({rel})* ➔ `[{to_type}]` **{to_lbl}**")
        parts.append("")

    else:
        anchors = [n["label"] for n in matched_nodes if n["type"] in ("system", "stream")]
        anchor_txt = ", ".join(anchors[:3]) if anchors else "the Solvay SPARK architecture"
        parts.append(
            f"Based on the Solvay SPARK Knowledge Graph, your question relates to **{anchor_txt}**, "
            f"identifying **{len(matched_nodes)} connected entities** and **{len(edge_ids)} documented architectural relationships**.\n"
        )

    # Enterprise Systems & Business Streams
    if systems or streams:
        parts.append("#### Core Enterprise Systems & Streams:")
        for s in systems[:6]:
            desc = s.get("description") or "Core technical system in Solvay SPARK."
            code = s.get("code") or s["id"]
            lbl = s["label"]
            parts.append(f"- **{lbl}** (`{code}`): {desc}")
        for st in streams[:4]:
            desc = st.get("description") or "Business process stream."
            lbl = st["label"]
            parts.append(f"- **{lbl}** Stream: {desc}")
        parts.append("")

    # Specifications & JIRA Tickets
    if specs:
        parts.append(f"#### SPARK Functional Specifications ({len(specs)}):")
        for sp in specs[:10]:
            ticket = sp.get("ticket") or sp.get("code") or sp["label"]
            desc = sp.get("description")
            if not desc or desc == ticket:
                for e in graph["edges"]:
                    if (e["source"] == sp["id"] or e["target"] == sp["id"]) and "doc:" in (e["source"] + e["target"]):
                        doc_id = e["source"] if "doc:" in e["source"] else e["target"]
                        doc_node = nodes_map.get(doc_id)
                        if doc_node:
                            clean_doc = (
                                doc_node["label"]
                                .replace(".md", "")
                                .replace("_docx", "")
                                .replace("_xlsx", "")
                                .replace("_", " ")
                            )
                            desc = clean_doc
                            break
            desc_str = f" - *{desc}*" if desc and desc != ticket else ""
            parts.append(f"- **{ticket}**{desc_str}")
        if len(specs) > 10:
            parts.append(f"- *...and {len(specs) - 10} more specifications in this cluster.*")
        parts.append("")

    # BPML Processes
    if processes:
        parts.append(f"#### BPML Business Processes ({len(processes)}):")
        for p in processes[:8]:
            code = p.get("code") or p["label"]
            parts.append(f"- **{code}**: {p['label']}")
        if len(processes) > 8:
            parts.append(f"- *...and {len(processes) - 8} more processes.*")
        parts.append("")

    # Source Documents
    if docs:
        parts.append("#### Source Specification Documents:")
        for d in docs[:5]:
            fname = d.get("filename") or d["label"]
            chars = d.get("chars", 0)
            parts.append(f"- 📄 `{fname}` ({chars:,} chars)")
        if len(docs) > 5:
            parts.append(f"- *...and {len(docs) - 5} additional source documents.*")

    return "\n".join(parts)


def query_graph(
    query: str = "",
    source_id: str | None = None,
    target_id: str | None = None,
) -> dict[str, Any]:
    """Intelligently queries the knowledge graph via natural language, pathfinding, or entity matching."""
    graph = extract_graph()
    nodes_map = {n["id"]: n for n in graph["nodes"]}
    edges = graph["edges"]

    # Direct Pathfinding if source and target IDs given
    if source_id and target_id:
        path = find_shortest_path(graph, source_id, target_id)
        if path:
            s_label = nodes_map.get(source_id, {}).get("label", source_id)
            t_label = nodes_map.get(target_id, {}).get("label", target_id)
            res = {
                "query": f"Path from {s_label} to {t_label}",
                "mode": "path",
                "summary": f"Found shortest integration path between '{s_label}' and '{t_label}' ({path['hops']} hops).",
                "node_ids": path["nodes"],
                "edge_ids": path["edges"],
                "path": path,
                "stats": {"nodes_count": len(path["nodes"]), "edges_count": len(path["edges"])},
            }
            res["answer"] = generate_graph_answer(query or res["query"], res, graph)
            return res
        else:
            res = {
                "query": f"Path from {source_id} to {target_id}",
                "mode": "path",
                "summary": f"No direct or indirect path found connecting '{source_id}' and '{target_id}'.",
                "node_ids": [source_id, target_id],
                "edge_ids": [],
                "stats": {"nodes_count": 2, "edges_count": 0},
            }
            res["answer"] = f"No integration path was found in the Solvay SPARK Knowledge Graph between `{source_id}` and `{target_id}`."
            return res

    q = query.strip().lower()

    # Detect Natural Language Path query (e.g. "path between X and Y", "how does X connect to Y", "difference between X and Y")
    path_match = (
        re.search(
            r"(?:how does|how do)\s+([a-zA-Z0-9@_ /-]+?)\s+(?:connect|link|integrate|talk)\s+(?:to|with)\s+([a-zA-Z0-9@_ /?-]+)",
            q,
            re.I,
        )
        or re.search(
            r"(?:path|connection|link|integration|flow|difference|compare|relationship)\s+(?:between|from|of)\s+([a-zA-Z0-9@_ /-]+?)\s+(?:and|to|with|vs|versus)\s+([a-zA-Z0-9@_ /?-]+)",
            q,
            re.I,
        )
        or re.search(r"^([a-zA-Z0-9@_ /-]+?)\s+(?:to|->)\s+([a-zA-Z0-9@_ /-]+)$", q)
    )

    if path_match:
        from_str = path_match.group(1).strip().lower().rstrip("?").rstrip(".")
        to_str = path_match.group(2).strip().lower().rstrip("?").rstrip(".")

        # Find best matching node IDs
        def find_best_node(term: str) -> str | None:
            t = term.strip().lower().rstrip("?").rstrip(".")
            for n in graph["nodes"]:
                if t == n["label"].lower() or t == n["id"].lower() or (n.get("code") and t == n["code"].lower()):
                    return n["id"]
            for n in graph["nodes"]:
                if t in n["label"].lower() or t in n["id"].lower() or (n.get("code") and t in n["code"].lower()):
                    return n["id"]
            return None

        n1 = find_best_node(from_str)
        n2 = find_best_node(to_str)
        if n1 and n2 and n1 != n2:
            path = find_shortest_path(graph, n1, n2)
            if path:
                res = {
                    "query": query,
                    "mode": "path",
                    "summary": f"Discovered integration path between '{nodes_map[n1]['label']}' and '{nodes_map[n2]['label']}' ({path['hops']} hops).",
                    "node_ids": path["nodes"],
                    "edge_ids": path["edges"],
                    "path": path,
                    "stats": {"nodes_count": len(path["nodes"]), "edges_count": len(path["edges"])},
                }
                res["answer"] = generate_graph_answer(query, res, graph)
                return res

    # Entity neighborhood / pattern query
    matched_nodes_set: set[str] = set()
    matched_edges_set: set[str] = set()

    # Check for specific system or stream keywords
    target_type_filter: str | None = None
    if "spec" in q or "ticket" in q:
        target_type_filter = "spec"
    elif "process" in q or "bpml" in q:
        target_type_filter = "process"
    elif "doc" in q or "markdown" in q or "file" in q:
        target_type_filter = "document"

    # Find anchor nodes mentioned in the query
    anchor_nodes: list[dict[str, Any]] = []
    for n in graph["nodes"]:
        n_label = n["label"].lower()
        n_id = n["id"].lower()
        n_code = (n.get("code") or "").lower()
        n_ticket = (n.get("ticket") or "").lower()

        # Exact or strong partial match
        if (
            (len(q) > 2 and q in n_label)
            or (n_code and n_code in q)
            or (n_ticket and n_ticket in q)
            or (n_id in q)
        ):
            anchor_nodes.append(n)

    if not anchor_nodes:
        # Fallback: token matching
        tokens = [t for t in re.split(r"\W+", q) if len(t) > 2 and t not in ("all", "find", "show", "what", "with", "for", "the", "and", "path", "between", "from", "specs", "documents")]
        for n in graph["nodes"]:
            if any(t in n["label"].lower() for t in tokens):
                anchor_nodes.append(n)

    # If anchor nodes found, expand to 1-hop or 2-hop neighborhood
    if anchor_nodes:
        # Limit anchors to top 5 to keep visualization clean
        primary_anchors = sorted(anchor_nodes, key=lambda x: x.get("degree", 0), reverse=True)[:5]
        for a in primary_anchors:
            matched_nodes_set.add(a["id"])

        if target_type_filter:
            # 2-hop search: Find target entities via intermediate document/system bridges
            hop1_bridges: set[str] = set()
            for e in edges:
                src, tgt = e["source"], e["target"]
                if src in matched_nodes_set or tgt in matched_nodes_set:
                    other = tgt if src in matched_nodes_set else src
                    other_node = nodes_map.get(other)
                    if other_node:
                        if other_node["type"] == target_type_filter:
                            matched_nodes_set.add(other)
                            matched_edges_set.add(e["id"])
                        elif other_node["type"] in ("document", "system", "stream"):
                            hop1_bridges.add(other)

            # Hop 2 from bridges to target_type_filter
            target_hits: set[str] = set()
            for e in edges:
                src, tgt = e["source"], e["target"]
                if src in hop1_bridges or tgt in hop1_bridges:
                    bridge = src if src in hop1_bridges else tgt
                    other = tgt if src in hop1_bridges else src
                    other_node = nodes_map.get(other)
                    if other_node and other_node["type"] == target_type_filter:
                        matched_nodes_set.add(bridge)
                        matched_nodes_set.add(other)
                        target_hits.add(other)
                        matched_edges_set.add(e["id"])

            # Also add edges from anchors to the retained bridges
            for e in edges:
                if (e["source"] in matched_nodes_set and e["target"] in matched_nodes_set) and (
                    e["source"] in [a["id"] for a in primary_anchors] or e["target"] in [a["id"] for a in primary_anchors]
                ):
                    matched_edges_set.add(e["id"])

            anchor_labels = ", ".join(f"'{a['label']}'" for a in primary_anchors[:3])
            type_label = target_type_filter.capitalize() + "s"
            summary = f"Discovered {len(target_hits)} {type_label} connected to {anchor_labels} across {len(matched_nodes_set)} total entities."
        else:
            for e in edges:
                src, tgt = e["source"], e["target"]
                if src in matched_nodes_set or tgt in matched_nodes_set:
                    other = tgt if src in matched_nodes_set else src
                    other_node = nodes_map.get(other)
                    if other_node:
                        matched_nodes_set.add(other)
                        matched_edges_set.add(e["id"])

            anchor_labels = ", ".join(f"'{a['label']}'" for a in primary_anchors[:3])
            summary = f"Found {len(matched_nodes_set)} nodes and {len(matched_edges_set)} relationships connected to {anchor_labels}."
    else:
        # Fallback: global search across all nodes
        for n in graph["nodes"]:
            if q in n["label"].lower() or q in (n.get("description") or "").lower():
                matched_nodes_set.add(n["id"])

        # Include connecting edges between matched nodes
        for e in edges:
            if e["source"] in matched_nodes_set and e["target"] in matched_nodes_set:
                matched_edges_set.add(e["id"])

        summary = f"Matched {len(matched_nodes_set)} entities for '{query}'."

    res = {
        "query": query,
        "mode": "subgraph",
        "summary": summary,
        "node_ids": list(matched_nodes_set),
        "edge_ids": list(matched_edges_set),
        "stats": {
            "nodes_count": len(matched_nodes_set),
            "edges_count": len(matched_edges_set),
        },
    }
    res["answer"] = generate_graph_answer(query, res, graph)
    return res


if __name__ == "__main__":
    data = extract_graph(force=True)
    print(f"Extraction successful: {data['stats']['total_nodes']} nodes, {data['stats']['total_edges']} edges.")
    print("Types breakdown:", data["stats"]["types"])

    # Test query
    q1 = query_graph("specs linked to Salesforce")
    print("Query 'specs linked to Salesforce':", q1["summary"], len(q1["node_ids"]), "nodes")

    q2 = query_graph("path from eCommerce to S4HANA")
    print("Query path eCommerce -> S4HANA:", q2["summary"], len(q2["node_ids"]), "hops:", q2.get("path", {}).get("hops"))


