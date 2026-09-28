"""Code-only quality scores for the Evidence Agent and the Fit-Gap Copilot.

Usage:
    python agent_eval.py configs    # declare these score names to the Langfuse project

The agents already check their own work: the Evidence Agent verifies every
quote against the chunk it names, the Fit-Gap Copilot runs its quality gates
and can trace every claim to the call that retrieved it, and both pass every
request through the guardrails. None of that reached Langfuse, so there was no
way to watch it across runs. This module turns it into scores on the run's
trace -- one set per run, computed from what the run already knows, with no
judge model and no labelled data, so it is free and runs on every run.

The scores fall under four of the five agent metrics we track:

  GROUNDEDNESS     citation_validity, claims_unsupported
  TOOL USE         tool_error_rate, redundant_tool_calls, required_tools_met,
                   submitted_first_try, budget_exhausted, tool_calls
  TOPIC ADHERENCE  topic_adherence (Fit-Gap), web_query_on_topic
  GUARDRAILS       scope_refused, scope_guard_fail_open, contact_in_output,
                   contact_leak, web_gate_blocks, web_query_leak_attempts

plus task_completed and, for the Fit-Gap Copilot, the gate counts. Goal
accuracy against a reference and claim support need a dataset or a judge and
are not here.

The names are shared by both agents, so one dashboard widget covers both and a
filter on the trace tag (`evidence-agent`, `rollout-agent`) separates them.

A score whose denominator is empty is left out rather than written as 0 or 1:
a run that made no web query has no web-query adherence, and recording one
would move the average without anything having happened.

Scoring functions are pure and take plain values, so the tests can run them
without an agent, a database or Langfuse. `push` is the only part that talks to
anything, and like tracing.py it swallows its failures: an observability tool
may not break the tool.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Score:
    name: str
    value: float
    comment: str = ""


@dataclass(frozen=True)
class Spec:
    """What a score is, for Langfuse and for the Evaluation tab.

    `good` says which way is good against `target`: "min" (at least the
    target), "max" (at most the target) or "" for a count with no right
    answer, shown for context only.

    `watch`, when set, is a second line on the same side as the target: a
    value that misses the target but stays within it is shown as "Watch"
    rather than "Below" -- worth noticing, not worth alarm. One quote in
    seventeen failing verification, and discarded before anyone saw it, is
    that; one in three is not."""
    metric: str
    label: str
    description: str
    boolean: bool = False
    good: str = ""
    target: float = 0.0
    watch: float | None = None


GROUNDEDNESS, TOOL_USE, TASK, TOPIC, GUARDRAILS = (
    "Groundedness", "Tool call accuracy", "Task success", "Topic adherence", "Guardrails")
METRICS = (GROUNDEDNESS, TOOL_USE, TASK, TOPIC, GUARDRAILS)

# The configs command declares these; the scoring functions below may only
# emit names listed here (a test holds them to it), so a typo cannot quietly
# start a second series in Langfuse. Targets are starting points, to be moved
# once there are enough runs to say what normal looks like.
SCORES: dict[str, Spec] = {
    "citation_validity": Spec(
        GROUNDEDNESS, "Quotes verified",
        "Share of the quotes the agent submitted that were found verbatim in a chunk this "
        "run retrieved. A quote that fails is discarded before the answer is shown.",
        good="min", target=1.0, watch=0.9),
    "claims_unsupported": Spec(
        GROUNDEDNESS, "Claims without evidence",
        "Claims left with no verified evidence (Evidence Agent) or untraced to a quote "
        "(Fit-Gap Copilot).", good="max", target=0),
    "tool_error_rate": Spec(
        TOOL_USE, "Tool errors",
        "Share of tool calls that returned an error. Calls blocked by the web guardrail are "
        "counted under Guardrails instead.", good="max", target=0.02),
    "redundant_tool_calls": Spec(
        TOOL_USE, "Repeated calls",
        "Tool calls repeating an earlier call with identical arguments.", good="max", target=1),
    "required_tools_met": Spec(
        TOOL_USE, "Required tools used",
        "The run made the calls its task requires: the corpus searched, get_scope for a named "
        "BPML step (Evidence Agent); the As-Is read and the SAP Best Practice searches owed "
        "(Fit-Gap Copilot).", boolean=True, good="min", target=1),
    "submitted_first_try": Spec(
        TOOL_USE, "Accepted first time",
        "The agent's submission was accepted without being sent back.",
        boolean=True, good="min", target=1),
    "budget_exhausted": Spec(
        TOOL_USE, "Budget hit",
        "The run hit its tool or token budget and was told to submit.",
        boolean=True, good="max", target=0),
    "tool_calls": Spec(TOOL_USE, "Tool calls", "Tool calls the run made."),
    "task_completed": Spec(
        TASK, "Completed",
        "The agent submitted a result rather than stopping without one.",
        boolean=True, good="min", target=1),
    "gate_hard_issues": Spec(
        TASK, "Hard gate findings",
        "Hard quality-gate findings (QG1-QG7). Each was repaired before the result was shown.",
        good="max", target=0),
    "gate_soft_issues": Spec(TASK, "Soft gate findings", "Soft quality-gate findings."),
    "topic_adherence": Spec(
        TOPIC, "Deviations on this process",
        "Share of the deviations naming an As-Is step whose steps all belong to the process "
        "this run read.", good="min", target=0.95),
    "web_query_on_topic": Spec(
        TOPIC, "Web queries on topic",
        "Share of web queries the guardrail accepted as being about SAP or the programme.",
        good="min", target=1.0),
    "scope_refused": Spec(
        GUARDRAILS, "Refused as out of scope",
        "The scope guardrail refused the request.", boolean=True),
    "scope_guard_fail_open": Spec(
        GUARDRAILS, "Scope check skipped",
        "The scope check could not run (classifier unreachable or switched off) and the "
        "request went through unchecked.", boolean=True, good="max", target=0),
    "contact_in_output": Spec(
        GUARDRAILS, "Contact details written",
        "The agent wrote an e-mail address or phone number, before redaction. The rule says "
        "it must not.", boolean=True, good="max", target=0),
    "contact_leak": Spec(
        GUARDRAILS, "Contact details leaked",
        "Contact details still present after redaction.", boolean=True, good="max", target=0),
    "web_gate_blocks": Spec(
        GUARDRAILS, "Web queries blocked", "Web queries the guardrail refused, for any reason."),
    "web_query_leak_attempts": Spec(
        GUARDRAILS, "Web leak attempts",
        "Web queries refused for carrying an internal identifier or contact details out of "
        "the programme.", good="max", target=0),
}


# The scores that are a proportion, shown as a percentage; the other numeric
# ones are counts.
SHARES = frozenset({"citation_validity", "tool_error_rate", "topic_adherence",
                    "web_query_on_topic"})


def passed(s: Score) -> bool | None:
    """Whether the score meets its target, or None when it has none."""
    spec = SCORES[s.name]
    if spec.good == "min":
        return s.value >= spec.target
    if spec.good == "max":
        return s.value <= spec.target
    return None


def status(s: Score) -> str | None:
    """"pass", "watch" or "below" against the target and watch line, or None
    when the score has no target."""
    ok = passed(s)
    if ok is None:
        return None
    if ok:
        return "pass"
    spec = SCORES[s.name]
    if spec.watch is not None and (s.value >= spec.watch if spec.good == "min"
                                   else s.value <= spec.watch):
        return "watch"
    return "below"


def report(scores: list[Score], trace_url: str = "") -> dict:
    """The run's evaluation as the page shows it and the run row stores it:
    each score with its label, metric, target and verdict, in metric order."""
    order = {m: i for i, m in enumerate(METRICS)}
    names = list(SCORES)
    rows = []
    for s in sorted(scores, key=lambda s: (order[SCORES[s.name].metric], names.index(s.name))):
        spec = SCORES[s.name]
        rows.append({"name": s.name, "label": spec.label, "metric": spec.metric,
                     "description": spec.description, "value": s.value,
                     "kind": "boolean" if spec.boolean else "share" if s.name in SHARES else "count",
                     "comment": s.comment,
                     "good": spec.good, "target": spec.target, "watch": spec.watch,
                     "passed": passed(s), "status": status(s)})
    judged = [r for r in rows if r["status"] is not None]
    return {"scores": rows, "passed": sum(1 for r in judged if r["status"] == "pass"),
            "watch": sum(1 for r in judged if r["status"] == "watch"),
            "judged": len(judged), "trace_url": trace_url}


def refresh(evaluation: dict | None) -> dict:
    """A stored evaluation re-read against today's definitions.

    Only the measured values are facts about the run; labels, targets and
    verdicts are this module's current opinion of them. Rebuilding on read
    means a changed target (or the Watch level, added after runs had been
    scored) applies to a reopened run the same as to a new one."""
    if not evaluation or not evaluation.get("scores"):
        return evaluation or {}
    scores = [Score(r["name"], r["value"], r.get("comment") or "")
              for r in evaluation["scores"] if r.get("name") in SCORES]
    return report(scores, evaluation.get("trace_url") or "")


def evaluate(scorer: Callable[..., list[Score]], **kwargs: Any) -> list[Score]:
    """Run a scorer, returning [] rather than raising: the scores describe a
    run and must never become the reason it failed."""
    try:
        return [s for s in scorer(**kwargs) if s.name in SCORES]
    except Exception as exc:
        logger.warning("agent_eval: %s failed: %s", getattr(scorer, "__name__", scorer), exc)
        return []


# --- shared pieces --------------------------------------------------------------


def _boolean(name: str, value: bool, comment: str = "") -> Score:
    return Score(name, 1.0 if value else 0.0, comment)


def _rate(name: str, part: int, whole: int, comment: str = "") -> list[Score]:
    """A share, or nothing when there is nothing to take a share of."""
    if whole <= 0:
        return []
    return [Score(name, round(part / whole, 4), comment or f"{part} of {whole}")]


def _signature(call: dict) -> str:
    return (call.get("tool") or "") + json.dumps(call.get("arguments") or {}, sort_keys=True,
                                                 default=str)


# The web guardrail answers a refused query with a sentence, not a code. These
# are the phrases that tell its reasons apart; test_agent_eval.py drives
# guardrails.web.gate to produce each one, so a reworded message fails a test
# rather than silently moving a count.
_WEB_LEAK = ("internal identifier", "contact details")
_WEB_OFF_TOPIC = ("not about SAP",)


def _web(calls: list[dict]) -> dict:
    web = [c for c in calls if c.get("tool") == "web_search"]
    blocked = [c for c in web if _gated(c)]
    return {
        "attempts": len(web),
        "blocked": len(blocked),
        "leaks": sum(1 for c in blocked if any(p in c["error"] for p in _WEB_LEAK)),
        "off_topic": sum(1 for c in blocked if any(p in c["error"] for p in _WEB_OFF_TOPIC)),
    }


def _gated(call: dict) -> bool:
    """A web call the guardrail refused, as opposed to one that failed."""
    err = call.get("error") or ""
    return (call.get("tool") == "web_search" and bool(err)
            and not err.startswith("web search failed"))


def _tool_use(calls: list[dict]) -> list[Score]:
    """What both agents share: errors, repeats and volume."""
    real = [c for c in calls if not _gated(c)]
    errors = sum(1 for c in real if c.get("error"))
    seen: set[str] = set()
    repeats = 0
    for c in real:
        sig = _signature(c)
        repeats += sig in seen
        seen.add(sig)
    out = _rate("tool_error_rate", errors, len(real))
    out.append(Score("redundant_tool_calls", float(repeats)))
    out.append(Score("tool_calls", float(len(calls))))
    return out


def _guardrails(verdict: dict | None, calls: list[dict], written: Any, sent: Any) -> list[Score]:
    """`written` is what the agent produced; `sent` is the same after redaction."""
    from guardrails import contact

    verdict = verdict or {}
    method = verdict.get("method", "")
    out = [
        _boolean("scope_refused", False),
        _boolean("scope_guard_fail_open", method in ("unavailable", "off"),
                 verdict.get("reason", "") if method in ("unavailable", "off") else ""),
        _boolean("contact_in_output", contact.found(json.dumps(written, default=str))),
        _boolean("contact_leak", contact.found(json.dumps(sent, default=str))),
    ]
    web = _web(calls)
    out.append(Score("web_gate_blocks", float(web["blocked"])))
    out.append(Score("web_query_leak_attempts", float(web["leaks"])))
    out += _rate("web_query_on_topic", web["attempts"] - web["off_topic"], web["attempts"])
    return out


# --- Evidence Agent -------------------------------------------------------------

# A BPML code or step path in a question: the question is about a specific place
# in the process hierarchy, and the agent should look that place up.
_BPML = re.compile(r"\b[A-Z]-\d{2,3}(?:-\d{2,3})+\b|\b\d+(?:\.\d+){2,}\b")
_CORPUS = {"search_corpus", "get_chunk"}


def refused(verdict: dict) -> list[Score]:
    """A request the scope guardrail turned away before any agent ran."""
    return [_boolean("scope_refused", True,
                     verdict.get("reason") or verdict.get("category") or "")]


def evidence(*, question: str, verdict: dict | None, submitted: dict | None,
             final: dict, redacted: dict, calls: list[dict], rejections: int,
             budget_hit: bool) -> list[Score]:
    """Scores for one Evidence Agent run.

    `submitted` is the answer as the agent submitted it, before finalise
    dropped the quotes it could not verify, or None if it never submitted.
    `final` is after finalise; `redacted` is `final` after contact redaction.
    `calls` are the run's tool-call events."""
    out: list[Score] = []

    # Groundedness. Counted on the submission, because finalise removes the
    # quotes that fail -- counted afterwards, every run would score 1.0.
    quotes = [s for c in (submitted or {}).get("claims") or [] for s in c.get("sources") or []]
    kept = sum(len(c.get("sources") or []) for c in final.get("claims") or [])
    out += _rate("citation_validity", kept, len(quotes),
                 f"{kept} of {len(quotes)} quotes verified; {len(quotes) - kept} discarded")
    bare = [c for c in final.get("claims") or [] if not c.get("sources") and not c.get("graph_facts")]
    out.append(Score("claims_unsupported", float(len(bare)),
                     "; ".join(c.get("text", "")[:80] for c in bare)[:1000]))

    # Tool use.
    out += _tool_use(calls)
    tools = {c.get("tool") for c in calls if not c.get("error")}
    missing = []
    if not tools & _CORPUS:
        missing.append("the corpus was never searched")
    if _BPML.search(question or "") and "get_scope" not in tools:
        missing.append("the question names a BPML step and get_scope was not called")
    out.append(_boolean("required_tools_met", not missing, "; ".join(missing)))
    out.append(_boolean("submitted_first_try", submitted is not None and rejections == 0,
                        f"{rejections} submission(s) rejected" if rejections else ""))
    out.append(_boolean("budget_exhausted", budget_hit))

    # Task.
    out.append(_boolean("task_completed", submitted is not None,
                        "" if submitted is not None else "the agent stopped without submitting"))

    out += _guardrails(verdict, calls, final, redacted)
    return out


# --- Fit-Gap Copilot ------------------------------------------------------------


def rollout(*, verdict: dict | None, lineage_summary: dict, gate_items: list[dict],
            analysis: dict, asis: dict, calls: list[dict], sendbacks: int,
            budget_hit: bool, min_sap: int) -> list[Score]:
    """Scores for one Fit-Gap Copilot run that produced an analysis.

    `lineage_summary` is rollout.lineage.build(run)["summary"], taken after the
    gates repaired the analysis. `gate_items` are the gate findings, whose QG2
    "evidence dropped" entries are the quotes the repair removed."""
    out: list[Score] = []

    # Groundedness. The lineage sees the analysis after QG2 pruned it, so the
    # pruned quotes are added back to the denominator.
    dropped = sum(1 for g in gate_items
                  if g.get("gate") == "QG2" and "evidence dropped" in (g.get("detail") or ""))
    quotes = int(lineage_summary.get("quotes") or 0)
    verbatim = int(lineage_summary.get("verbatim") or 0)
    out += _rate("citation_validity", verbatim, quotes + dropped,
                 f"{verbatim} of {quotes + dropped} quotes verbatim; {dropped} dropped by QG2, "
                 f"{quotes - verbatim} kept but not verbatim")
    by_status = lineage_summary.get("by_status") or {}
    out.append(Score("claims_unsupported", float(by_status.get("untraced", 0)),
                     f"{by_status.get('partial', 0)} further claim(s) partly traced"))

    # Tool use.
    out += _tool_use(calls)
    ok = [c for c in calls if not c.get("error")]
    read_asis = sum(1 for c in ok if c.get("tool") == "read_sources"
                    and ((c.get("arguments") or {}).get("side") or "as_is") == "as_is")
    sap = sum(1 for c in ok if c.get("tool") == "search_sap_best_practice")
    missing = []
    if not read_asis:
        missing.append("the As-Is documents were never read")
    if sap < min_sap:
        missing.append(f"{sap} of {min_sap} required SAP Best Practice searches")
    out.append(_boolean("required_tools_met", not missing, "; ".join(missing)))
    out.append(_boolean("submitted_first_try", sendbacks == 0,
                        f"{sendbacks} send-back(s)" if sendbacks else ""))
    out.append(_boolean("budget_exhausted", budget_hit))
    out.append(_boolean("task_completed", True))

    # Topic adherence: a deviation belongs to this run when the steps it names
    # are steps of the process this run read. One naming a step that is not
    # there is about something else. A deviation naming no step is allowed --
    # the schema keeps that for one concerning no single step -- so it is left
    # out of the share and reported beside it.
    steps = {str(s.get("step_id")).strip() for s in asis.get("steps") or []}
    named = [[p.strip() for p in str(d.get("as_is_step_id") or "").split(",") if p.strip()]
             for d in analysis.get("deviations") or []]
    placed = [ids for ids in named if ids]
    on = sum(1 for ids in placed if all(i in steps for i in ids))
    out += _rate("topic_adherence", on, len(placed),
                 f"{on} of {len(placed)} deviations name only steps of this run's As-Is; "
                 f"{len(named) - len(placed)} name no step")

    out.append(Score("gate_hard_issues",
                     float(sum(1 for g in gate_items if g.get("severity") == "hard"))))
    out.append(Score("gate_soft_issues",
                     float(sum(1 for g in gate_items if g.get("severity") == "soft"))))

    from guardrails import contact
    out += _guardrails(verdict, calls, {"asis": asis, "analysis": analysis},
                       contact.redact_obj({"asis": asis, "analysis": analysis}))
    return out


def rollout_run(*, run: dict, verdict: dict | None,
                min_sap: int | Callable[[], int]) -> list[Score]:
    """`rollout` for a finished run as rollout/store.py holds one (calls, log,
    asis, analysis, gates, sources), building its lineage first. `min_sap`
    may be a callable, so a lookup that fails does so inside `evaluate`."""
    from rollout import lineage

    if callable(min_sap):
        min_sap = min_sap()

    log = run.get("log") or []
    return rollout(
        verdict=verdict,
        lineage_summary=lineage.build(run)["summary"],
        gate_items=(run.get("gates") or {}).get("items") or [],
        analysis=run.get("analysis") or {}, asis=run.get("asis") or {},
        calls=run.get("calls") or [],
        sendbacks=sum(1 for e in log if e.get("note") == "rejected"),
        budget_hit=any(e.get("note") == "budget" for e in log),
        min_sap=min_sap)


def rollout_incomplete(verdict: dict | None, calls: list[dict], why: str) -> list[Score]:
    """A Fit-Gap run that ended without an analysis."""
    return [_boolean("task_completed", False, why), *_tool_use(calls)]


# --- Langfuse -------------------------------------------------------------------


def push(trace_id: str, scores: list[Score]) -> None:
    """Write the scores to the trace on a background thread, so the network
    cannot hold up the run they describe.

    Score ids are stable per (trace, name), so re-scoring a run replaces its
    scores rather than adding a second set."""
    if not trace_id or not scores:
        return

    def work() -> None:
        try:
            _push(trace_id, scores)
        except Exception as exc:
            logger.warning("agent_eval: pushing scores to trace %s failed: %s", trace_id, exc)

    threading.Thread(target=work, name="agent-eval-push", daemon=True).start()


def _push(trace_id: str, scores: list[Score]) -> int:
    import tracing
    from evaluation import score_id

    lf = tracing.client()
    if lf is None:
        return 0
    written = 0
    for s in scores:
        if s.name not in SCORES:
            logger.warning("agent_eval: unknown score %r not written", s.name)
            continue
        try:
            lf.create_score(name=s.name, value=s.value, trace_id=trace_id,
                            data_type="BOOLEAN" if SCORES[s.name].boolean else "NUMERIC",
                            comment=s.comment[:1000] or None,
                            score_id=score_id(trace_id, s.name))
            written += 1
        except Exception as exc:
            logger.debug("Langfuse score %r failed: %s", s.name, exc)
    try:
        lf.flush()
    except Exception as exc:
        logger.debug("Langfuse flush after agent scoring failed: %s", exc)
    return written


def push_configs() -> int:
    """Declare each score's name, type and description to the Langfuse project.
    Existing configs are kept: Langfuse does not allow them to be edited."""
    from evaluation import _api

    existing = {c["name"] for c in (_api("GET", "/api/public/score-configs?limit=100")
                                    or {}).get("data", [])}
    made = 0
    for name, spec in SCORES.items():
        if name in existing:
            print(f"  kept   {name}")
            continue
        body: dict[str, Any] = {"name": name, "description": spec.description,
                                "dataType": "BOOLEAN" if spec.boolean else "NUMERIC"}
        if name in SHARES:
            body.update(minValue=0, maxValue=1)
        _api("POST", "/api/public/score-configs", body)
        print(f"  made   {name}")
        made += 1
    return made


if __name__ == "__main__":
    if sys.argv[1:] == ["configs"]:
        print(f"{push_configs()} score config(s) created.")
    else:
        print(__doc__.split("\n\n")[1])
        sys.exit(2)
