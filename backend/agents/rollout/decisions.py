"""What a workshop decision was made about, written down with the decision.

A row in `workshop_decisions` is meant to be read years later, by someone who
never saw the run, and eventually by an organizational decision memory that
asks "what did we decide about return approvals in other countries?". The run
it came from may have been deleted by then, and a gap id such as GAP-04 means
something different in every run. So the question, the options, the country,
the process and the deviation are copied onto the row at the moment it is
decided, rather than joined from the run when it is read.
"""

from __future__ import annotations

import re

LETTERS = "ABCDEFGHIJ"

# The context copied from the deviation, by column name. Everything here is
# what the agent proposed; the verdict, option and rationale are what the
# workshop decided about it.
DEVIATION_FIELDS = (
    "as_is_step_id", "gt_step_ref", "primary_type", "dimension", "materiality",
    "localization_state", "candidate_disposition", "workshop_bucket",
    "exact_difference", "as_is_statement", "gt_statement", "sap_bp_reference",
)
RUN_FIELDS = ("subject", "country", "scope_bpml", "scope_label", "sap_release",
              "gt_version", "model", "prompt_hash")

_LEGACY_OPTION = re.compile(r"^Option ([A-J]): (.*)$", re.S)


def snapshot(run: dict | None, gap_id: str) -> dict:
    """The context of one gap in one run, flattened into the decision's columns.

    An unknown gap gives the run's context with the deviation fields empty,
    so a decision recorded against a malformed id is still kept rather than
    lost; the endpoint is where an unknown id is refused."""
    run = run or {}
    analysis = run.get("analysis") or {}
    dev = next((d for d in analysis.get("deviations") or [] if d.get("gap_id") == gap_id), None) or {}
    item = next((a for a in (run.get("scores") or {}).get("agenda") or [] if a.get("gap_id") == gap_id), None) or {}
    out = {k: str(run.get(k) or "") for k in RUN_FIELDS}
    out["template_process"] = str(analysis.get("template_process") or "")
    out.update({k: str(dev.get(k) or "") for k in DEVIATION_FIELDS})
    # The agenda and the register can word the question differently; the
    # agenda is what the room was shown.
    out["question"] = str(item.get("topic") or dev.get("decision_question") or dev.get("exact_difference") or "")
    out["options"] = list(item.get("options") or dev.get("decision_options") or [])
    out["decision_owner"] = list(item.get("owner") or dev.get("decision_owner") or [])
    out["evidence"] = [{"chunk_id": str(e.get("chunk_id", "")), "doc": e.get("doc", ""),
                        "side": e.get("side", ""), "quote": e.get("quote", "")}
                       for e in dev.get("evidence") or []]
    out["found"] = bool(dev)
    return out


def option_text(options: list[str], index: int | None) -> str:
    if index is None:
        return ""
    if not 0 <= index < len(options):
        raise ValueError(f"option {index} is not one of the {len(options)} offered")
    return options[index]


def option_label(index: int | None, text: str) -> str:
    return f"Option {LETTERS[index]}: {text}" if index is not None and text else ""


def from_legacy_comment(comment: str, options: list[str]) -> tuple[int | None, str, str]:
    """Split an old free-text comment into (option index, option text, rationale).

    Before the option was stored on its own, the page wrote the chosen one into
    the comment as "Option B: <text>". The letter is trusted only when the text
    matches what the run offered under it, so an edited or reordered option
    list cannot attach a decision to the wrong option."""
    m = _LEGACY_OPTION.match((comment or "").strip())
    if not m:
        return None, "", (comment or "").strip()
    i, text = LETTERS.index(m.group(1)), m.group(2).strip()
    if i < len(options) and options[i].strip() == text:
        return i, options[i], ""
    return None, "", comment.strip()
