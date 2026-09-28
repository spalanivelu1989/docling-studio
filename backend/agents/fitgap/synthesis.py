"""The reduce pass: five outputs over a whole run (handover §7).

None of this asks a model anything. Once the entries exist, the reuse
percentage, the gap register, the decision pack, the integration list and the
workshop agenda are arithmetic and grouping over them -- so two readers of the
same run always see the same numbers.
"""

from __future__ import annotations

from collections import defaultdict

from . import bpml
from .schemas import VerifiedEntry

FIT_CLASSES = {"FIT_STANDARD", "FIT_CONFIG", "REUSE"}
GAP_CLASSES = {"GAP_DEVELOPMENT", "ADAPT", "CHALLENGE", "SIMPLIFY", "REPLACE", "RETIRE"}
MATERIALITY_WEIGHT = {"low": 1.0, "medium": 2.0, "high": 3.0}

CLASS_ORDER = ["FIT_STANDARD", "FIT_CONFIG", "GAP_DEVELOPMENT", "REUSE", "ADAPT",
               "CHALLENGE", "SIMPLIFY", "REPLACE", "RETIRE", "UNKNOWN"]


def _l3_of(code: str) -> str:
    parts = code.split(".")
    return ".".join(parts[:3]) if len(parts) >= 3 else code


def _label(code: str) -> str:
    p = bpml.get(code)
    return f"{code} {p.name}" if p else code


def reuse_assessment(results: list[VerifiedEntry]) -> dict:
    """Turns "~80% reuse" from a hope into a number -- and shows how much of
    it rests on low-confidence entries, which is the part that usually moves
    after a workshop."""
    entries = [r.entry for r in results]
    by_class = {c: 0 for c in CLASS_ORDER}
    for e in entries:
        by_class[e.classification] = by_class.get(e.classification, 0) + 1
    total = len(entries)
    decided = [e for e in entries if e.classification != "UNKNOWN"]
    fits = [e for e in decided if e.classification in FIT_CLASSES]

    per_process: list[dict] = []
    groups: dict[str, list] = defaultdict(list)
    for e in entries:
        groups[_l3_of(e.bpml_code)].append(e)
    for code, group in sorted(groups.items(), key=lambda kv: bpml.sort_key(kv[0])):
        g_decided = [e for e in group if e.classification != "UNKNOWN"]
        g_fit = [e for e in g_decided if e.classification in FIT_CLASSES]
        per_process.append({
            "code": code, "label": _label(code), "steps": len(group),
            "fit": len(g_fit), "gap": len(g_decided) - len(g_fit),
            "unknown": len(group) - len(g_decided),
            "reuse_pct": round(100.0 * len(g_fit) / len(g_decided), 1) if g_decided else None,
            "avg_confidence": round(sum(e.confidence for e in group) / len(group), 2) if group else 0.0,
        })

    bins = {"0.0–0.4": 0, "0.4–0.7": 0, "0.7–0.9": 0, "0.9–1.0": 0}
    for e in entries:
        c = e.confidence
        bins["0.0–0.4" if c < 0.4 else "0.4–0.7" if c < 0.7 else "0.7–0.9" if c < 0.9 else "0.9–1.0"] += 1

    return {
        "steps": total,
        "classified": len(decided),
        "coverage_pct": round(100.0 * len(decided) / total, 1) if total else 0.0,
        "reuse_pct": round(100.0 * len(fits) / len(decided), 1) if decided else None,
        "by_class": {c: n for c, n in by_class.items() if n},
        "by_process": per_process,
        "confidence_bins": bins,
        "avg_confidence": round(sum(e.confidence for e in entries) / total, 2) if total else 0.0,
        "note": "Percentages are over classified steps only; UNKNOWN is reported separately "
                "and never counted as a fit.",
    }


def gap_register(results: list[VerifiedEntry]) -> list[dict]:
    """Everything that is not a fit, worst first: high materiality and low
    confidence is what a workshop exists to resolve."""
    rows = []
    for r in results:
        e = r.entry
        if e.classification in FIT_CLASSES:
            continue
        rows.append({
            "bpml_code": e.bpml_code, "step_name": e.step_name,
            "classification": e.classification, "confidence": e.confidence,
            "materiality": e.materiality, "rationale": e.rationale,
            "linked_tickets": e.linked_tickets, "sap_objects": e.sap_objects,
            "evidence_count": len(e.evidence),
            "docs": sorted({ev.doc for ev in e.evidence}),
            "weight": round(MATERIALITY_WEIGHT[e.materiality] * (1 - e.confidence), 3),
        })
    rows.sort(key=lambda r: (-MATERIALITY_WEIGHT[r["materiality"]], r["confidence"]))
    return rows


def decision_pack(results: list[VerifiedEntry]) -> list[dict]:
    """Deduplicated decision points, grouped by the L3 process they sit under.
    The same question surfaces on several steps; it is asked once."""
    grouped: dict[str, dict] = {}
    for r in results:
        e = r.entry
        for dp in e.decision_points:
            key = (_l3_of(e.bpml_code), " ".join(dp.question.lower().split())[:120])
            slot = grouped.setdefault(str(key), {
                "process": _label(_l3_of(e.bpml_code)),
                "question": dp.question, "options": list(dp.options),
                "consequence_note": dp.consequence_note, "steps": [],
                "evidence": [], "weight": 0.0,
            })
            slot["steps"].append({"bpml_code": e.bpml_code, "step_name": e.step_name,
                                  "classification": e.classification})
            slot["weight"] += MATERIALITY_WEIGHT[e.materiality] * (1 - e.confidence)
            for ev in dp.evidence:
                slot["evidence"].append({"doc": ev.doc, "quote": ev.quote, "chunk_id": ev.chunk_id})
            for opt in dp.options:
                if opt not in slot["options"]:
                    slot["options"].append(opt)
    out = list(grouped.values())
    for d in out:
        d["weight"] = round(d["weight"], 3)
    out.sort(key=lambda d: -d["weight"])
    return out


def integration_impacts(results: list[VerifiedEntry]) -> list[dict]:
    by_system: dict[str, dict] = {}
    for r in results:
        e = r.entry
        for imp in e.integration_impacts:
            slot = by_system.setdefault(imp.system, {
                "system": imp.system, "steps": [], "impacts": defaultdict(int), "interfaces": set(),
            })
            slot["steps"].append({"bpml_code": e.bpml_code, "step_name": e.step_name,
                                  "impact": imp.impact, "classification": e.classification})
            slot["impacts"][imp.impact] += 1
            if imp.interface_ref:
                slot["interfaces"].add(imp.interface_ref)
    out = []
    for s in by_system.values():
        out.append({"system": s["system"], "steps": s["steps"], "step_count": len(s["steps"]),
                    "impacts": dict(s["impacts"]), "interfaces": sorted(s["interfaces"])})
    out.sort(key=lambda s: -s["step_count"])
    return out


def workshop_agenda(results: list[VerifiedEntry], block_minutes: int = 90) -> list[dict]:
    """Sessions ordered by decision weight = Σ materiality × (1 − confidence).

    A step everyone is sure about needs no workshop time however material it
    is; an uncertain step touching pricing needs it most.
    """
    groups: dict[str, list] = defaultdict(list)
    for r in results:
        groups[_l3_of(r.entry.bpml_code)].append(r.entry)

    sessions = []
    for code, entries in groups.items():
        weight = sum(MATERIALITY_WEIGHT[e.materiality] * (1 - e.confidence) for e in entries)
        if weight <= 0:
            continue
        open_qs = [q for e in entries for q in e.open_questions]
        decisions = [dp.question for e in entries for dp in e.decision_points]
        pre_read = sorted({ev.doc for e in entries for ev in e.evidence})
        sessions.append({
            "process": _label(code), "code": code,
            "weight": round(weight, 2),
            "minutes": 60 if weight < 3 else block_minutes,
            "steps": len(entries),
            "unresolved": sum(1 for e in entries if e.classification == "UNKNOWN"),
            "gaps": sum(1 for e in entries if e.classification in GAP_CLASSES),
            "decisions": decisions[:8],
            "open_questions": open_qs[:8],
            "pre_read": pre_read[:10],
        })
    sessions.sort(key=lambda s: -s["weight"])
    for n, s in enumerate(sessions, 1):
        s["order"] = n
    return sessions


def synthesise(results: list[VerifiedEntry]) -> dict:
    return {
        "reuse": reuse_assessment(results),
        "gaps": gap_register(results),
        "decisions": decision_pack(results),
        "integrations": integration_impacts(results),
        "agenda": workshop_agenda(results),
    }


def to_markdown(run: dict, results: list[VerifiedEntry], synth: dict) -> str:
    """The register as a document, for people who read documents."""
    reuse = synth["reuse"]
    L = [
        f"# Fit-Gap register — {run.get('scope_label', run.get('scope_bpml', ''))}",
        "",
        f"**Run** `{run.get('id', '')}` · mode {run.get('mode', 'A')}"
        f"{' · holdout' if run.get('holdout') else ''} · model `{run.get('model', '')}`",
        f"**Generated** {run.get('finished_at', '')} · prompt `{run.get('prompt_hash', '')}`",
        "",
        "> Every entry below is **proposed**. Nothing here is a decision until a named "
        "Solvay reviewer accepts it.",
        "",
        "## 1. Reuse assessment",
        "",
        f"- Steps in scope: **{reuse['steps']}**",
        f"- Classified: **{reuse['classified']}** ({reuse['coverage_pct']}% coverage)",
        f"- Reuse across classified steps: **{reuse['reuse_pct']}%**" if reuse["reuse_pct"] is not None
        else "- Reuse: not computable — no step was classified",
        f"- Average confidence: **{reuse['avg_confidence']}**",
        "",
        "| Class | Steps |", "|---|---|",
    ]
    for c, n in reuse["by_class"].items():
        L.append(f"| {c} | {n} |")
    L += ["", "| Process | Steps | Fit | Gap | Unknown | Reuse % | Avg conf |", "|---|---|---|---|---|---|---|"]
    for p in reuse["by_process"]:
        L.append(f"| {p['label']} | {p['steps']} | {p['fit']} | {p['gap']} | {p['unknown']} | "
                 f"{p['reuse_pct'] if p['reuse_pct'] is not None else '—'} | {p['avg_confidence']} |")

    L += ["", "## 2. Draft gap register", ""]
    if not synth["gaps"]:
        L.append("_No gaps proposed in this scope._")
    else:
        L += ["| BPML | Step | Class | Conf | Materiality | Tickets |", "|---|---|---|---|---|---|"]
        for g in synth["gaps"]:
            L.append(f"| `{g['bpml_code']}` | {g['step_name']} | {g['classification']} | "
                     f"{g['confidence']:.2f} | {g['materiality']} | "
                     f"{', '.join(g['linked_tickets']) or '—'} |")

    L += ["", "## 3. Decision pack", ""]
    if not synth["decisions"]:
        L.append("_No decision points were raised._")
    for d in synth["decisions"]:
        L += [f"### {d['question']}", "", f"*{d['process']}* · weight {d['weight']}", ""]
        for o in d["options"]:
            L.append(f"- {o}")
        if d["consequence_note"]:
            L += ["", f"> {d['consequence_note']}"]
        L += ["", f"Raised by: {', '.join(s['bpml_code'] for s in d['steps'])}", ""]

    L += ["## 4. Integration impacts", ""]
    if not synth["integrations"]:
        L.append("_No integration impacts were identified._")
    else:
        L += ["| System | Steps | Impacts | Interfaces |", "|---|---|---|---|"]
        for i in synth["integrations"]:
            L.append(f"| {i['system']} | {i['step_count']} | "
                     f"{', '.join(f'{k}×{v}' for k, v in i['impacts'].items())} | "
                     f"{', '.join(i['interfaces']) or '—'} |")

    L += ["", "## 5. Workshop agenda", ""]
    if not synth["agenda"]:
        L.append("_Nothing in this scope needs workshop time._")
    for s in synth["agenda"]:
        L += [f"### {s['order']}. {s['process']} — {s['minutes']} min",
              "", f"Decision weight **{s['weight']}** · {s['steps']} steps · "
                  f"{s['gaps']} gaps · {s['unresolved']} unresolved", ""]
        for q in s["decisions"]:
            L.append(f"- **Decide:** {q}")
        for q in s["open_questions"]:
            L.append(f"- *Open:* {q}")
        if s["pre_read"]:
            L += ["", "Pre-read: " + ", ".join(f"`{d}`" for d in s["pre_read"])]
        L.append("")

    L += ["## 6. Entries", ""]
    for r in results:
        e = r.entry
        L += [f"### `{e.bpml_code}` {e.step_name}", "",
              f"**{e.classification}** · confidence {e.confidence:.2f} · {e.materiality} materiality "
              f"· status *{e.status}*", "", e.rationale, ""]
        if e.linked_tickets:
            L.append(f"Tickets: {', '.join(e.linked_tickets)}")
        if e.sap_objects:
            L.append(f"SAP objects: {', '.join(e.sap_objects)}")
        if e.evidence:
            L += ["", "Evidence:"]
            for ev in e.evidence:
                L.append(f"- *{ev.supports}* — `{ev.doc}` › {ev.heading_path or '—'}: “{ev.quote}”")
        for issue in r.issues:
            L.append(f"- ⚠ {issue.severity}: {issue.detail}")
        L.append("")
    return "\n".join(L)
