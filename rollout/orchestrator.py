"""One Rollout Agent run, streamed as events.

The run is two agent passes with a deterministic middle and end: read the
As-Is, compare it, then run the quality gates and the arithmetic. Events are
emitted as they happen so the page can show the As-Is model filling in while
the comparison is still running -- the first pass is the slow one, and a
spinner over both would hide the part the analyst most wants to check.
"""

from __future__ import annotations

import queue
import threading
import time
import uuid
from typing import Callable, Iterator

import rag
import tracing
import uploads

from fitgap import bpml, tools as ftools

from . import agent, gates, scoring, sources as sources_index, store
from .schemas import SUBJECTS, RunRequest

Event = tuple[str, dict]


def _resolve(text: str) -> tuple[object | None, str]:
    """(process, error). Naming no Global Template process is allowed and
    gives (None, ""); naming one that does not resolve is not.

    The distinction matters: an unresolvable code is almost always a typo, and
    treating it as "no scope" would silently analyse against a different
    template process than the one the analyst asked for."""
    text = (text or "").strip()
    if not text:
        return None, ""
    found = bpml.get(text) or bpml.resolve_scope(text)
    if not found:
        return None, (f"'{text}' does not resolve to a BPML process. Clear the field to let "
                      "the agent identify the template process itself.")
    return found, ""


def preview(req: RunRequest) -> dict:
    """What a run would do, before it is paid for."""
    subject = SUBJECTS[req.subject]
    scope, bad = _resolve(req.scope_bpml)
    if bad:
        return {"error": bad}
    try:
        attached = uploads.files(req.upload_session) if req.upload_session else []
    except ValueError:
        # A session id the page still holds after the store was swept.
        attached = []
    by_role: dict[str, int] = {}
    for f in attached:
        by_role[f["role"]] = by_role.get(f["role"], 0) + 1
    ready = by_role.get(subject.role, 0) > 0
    return {
        "scope": scope.full() if scope else None,
        "scope_label": f"{scope.code} {scope.name}" if scope else "",
        "ancestry": [a.brief() for a in ftools._ancestry(scope)] if scope else [],
        "steps_total": len(bpml.steps_in_scope(scope.code)) if scope else 0,
        "attached": [{"name": f["name"], "role": f["role"], "role_label": f["role_label"],
                      "chunks": f["chunks"]} for f in attached],
        "by_role": by_role,
        "ready": ready,
        "subject": subject.key,
        "subject_label": subject.label,
        "required_role": subject.role,
        "blocker": "" if ready else
                   (f"Attach the {subject.label} documentation and tag it "
                    f"\"{subject.label}\" — there is nothing to analyse without it."),
        "sap_bp_available": by_role.get("sap_bp", 0) > 0 and subject.score_b,
        "model": agent.MODEL,
        "max_tool_calls": agent.MAX_TOOL_CALLS,
        # Two passes, and the comparison pass re-reads the corpus; measured
        # runs land near this and it is labelled an estimate in the UI.
        "estimated_input_tokens": 120000,
        "estimated_minutes": 4.0,
    }


def run(req: RunRequest) -> Iterator[Event]:
    """Yields ('scope'|'stage'|'tool_call'|'asis'|'analysis'|'gate'|'scores'|
    'done'|'error', payload)."""
    started = time.time()
    subject = SUBJECTS[req.subject]
    scope, bad = _resolve(req.scope_bpml)
    if bad:
        yield "error", {"message": bad}
        return

    session_id = (req.upload_session or "").strip()
    if not session_id:
        yield "error", {"message": f"Attach the {subject.label} documentation before running."}
        return
    try:
        if not uploads.exists(session_id):
            yield "error", {"message": "The attached documents have expired; upload them again."}
            return
    except ValueError as exc:
        yield "error", {"message": str(exc)}
        return

    attached = uploads.files(session_id)
    roles = {f["role"] for f in attached}
    if subject.role not in roles:
        yield "error", {"message": (f"No attached document is tagged \"{subject.label}\". "
                                    "The agent has nothing to analyse against the template.")}
        return
    uploads.touch(session_id)

    categories = tuple(sorted({c.strip().upper() for c in (req.categories or []) if c.strip()}))
    run_id = f"ro_{uuid.uuid4().hex[:10]}"
    # Enforced on the session, so neither pass can read outside what was chosen
    # -- and so the tools that read "the subject" read this run's subject.
    sess = ftools.Session(categories=categories, uploads=session_id,
                          subject_role=subject.role)

    conn = store.connect()
    # Bound before the try so the error path below can always close it.
    run = tracing.Run(None, {})
    try:
        store.create_schema(conn)
        record = {
            "id": run_id, "subject": subject.key,
            "scope_bpml": scope.code if scope else "",
            # Empty until the analysis lands, when the agent's own match fills
            # it in -- see finish_run.
            "scope_label": f"{scope.code} {scope.name}" if scope else "",
            "country": req.country, "country_context": req.country_context,
            "sap_release": req.sap_release, "gt_version": req.gt_version,
            "question": req.question or "", "model": agent.MODEL,
            "prompt_hash": agent.prompt_hash(subject),
            "categories": list(categories),
            "uploads": {"session": session_id, "schema": uploads.schema_name(session_id),
                        "documents": [{"name": f["name"], "role": f["role"]} for f in attached]},
            "corpus_fingerprint": _fingerprint(categories),
        }
        store.start_run(conn, record)

        # One trace for the whole run. The upload session is the Langfuse
        # session: it is what ties several analyses of the same attached
        # documents together, including the ones the Copilot ran. There is no
        # user_id because this application has no accounts -- see the note in
        # app.py's module docstring.
        run = tracing.start_run(
            "analyse-rollout",
            input={
                "subject": subject.label,
                "country": req.country,
                "template_process": record["scope_label"] or "(for the agent to identify)",
                "question": req.question or "",
                "attached": [f"{f['name']} ({f['role']})" for f in attached],
                "country_context": req.country_context,
            },
            metadata={
                "run_id": run_id, "model": agent.MODEL,
                "prompt_hash": record["prompt_hash"],
                "corpus_fingerprint": record["corpus_fingerprint"],
                "categories": list(categories) or "all",
                "upload_schema": record["uploads"]["schema"],
                "max_tool_calls": agent.MAX_TOOL_CALLS,
            },
            session_id=session_id,
            tags=["rollout-agent",
                  f"subject-{subject.key.replace('_', '-')}",
                  (req.country or "no-country").lower(),
                  "scoped" if scope else "unscoped"],
        )

        yield "scope", {
            "run_id": run_id,
            "scope": scope.full() if scope else None,
            "scope_label": record["scope_label"],
            "ancestry": [a.brief() for a in ftools._ancestry(scope)] if scope else [],
            "country": req.country, "model": agent.MODEL,
            "subject": subject.key, "subject_label": subject.label,
            "prompt_hash": record["prompt_hash"],
            "corpus_fingerprint": record["corpus_fingerprint"],
            "categories": list(categories), "uploads": record["uploads"],
            "sap_bp_available": "sap_bp" in roles,
        }

        # --- pass one: understand the As-Is (§21 stage 2) -------------------
        yield "stage", {"stage": "asis", "status": "running",
                        "detail": "Reading the country As-Is documentation"}
        box: dict = {}
        yield from _pass(lambda cb: agent.read_asis(req, scope, sess, cb), box, run,
                         "read-as-is", lambda m: {"steps": len(m.steps),
                                                  "evidence_gaps": len(m.evidence_gaps)})
        if box.get("error"):
            raise box["error"]
        asis, asis_cost = box["result"]
        if asis is None:
            store.fail_run(conn, run_id, "the agent did not submit an As-Is model")
            run.update(level="WARNING", status_message="no As-Is model was submitted")
            run.end(output={"error": "the agent did not submit an As-Is model"})
            yield "error", {"message": ("The agent did not produce an As-Is model. The attached "
                                        "documentation may not describe a process.")}
            return
        asis.country = asis.country or req.country
        store.save_asis(conn, run_id, asis.model_dump())
        yield "stage", {"stage": "asis", "status": "done",
                        "detail": f"{len(asis.steps)} atomic steps", **asis_cost}
        yield "asis", asis.model_dump()

        # --- pass two: the three-way comparison (§21 stages 4-6) ------------
        yield "stage", {"stage": "compare", "status": "running",
                        "detail": "Comparing against the Global Template"}
        box = {}
        yield from _pass(lambda cb: agent.compare(req, scope, asis, sess, cb), box, run,
                         "compare-to-template",
                         lambda a: {"deviations": len(a.deviations),
                                    "fit_areas": len(a.fit_areas),
                                    "template_process": a.template_process[:120]})
        if box.get("error"):
            raise box["error"]
        analysis, cmp_cost = box["result"]
        if analysis is None:
            store.fail_run(conn, run_id, "the agent did not submit an analysis")
            run.update(level="WARNING", status_message="no analysis was submitted")
            run.end(output={"error": "the agent did not submit an analysis"})
            yield "error", {"message": "The agent did not submit an analysis."}
            return
        yield "stage", {"stage": "compare", "status": "done",
                        "detail": f"{len(analysis.deviations)} deviations", **cmp_cost}

        # --- the deterministic end (§25, §12) -------------------------------
        yield "stage", {"stage": "gates", "status": "running", "detail": "Quality gates"}
        # `evaluator` rather than `span`: the gates assess the analysis and
        # repair it, which is what that observation type is for, and it makes
        # them countable against the runs they rejected.
        with run.step("check-quality-gates", as_type="evaluator",
                      input={"deviations": len(analysis.deviations)}) as gate_span:
            analysis, issues = gates.check(analysis, asis, sess,
                                           has_sap_bp_source="sap_bp" in roles,
                                           scope_named=scope is not None,
                                           subject=subject)
            gate_summary = {**gates.summarise(issues),
                            "items": [i.model_dump() for i in issues]}
            gate_span.update(output={k: v for k, v in gate_summary.items() if k != "items"})
        yield "gate", gate_summary
        yield "stage", {"stage": "gates", "status": "done",
                        "detail": f"{gate_summary['hard']} hard, {gate_summary['soft']} soft"}

        scores = scoring.score(analysis, subject)
        scores["heatmap"] = scoring.heatmap(analysis)
        scores["agenda"] = scoring.agenda(analysis)
        tokens = (asis_cost["input_tokens"] + cmp_cost["input_tokens"],
                  asis_cost["output_tokens"] + cmp_cost["output_tokens"])
        # Built from the retrieval log, which dies with the session -- so it
        # has to happen here, before the generator returns.
        trace = sources_index.index(
            analysis.model_dump(), asis.model_dump(), sess.retrieved,
            upload_names={f["name"] for f in attached},
        )
        store.finish_run(conn, run_id, analysis.model_dump(), scores, gate_summary, tokens,
                         sources=trace)

        run.end(output=_headline(analysis, scores, gate_summary, record["scope_label"]))

        yield "analysis", analysis.model_dump()
        yield "scores", scores
        yield "sources", trace
        yield "done", {
            "run_id": run_id,
            "seconds": round(time.time() - started, 1),
            "input_tokens": tokens[0], "output_tokens": tokens[1],
            "tool_calls": asis_cost["tool_calls"] + cmp_cost["tool_calls"],
        }
    except Exception as exc:
        try:
            store.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
        except Exception:
            pass
        run.fail(exc)
        run.end()
        yield "error", {"message": f"{type(exc).__name__}: {exc}"}
    finally:
        # A run abandoned by the browser leaves the generator un-closed at the
        # last yield, so this is also where a half-finished trace is pushed.
        run.end()
        uploads.close()
    # `conn` is shared and cached per thread, so it is deliberately left open.


def _pass(work: Callable, out: dict, run: tracing.Run, name: str,
          summarise: Callable) -> Iterator[Event]:
    """Run one agent pass on a worker thread, yielding its tool calls as they
    happen. The pass's `(result, cost)` lands in `out["result"]`.

    This used to collect the calls and emit them after the pass returned, on
    the reasoning that a pass was a few quick tool calls inside one long model
    turn. Measurement said otherwise: the comparison pass runs for about nine
    minutes and makes seventeen calls, so the progress panel showed a spinner
    for the whole run and then seventeen lines at once -- the opposite of what
    a progress panel is for.

    The worker closes its own database connections. They are thread-local, so
    the generator's thread cannot close them and they would otherwise leak one
    set per pass.

    The trace's observation for the pass is opened here, on the worker thread,
    for the same reason: OpenTelemetry nests by a context variable, and the
    thread that runs the model calls is the one whose context has to hold the
    pass. `run.step` parents it explicitly, so it lands under the run even
    though this thread inherited nothing."""
    events: queue.Queue = queue.Queue()

    def run_pass() -> None:
        try:
            with run.step(name, as_type="agent") as span:
                out["result"] = work(
                    lambda call, stage: events.put(("tool_call", _call_event(stage, call))))
                model, cost = out["result"]
                span.update(output=summarise(model) if model is not None else None,
                            metadata=cost)
                if model is None:
                    span.update(level="WARNING",
                                status_message="the pass ended without submitting")
        except BaseException as exc:  # re-raised on the generator's thread
            out["error"] = exc
        finally:
            rag.close()
            uploads.close()
            events.put(("__end__", {}))

    threading.Thread(target=run_pass, name="rollout-pass", daemon=True).start()
    while True:
        name, payload = events.get()
        if name == "__end__":
            return
        yield name, payload


def _headline(analysis, scores: dict, gates_summary: dict, scope_label: str) -> dict:
    """What a run says about itself in one line of a trace list.

    The counts are taken as whole sub-dictionaries rather than by picking
    individual keys out of them. Picking is how the first version of this
    reported `must_discuss: 0` on a run with nine must-discuss deviations: it
    looked for a key named `must` and `scoring.counts` calls it `MUST_DISCUSS`,
    so the mistake was invisible -- a plausible number, quietly wrong. A trace
    that misreports is worse than one that says nothing, so there is a test on
    this function using a real scoring payload."""
    counts = scores.get("counts") or {}
    return {
        "gt_alignment": scores.get("gt_alignment"),
        "gt_band": scores.get("gt_band"),
        "localization_adjusted": scores.get("localization_adjusted"),
        "pattern": scores.get("pattern"),
        "deviations": len(analysis.deviations),
        "workshop": counts.get("workshop"),
        "workshop_minutes": counts.get("workshop_minutes"),
        "by_materiality": counts.get("by_materiality"),
        "open_questions": len(analysis.open_questions),
        "hard_gate_failures": gates_summary.get("hard"),
        "soft_gate_findings": gates_summary.get("soft"),
        "template_process": (analysis.template_process[:200] or scope_label),
    }


def _call_event(stage: str, call) -> dict:
    return {"stage": stage, "tool": call.name, "summary": call.summary,
            "ms": call.ms, "error": call.error, "sources": call.sources}


def _fingerprint(categories) -> str:
    """Scoped to what this run could read, like the Copilot's."""
    import hashlib

    h = hashlib.sha256()
    try:
        codes = [rag.check_category(c) for c in (categories or []) if c]
        conn = rag.connection()
        rows = (conn.execute("SELECT source, fingerprint FROM rag_documents"
                             " WHERE category = ANY(%s)", (codes,)).fetchall()
                if codes else
                conn.execute("SELECT source, fingerprint FROM rag_documents").fetchall())
        for _, fp in sorted(rows):
            h.update(fp.encode())
    except Exception:
        return ""
    return h.hexdigest()[:16]
