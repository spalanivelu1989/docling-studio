"""Map-reduce over a BPML scope, streamed as events (handover §4, §9).

One bounded agent run per step, several in flight at once, then a single
synthesis pass. Events are emitted as they happen rather than at the end, so
the UI can show a register filling in instead of a spinner.
"""

from __future__ import annotations

import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from . import agent, bpml, store, synthesis, tools, verifier
from .schemas import RunRequest, VerifiedEntry

Event = tuple[str, dict]


def preview(req: RunRequest) -> dict:
    """What a run would do, without doing it -- so the UI can show the cost
    of the button before it is pressed (§10)."""
    scope = bpml.get(req.scope_bpml) or bpml.resolve_scope(req.scope_bpml)
    if not scope:
        return {"error": f"'{req.scope_bpml}' does not resolve to a BPML process"}
    steps = bpml.steps_in_scope(scope.code)
    capped = steps[: req.max_steps]
    return {
        "scope": scope.full(),
        "scope_label": f"{scope.code} {scope.name}",
        "ancestry": [a.brief() for a in tools._ancestry(scope)],
        "steps_total": len(steps),
        "steps_planned": len(capped),
        "steps": [s.brief() for s in capped],
        "model": agent.MODEL,
        "max_tool_calls": agent.MAX_TOOL_CALLS,
        # Rough, and labelled as such: ~5 tool calls and ~25k input tokens is
        # what a typical step costs once the corpus excerpts are counted.
        "estimated_input_tokens": len(capped) * 25000,
        "estimated_minutes": round(len(capped) * 0.75 / max(req.concurrency, 1), 1),
    }


def run(req: RunRequest) -> Iterator[Event]:
    """Yields ('scope'|'step_start'|'tool_call'|'entry'|'verify_fail'|
    'synthesis'|'done'|'error', payload)."""
    started = time.time()
    scope = bpml.get(req.scope_bpml) or bpml.resolve_scope(req.scope_bpml)
    if not scope:
        yield "error", {"message": f"'{req.scope_bpml}' does not resolve to a BPML process"}
        return

    steps = bpml.steps_in_scope(scope.code)[: req.max_steps]
    if not steps:
        yield "error", {"message": f"{scope.code} has no steps to classify"}
        return

    run_id = f"fg_{uuid.uuid4().hex[:10]}"
    conn = store.connect()
    try:
        store.create_schema(conn)
        record = {
            "id": run_id, "mode": req.mode, "scope_bpml": scope.code,
            "scope_label": f"{scope.code} {scope.name}", "question": req.question or "",
            "country": req.country_profile, "model": agent.MODEL,
            "prompt_hash": agent.prompt_hash(), "holdout": req.holdout,
            "corpus_fingerprint": store.corpus_fingerprint(conn),
            "params": {"max_steps": req.max_steps, "concurrency": req.concurrency,
                       "max_tool_calls": agent.MAX_TOOL_CALLS, "asis_dir": req.asis_dir},
        }
        store.start_run(conn, record)

        yield "scope", {
            "run_id": run_id, "scope": scope.full(),
            "scope_label": record["scope_label"],
            "ancestry": [a.brief() for a in tools._ancestry(scope)],
            "steps": [s.brief() for s in steps],
            "mode": req.mode, "holdout": req.holdout, "model": agent.MODEL,
            "prompt_hash": record["prompt_hash"],
            "corpus_fingerprint": record["corpus_fingerprint"],
        }

        events: queue.Queue = queue.Queue()
        results: dict[str, VerifiedEntry] = {}
        lock = threading.Lock()

        def work(step: bpml.Process) -> None:
            events.put(("step_start", {"bpml_code": step.code, "step_name": step.name,
                                       "level": step.level}))
            session = tools.Session(holdout=req.holdout)
            try:
                def on_tool(call: tools.ToolCall) -> None:
                    events.put(("tool_call", {
                        "bpml_code": step.code, "tool": call.name,
                        "summary": call.summary, "ms": call.ms, "error": call.error,
                    }))

                result, session = agent.run_step(
                    step, run_id, mode=req.mode, holdout=req.holdout,
                    country=req.country_profile, question=req.question,
                    on_tool=on_tool, session=session,
                )
                result = verifier.verify(result, session, mode=req.mode)
                hard = [i for i in result.issues if i.severity == "hard"]
                if hard:
                    events.put(("verify_fail", {
                        "bpml_code": step.code,
                        "issues": [i.model_dump() for i in hard],
                        "repaired": result.repaired,
                    }))
                with lock:
                    results[step.code] = result
                entry_id = store.save_entry(conn, run_id, result)
                events.put(("entry", {
                    "id": entry_id, **result.entry.model_dump(),
                    "issues": [i.model_dump() for i in result.issues],
                    "evidence_valid": result.evidence_valid,
                    "tool_calls": result.tool_calls, "seconds": result.seconds,
                    "input_tokens": result.input_tokens, "output_tokens": result.output_tokens,
                }))
            except Exception as exc:
                events.put(("step_error", {
                    "bpml_code": step.code, "step_name": step.name,
                    "message": f"{type(exc).__name__}: {exc}",
                }))
            finally:
                session.close()

        pool = ThreadPoolExecutor(max_workers=req.concurrency, thread_name_prefix="fitgap")
        futures = [pool.submit(work, s) for s in steps]

        def close_pool() -> None:
            for f in futures:
                f.exception()
            pool.shutdown(wait=True)
            events.put(("__done__", {}))

        threading.Thread(target=close_pool, daemon=True).start()

        while True:
            name, payload = events.get()
            if name == "__done__":
                break
            yield name, payload

        ordered = [results[s.code] for s in steps if s.code in results]
        synth = synthesis.synthesise(ordered)
        tokens = (sum(r.input_tokens for r in ordered), sum(r.output_tokens for r in ordered))
        store.finish_run(conn, run_id, synth, tokens)

        yield "synthesis", synth
        yield "done", {
            "run_id": run_id,
            "steps": len(steps),
            "entries": len(ordered),
            "failed": len(steps) - len(ordered),
            "seconds": round(time.time() - started, 1),
            "input_tokens": tokens[0], "output_tokens": tokens[1],
            "verification": verifier.summarise(ordered),
        }
    except Exception as exc:
        yield "error", {"message": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()
