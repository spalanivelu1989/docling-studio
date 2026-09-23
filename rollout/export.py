"""The analysis as a workshop pack (§17).

Markdown rather than a slide deck because it is what a rollout team can paste
into a wiki, a Cloud ALM item or an agenda mail without a converter -- and
because the pack has to carry its own provenance, which a deck tends to lose.

Every section says where its numbers came from. A pack that shows a score
without the formula behind it invites the score to be quoted on its own.
"""

from __future__ import annotations

from .schemas import DEVIATION_TYPES, DISPOSITIONS, LOCALIZATION_STATES


def _pct(v) -> str:
    return "—" if v is None else f"{v:g}%"


def _n(count: int, one: str, many: str = "") -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _loc(state: str) -> str:
    return LOCALIZATION_STATES.get(state, state)


def to_markdown(run: dict) -> str:
    analysis = run.get("analysis") or {}
    from .schemas import SUBJECTS

    subject = SUBJECTS.get(run.get("subject") or "country_as_is", SUBJECTS["country_as_is"])
    scores = run.get("scores") or {}
    asis = run.get("asis") or {}
    counts = scores.get("counts") or {}
    workshop = counts.get("workshop") or {}
    out: list[str] = []
    w = out.append

    matched = (analysis.get("template_process") or "").strip()
    title = run.get("scope_label") or matched or "no Global Template process identified"
    w(f"# Fit-to-Standard analysis — {title}"
      + (f" · {run['country']}" if run.get("country") else ""))
    w("")
    w(f"*Draft for a Fit-to-Standard workshop. The agent proposes; the workshop decides.*")
    w("")

    # --- provenance ---------------------------------------------------------
    w("| | |")
    w("|---|---|")
    w(f"| Run | `{run.get('id', '')}` |")
    # First, because it decides how every row under it should be read: the
    # same table of deviations means "the country diverges from the template"
    # or "the template diverges from SAP standard" depending on this one line.
    w(f"| Subject | {subject.label} |")
    # A run that named no process still has to say what it was compared
    # against, or the scores mean nothing. Who chose it is a second row rather
    # than a parenthetical, so a process whose own name has brackets in it
    # does not end up inside two sets of them.
    named = bool(run.get("scope_bpml"))
    # The row takes the agent's full statement rather than the run's label:
    # `scope_label` is deliberately condensed to fit a history row, and the
    # export is the one place with room for the ancestry and the caveats.
    w(f"| Global Template process | "
      f"{_clean(run.get('scope_label') if named else (matched or 'not identified'))} |")
    w("| Process chosen by | " + ("the analyst |" if named else
                                  "the agent — none was named for this run |"))
    if run.get("gt_version"):
        w(f"| Template version | {run['gt_version']} |")
    if run.get("sap_release"):
        w(f"| SAP target | {run['sap_release']} |")
    w(f"| Model | {run.get('model', '')} · prompt `{run.get('prompt_hash', '')}` |")
    w(f"| Corpus fingerprint | `{run.get('corpus_fingerprint', '')}` |")
    cats = run.get("categories") or []
    w(f"| Corpus categories read | {', '.join(cats) if cats else 'all'} |")
    docs = (run.get("uploads") or {}).get("documents") or []
    if docs:
        w(f"| {subject.label} sources | " + ", ".join(
            f"{d['name']} ({d['role']})" if isinstance(d, dict) else str(d) for d in docs) + " |")
    w(f"| Finished | {run.get('finished_at') or 'not finished'} |")
    w("")

    # --- §16.1 process fit header ------------------------------------------
    w("## Fit summary")
    w("")
    w("| Score | Value | Reading |")
    w("|---|---|---|")
    w(f"| Global Template alignment | **{_pct(scores.get('gt_alignment'))}** | {scores.get('gt_band', '')} |")
    w(f"| SAP Best Practice alignment | {_pct(scores.get('sap_bp_alignment'))} | "
      f"{scores.get('sap_bp_band', '') or scores.get('sap_bp_note', '')} |")
    w(f"| Localization-adjusted alignment | {_pct(scores.get('localization_adjusted'))} | "
      f"{scores.get('localization_share', 0)}% of weighted divergence is confirmed localization |")
    w(f"| Harmonization potential | {_pct(scores.get('harmonization_potential'))} | "
      f"{scores.get('harmonization_band', '')} |")
    w("")
    if scores.get("pattern"):
        w(f"> {scores['pattern']}")
        w("")
    w(f"*{scores.get('formula', '')}*")
    w("")
    w(f"{_n(len(asis.get('steps') or []), 'step')} · {counts.get('fit_areas', 0)} fit · "
      f"{_n(counts.get('deviations', 0), 'deviation')} · "
      f"{_n(counts.get('localization_confirmed', 0), 'confirmed localization item')}")
    w("")
    w(f"**Workshop focus:** {_n(workshop.get('MUST_DISCUSS', 0), 'decision')} "
      f"(~{counts.get('workshop_minutes', 0)} min) · "
      f"{workshop.get('CONFIRM', 0)} to confirm in batch · "
      f"{workshop.get('NO_WORKSHOP_TIME', 0)} need no floor time")
    w("")
    if analysis.get("headline"):
        w(analysis["headline"])
        w("")

    # --- dimensions ---------------------------------------------------------
    w("## Alignment by dimension")
    w("")
    w("| Dimension | Weight | Rating | % | What drove it |")
    w("|---|---:|---:|---:|---|")
    for row in scores.get("dimensions") or []:
        rating = "—" if row["rating"] is None else f"{row['rating']}/4"
        w(f"| {row['label']} | {row['weight']}% | {rating} | {_pct(row['percent'])} | {row['note']} |")
    w("")

    # --- §16.3 heatmap ------------------------------------------------------
    heat = scores.get("heatmap") or []
    if heat:
        w("## Deviation heatmap")
        w("")
        w("| Dimension | Deviations | Must discuss | Confirmed localization | Focus |")
        w("|---|---:|---:|---:|---|")
        for row in heat:
            w(f"| {row['label']} | {row['deviations']} | {row['must_discuss']} | "
              f"{row['localization']} | {row['focus']} |")
        w("")

    # --- §17 Output 8: workshop scope ---------------------------------------
    agenda = scores.get("agenda") or []
    if agenda:
        w("## Workshop agenda")
        w("")
        w("*Legal and localization blockers first, then controls and financial impact, "
          "then the rest by materiality (§22).*")
        w("")
        for item in agenda:
            w(f"### {item['position']}. {item['topic']}")
            w("")
            w(f"`{item['gap_id']}` · {item['materiality']} · "
              f"{DEVIATION_TYPES.get(item['primary_type'], item['primary_type'])} · "
              f"~{item['minutes']} min")
            w("")
            if item.get("why"):
                w(f"**Why this is being discussed** — {item['why']}")
                w("")
            if item.get("options"):
                w("**Options**")
                for opt in item["options"]:
                    w(f"- {opt}")
                w("")
            w(f"**Agent's proposal** — {DISPOSITIONS.get(item['disposition'], item['disposition'])}")
            w("")
            if item.get("owner"):
                w(f"**Decision owner** — {', '.join(item['owner'])}")
                w("")
            if item.get("localization_state"):
                w(f"**Localization** — {_loc(item['localization_state'])}")
                w("")

    # --- §17 Output 4: the deviation register -------------------------------
    deviations = analysis.get("deviations") or []
    if deviations:
        w("## Deviation register")
        w("")
        w("| Gap | Step | Exact difference | Type | Materiality | Localization | "
          "GT fit | Harmonization | Disposition | Confidence |")
        w("|---|---|---|---|---|---|---:|---:|---|---|")
        for d in deviations:
            w(f"| {d['gap_id']} | {d.get('as_is_step_id', '')} | "
              f"{_clean(d.get('exact_difference', ''))} | "
              f"{d['primary_type']}{''.join('/' + t for t in d.get('secondary_types') or [])} | "
              f"{d['materiality']} | {_loc(d['localization_state'])} | "
              f"{d['gt_fit_rating']}/4 | {d['harmonization_potential']}% | "
              f"{d['candidate_disposition']} | {d.get('evidence_confidence', '')} |")
        w("")

        w("### Gap detail")
        w("")
        for d in deviations:
            w(f"#### {d['gap_id']} — {d['materiality']} · "
              f"{DEVIATION_TYPES.get(d['primary_type'], d['primary_type'])}")
            w("")
            w(f"- **{subject.label}** — {d.get('as_is_statement', '')}")
            w(f"- **Global Template** — {d.get('gt_statement', '')}")
            if d.get("sap_bp_reference"):
                w(f"- **SAP Best Practice** — {d['sap_bp_reference']}")
            w(f"- **Difference** — {d.get('exact_difference', '')}")
            w(f"- **Localization** — {_loc(d['localization_state'])}")
            if d.get("standard_options_considered"):
                w("- **Standard options considered** — " + "; ".join(d["standard_options_considered"]))
            if d.get("decision_question"):
                w(f"- **Decision** — {d['decision_question']}")
            for imp in d.get("impacts") or []:
                w(f"- **Impact · {imp['area']}** ({imp['score']}/5) — {imp.get('note', '')}")
            for ev in d.get("evidence") or []:
                w(f"- **Evidence · {ev['side']} · {ev.get('evidence_class', 'E1')}** — "
                  f"“{_clean(ev['quote'])}” — *{ev['doc']}* `{ev['chunk_id']}`")
            for q in d.get("open_questions") or []:
                w(f"- **Open** — {q}")
            w("")

    # --- §17 Output 5: localization advisory --------------------------------
    localization = analysis.get("localization") or []
    if localization:
        w("## Localization advisory")
        w("")
        w("*Only findings that interact with this process (§10).*")
        w("")
        for item in localization:
            w(f"### {item['topic']} — {item['status']}")
            w("")
            for label, key in (("Relevance", "relevance"), ("Requirement", "requirement"),
                               ("SAP capability", "sap_capability"),
                               ("Template capability", "gt_capability"),
                               ("Country As-Is handling", "as_is_handling"),
                               ("Recommended path", "recommended_path"),
                               ("Workshop decision", "workshop_decision")):
                if item.get(key):
                    w(f"- **{label}** — {item[key]}")
            if item.get("owner"):
                w(f"- **Validation owner** — {', '.join(item['owner'])}")
            for ev in item.get("evidence") or []:
                w(f"- **Evidence** — “{_clean(ev['quote'])}” — *{ev['doc']}*")
            w("")

    # --- fit areas ----------------------------------------------------------
    fits = analysis.get("fit_areas") or []
    if fits:
        w("## Pre-confirmed fit — batch these")
        w("")
        for f in fits:
            ref = " · ".join(x for x in (f.get("as_is_step_id"), f.get("gt_step_ref")) if x)
            w(f"- {f['statement']}" + (f" ({ref})" if ref else ""))
        w("")

    # --- §17 Output 10: backlog candidates ----------------------------------
    backlog = analysis.get("backlog") or []
    if backlog:
        w("## Product backlog candidates")
        w("")
        w("*Candidates only. §20: a hypothesis does not become project scope until the "
          "workshop validates it.*")
        w("")
        for item in backlog:
            w(f"### {item['title']}")
            w("")
            w(f"- **Requirement** — {item['requirement']}")
            if item.get("business_value"):
                w(f"- **Business value** — {item['business_value']}")
            w(f"- **Type** — {item['build_type']}"
              + (" · localization" if item.get("localization_flag") else ""))
            w(f"- **Priority** — {item['priority']} · **from** `{item.get('gap_id', '')}`")
            for c in item.get("acceptance_criteria") or []:
                w(f"  - {c}")
            w("")

    # --- §17 Output 11: open questions --------------------------------------
    questions = analysis.get("open_questions") or []
    if questions:
        w("## Evidence requests and open questions")
        w("")
        for q in questions:
            w(f"- {q}")
        w("")

    # --- the quality gates --------------------------------------------------
    gates = run.get("gates") or {}
    if gates:
        w("## Quality gates")
        w("")
        w(f"{gates.get('hard', 0)} hard, {gates.get('soft', 0)} soft. "
          f"Not checked: {'; '.join(gates.get('not_checked') or [])}.")
        w("")
        for issue in gates.get("items") or []:
            w(f"- **{issue['gate']} · {issue['severity']}**"
              + (f" `{issue['gap_id']}`" if issue.get("gap_id") else "")
              + f" — {issue['detail']}")
        w("")

    # --- the As-Is model ----------------------------------------------------
    steps = asis.get("steps") or []
    if steps:
        w(f"## {subject.label}, as read")
        w("")
        w("| Step | Actor | Action | Rule | Control | System | Confidence |")
        w("|---|---|---|---|---|---|---|")
        for s in steps:
            w(f"| {s['step_id']} {_clean(s.get('name', ''))} | {_clean(s.get('actor', ''))} | "
              f"{_clean(s.get('action', ''))} | {_clean(s.get('business_rule', ''))} | "
              f"{_clean(s.get('control', ''))} | {_clean(s.get('system', ''))} | "
              f"{s.get('confidence', '')} |")
        w("")
        if asis.get("normalisation_notes"):
            w("**Terminology normalised**")
            w("")
            for n in asis["normalisation_notes"]:
                w(f"- {n}")
            w("")
        if asis.get("evidence_gaps"):
            w(f"**Evidence gaps in the {subject.label} documentation**")
            w("")
            for g in asis["evidence_gaps"]:
                w(f"- {g}")
            w("")

    trace = run.get("sources") or {}
    if trace.get("documents"):
        w("## Sources")
        w("")
        w(f"{_n(trace.get('cited_total', 0), 'passage')} from "
          f"{_n(len(trace['documents']), 'document')} carried this analysis; "
          f"{trace.get('unused_total', 0)} further passage(s) were read and not relied on.")
        w("")
        w("| Document | Where | Passages | Citations | Best score |")
        w("|---|---|---|---|---|")
        for d in trace["documents"]:
            where = "attached" if d.get("kind") == "upload" else (d.get("category") or "corpus")
            best = f"{d['best_score']:.4f}" if d.get("best_score") is not None else "—"
            w(f"| {_clean(d.get('document', ''))} | {where} | {d.get('chunks', 0)} | "
              f"{d.get('citations', 0)} | {best} |")
        w("")
        # Per passage, so a reader can find the paragraph a finding rests on
        # rather than the document it is somewhere inside.
        w("<details><summary>Which passage supported which finding</summary>")
        w("")
        w("| Passage | Document | Section | Supports |")
        w("|---|---|---|---|")
        for cid, c in sorted((trace.get("chunks") or {}).items()):
            uses = ", ".join(u.get("ref") or u.get("kind", "") for u in c.get("used_by") or [])
            w(f"| `{cid}` | {_clean(c.get('document', ''))} | "
              f"{_clean(c.get('heading_path', ''))} | {_clean(uses)} |")
        w("")
        w("</details>")
        w("")

    decisions = run.get("decisions") or []
    if decisions:
        standing, superseded = _standing(decisions)
        w("## Human decisions")
        w("")
        decided = len(standing)
        total = len(analysis.get("deviations") or [])
        if total:
            w(f"{decided} of {_n(total, 'deviation')} carry a decision; "
              f"{total - decided} still await one.")
            w("")
        w("| Gap | Verdict | Disposition | Reviewer | When | Comment |")
        w("|---|---|---|---|---|---|")
        for d in standing.values():
            w(f"| {d['gap_id']} | {d['verdict']} | {d.get('disposition', '')} | "
              f"{d['reviewer']} | {d.get('decided_at', '')} | {_clean(d.get('comment', ''))} |")
        w("")
        if superseded:
            # Kept, because a decision log that shows only the current answer
            # cannot show that somebody changed their mind, which is often the
            # part a later reader needs.
            w(f"<details><summary>{_n(len(superseded), 'earlier verdict')} since "
              f"superseded</summary>")
            w("")
            w("| Gap | Verdict | Reviewer | When |")
            w("|---|---|---|---|")
            for d in superseded:
                w(f"| {d['gap_id']} | {d['verdict']} | {d['reviewer']} | {d.get('decided_at', '')} |")
            w("")
            w("</details>")
            w("")

    return "\n".join(out)


def _standing(decisions: list[dict]) -> tuple[dict, list[dict]]:
    """Split an append-only decision log into what stands and what it replaced.

    The log never updates a row, so a gap decided twice has two rows and the
    later one is the answer. Reporting both as though they were separate
    decisions overstates how much was settled -- and a run where somebody
    clicked the same button three times would read as three decisions."""
    standing: dict[str, dict] = {}
    superseded: list[dict] = []
    for d in sorted(decisions, key=lambda x: (x.get("decided_at") or "")):
        previous = standing.get(d["gap_id"])
        if previous is not None:
            superseded.append(previous)
        standing[d["gap_id"]] = d
    return standing, superseded


def _clean(text: str) -> str:
    """Keep a cell in its column: pipes and newlines break a Markdown table."""
    return (text or "").replace("|", "\\|").replace("\n", " ").strip()
