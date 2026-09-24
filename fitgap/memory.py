"""Long-term memory for the agents, over Hindsight (vectorize-io/hindsight).

The agents are amnesiac. Every investigation starts from nothing, re-derives
what the last one already worked out, and spends its tool budget doing it. The
corpus does not change between two questions about the same interface, so the
second run pays full price for the first run's conclusions.

Hindsight is an agent memory service: `retain` writes facts, `recall` searches
them with four strategies at once (semantic, BM25, an entity graph, and a
temporal arm). It runs as an HTTP server -- this module is only the client half
and a policy about what may be written.

═══ MEMORY IS NOT EVIDENCE ═══

This is the whole design, and it is enforced here rather than asked for in a
prompt. A claim in this system is carried by a quote, and a quote is verified
against `session.retrieved` -- which only the retrieval tools write. Nothing
recalled from memory is in there, so a quote taken from a memory fails
verification and its claim falls to the floor. That is the existing machinery
and it already does the right thing.

So memory is allowed to ORIENT a run -- which document to open first, which
route turned out to be an artefact last time -- and is structurally incapable
of GROUNDING one. Two rules follow, and they are applied here:

  * only VERIFIED claims are ever retained. A claim whose quote could not be
    found in the chunk it named is exactly the kind of thing memory must not
    learn, because nothing downstream will re-check it.
  * a holdout run neither reads nor writes. Holdout exists to measure the
    agent against a corpus with the fit registers hidden; a previous run's
    answer arriving through memory would quietly answer the question being
    asked, and the measurement would be of the memory, not the agent.

═══ FAILURE IS NORMAL ═══

The server is a separate process that is usually not running. Every call here
is best-effort and short-deadline: a memory lookup that hangs must not hold up
an investigation, and a memory write that fails must not fail a run that has
already produced an answer. Everything returns empty or False rather than
raising, and `available()` is what the UI asks before offering the toggle.

Configuration, all optional:

    HINDSIGHT_URL        default http://127.0.0.1:8888; empty disables memory
    HINDSIGHT_API_KEY    bearer token, for a server that wants one
    HINDSIGHT_BANK       default "spark-evidence"
    HINDSIGHT_TIMEOUT    seconds, default 8 -- deliberately far below the
                         client's own 300s default, which would stall a run
    HINDSIGHT_RECALL_TOKENS  default 1200, the ceiling on what one recall may
                         put into the agent's context
    HINDSIGHT_REFLECT_TIMEOUT  seconds, default 120. Separate from the one
                         above on purpose: see reflect().
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

URL = os.environ.get("HINDSIGHT_URL", "http://127.0.0.1:8888").strip().rstrip("/")
API_KEY = os.environ.get("HINDSIGHT_API_KEY") or None
BANK = os.environ.get("HINDSIGHT_BANK", "spark-evidence").strip() or "spark-evidence"
TIMEOUT = float(os.environ.get("HINDSIGHT_TIMEOUT", "8"))
RECALL_TOKENS = int(os.environ.get("HINDSIGHT_RECALL_TOKENS", "1200"))
# Reflect is a different kind of call and needs a different deadline. TIMEOUT
# is 8s because recall and retain sit in front of an investigation and must
# never hold one up. Reflect sits in front of a person who pressed a button,
# reads the whole bank and writes an answer with an LLM -- on Opus that is
# tens of seconds, and it timed out at 8 the first time it was tried.
REFLECT_TIMEOUT = float(os.environ.get("HINDSIGHT_REFLECT_TIMEOUT", "120"))

# How long an availability answer is trusted. The status endpoint is called on
# every page load and a run asks again before it starts; without this, a server
# that is down costs a connection refusal each time.
_PROBE_TTL = 30.0

# One client per THREAD, not one per process.
#
# The client wraps an async library, and its session belongs to the event loop
# that made it. Reuse it from another thread and every call fails with
#
#     RuntimeError: Timeout context manager should be used inside a task
#
# which `available()` faithfully reports as "the memory server is down". It is
# not: the server is fine and the thread is wrong. FastAPI runs `def`
# endpoints on a threadpool, so after the first request the status endpoint
# answered `available: false` on every thread but one, the memory toggle went
# grey, and the Ask memory button disabled itself -- with a healthy server on
# the other end of the socket.
#
# It survived this long because a single-threaded probe is the one case that
# works, which is also what every test and every manual check had been doing.
_local = threading.local()

# Every client handed out, so shutdown can close all of them and not just the
# one belonging to whichever thread happened to call close().
_all_clients: list[Any] = []
_clients_lock = threading.Lock()

_probe: tuple[float, bool, str] = (0.0, False, "")


def configured() -> bool:
    """Whether memory is switched on at all. An empty HINDSIGHT_URL means no."""
    return bool(URL)


def _make(attr: str, timeout: float):
    """This thread's client for `attr`, made on first use here. See _local."""
    if not configured():
        return None
    client = getattr(_local, attr, None)
    if client is None:
        try:
            from hindsight_client import Hindsight
        except ImportError:
            return None
        client = Hindsight(base_url=URL, api_key=API_KEY, timeout=timeout)
        setattr(_local, attr, client)
        with _clients_lock:
            _all_clients.append(client)
    return client


def _get():
    """This thread's client, on the short deadline. Recall, retain, status."""
    return _make("client", TIMEOUT)


def _get_reflect():
    """This thread's client, on the long deadline. Only reflect() uses it.

    A second client rather than a second argument: the timeout belongs to the
    client, so reflect cannot borrow the one above without also giving recall
    and retain a two-minute deadline -- which is the thing TIMEOUT exists to
    prevent.
    """
    return _make("reflect_client", REFLECT_TIMEOUT)


def available(force: bool = False) -> tuple[bool, str]:
    """Is the server up? Returns (ok, detail). Cached for _PROBE_TTL seconds.

    `detail` is the API version when it is up and the reason when it is not,
    because "memory is off" and "memory is broken" need different answers from
    whoever is looking at the page.
    """
    global _probe
    if not configured():
        return False, "HINDSIGHT_URL is empty, so memory is switched off"
    at, ok, detail = _probe
    if not force and time.time() - at < _PROBE_TTL:
        return ok, detail
    client = _get()
    if client is None:
        _probe = (time.time(), False, "hindsight-client is not installed")
        return _probe[1], _probe[2]
    try:
        version = client.get_version()
        detail = f"Hindsight API {getattr(version, 'api_version', '?')}"
        _probe = (time.time(), True, detail)
    except Exception as exc:
        _probe = (time.time(), False, f"{type(exc).__name__}: {exc}"[:200])
    return _probe[1], _probe[2]


def ensure_bank(bank: str = "") -> bool:
    """Create the bank if it is not there. Idempotent, and never raises."""
    client = _get()
    if client is None:
        return False
    try:
        client.create_bank(bank_id=bank or BANK)
        return True
    except Exception:
        # Almost always "already exists", which is the state we wanted.
        return True


def allowed(enabled: bool, holdout: bool) -> bool:
    """Whether this run may read and write memory. The rule, in one place.

    Holdout wins over the toggle. Holdout exists to measure the agent against a
    corpus with the fit registers hidden, and memory holds the answers earlier
    runs reached over the corpus WITH them -- so a holdout run that reads memory
    is measuring the memory, not the agent, and would score well for the wrong
    reason. Writing is refused for the mirror of that reason: a holdout answer
    was reached without half the corpus, and is not a finding about it.

    Named rather than written inline at the one call site, because it is the
    kind of condition somebody simplifies while tidying up and nothing
    downstream would notice.
    """
    return bool(enabled) and not holdout


def recall(query: str, bank: str = "", limit: int = 6) -> list[dict]:
    """What earlier runs concluded about this, newest-relevant first.

    Returns a list of {text, type, id, score}. Empty on any failure, including
    the server being down, which is the ordinary case.
    """
    client = _get()
    if client is None or not query.strip():
        return []
    try:
        response = client.recall(bank_id=bank or BANK, query=query,
                                 max_tokens=RECALL_TOKENS, budget="low")
    except Exception:
        return []
    out = []
    for result in (getattr(response, "results", None) or [])[:limit]:
        text = (getattr(result, "text", "") or "").strip()
        if not text:
            continue
        scores = getattr(result, "scores", None) or {}
        out.append({
            "id": str(getattr(result, "id", "") or ""),
            "text": text,
            "type": str(getattr(result, "type", "") or ""),
            "score": (scores.get("final") if isinstance(scores, dict) else None),
        })
    return out


def retain(content: str, bank: str = "", context: str = "",
           metadata: dict[str, str] | None = None,
           tags: list[str] | None = None) -> bool:
    """Write one memory. Asynchronous on the server, best-effort here.

    retain_async so the call returns as soon as the server has accepted the
    text: fact extraction is an LLM job and an investigation that has already
    answered must not wait on it.
    """
    client = _get()
    if client is None or not content.strip():
        return False
    try:
        client.retain(bank_id=bank or BANK, content=content,
                      context=context or None,
                      metadata={k: str(v) for k, v in (metadata or {}).items()} or None,
                      tags=tags or None, retain_async=True)
        return True
    except Exception:
        return False


def _facts_in(output: Any) -> list[dict]:
    """Every memory a reflect tool call returned, whatever shape it came in.

    The trace carries raw tool output, and the four tools (lookup, recall,
    learn, expand) do not agree on a shape: some return a list, some an object
    with `results`, some with `memories` or `facts`. Anything without text is
    not a memory and is skipped rather than guessed at.
    """
    if output is None:
        return []
    if isinstance(output, dict):
        rows = None
        for key in ("results", "memories", "facts", "items"):
            if isinstance(output.get(key), list):
                rows = output[key]
                break
        if rows is None:
            rows = [output] if output.get("text") else []
    elif isinstance(output, list):
        rows = output
    else:
        return []

    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        out.append({"id": str(row.get("id") or ""), "text": text,
                    "type": str(row.get("fact_type") or row.get("type") or "")})
    return out


def reflect(query: str, bank: str = "", context: str = "",
            max_tokens: int = 1400) -> dict:
    """Ask the bank a question it has to think about. NOT for the agent.

    recall() searches and returns rows. reflect() reads the bank and writes an
    answer -- an LLM call on the server, over memories that were themselves
    written by an LLM. Two differences follow from that, and both are why this
    is deliberately not wired into an investigation:

      * it is slow and it costs. On Opus a reflection re-reads the bank and
        runs to tens of seconds and cents, per press. An investigation cannot
        afford that in front of every question, and REFLECT_TIMEOUT rather
        than TIMEOUT is how this call gets the room it needs.

      * it is a summary of summaries, which is one more step away from a
        verified quote than a memory already is. The structural guarantee
        still holds -- nothing here is in `session.retrieved`, so none of it
        can be cited -- but the safest place for prose the agent cannot check
        is in front of a PERSON, who can, and not in a prompt.

    So this exists for the questions no single run and no corpus document can
    answer: what have we investigated, where did two runs disagree, what is
    still open. Returns {text, based_on, usage, error}; `text` empty on any
    failure, with `error` saying why, because a person pressed a button and is
    owed a reason rather than a blank panel.
    """
    client = _get_reflect()
    if client is None:
        return {"text": "", "based_on": [], "usage": {}, "searched": [],
                "error": "Memory is not configured on this server."}
    if not query.strip():
        return {"text": "", "based_on": [], "usage": {}, "searched": [],
                "error": "Ask something."}
    try:
        # include_tool_calls, not include_facts. `based_on` is the obvious
        # field and it is always empty here: Hindsight's reflect is AGENTIC --
        # it runs a loop of searches rather than being handed a fixed set of
        # facts -- and its own docstring says so, "based_on: Empty dict (agent
        # retrieves facts dynamically)". Asking for facts returns an answer
        # with no sources and no error, which reads as a server that forgot to
        # send them. What it actually searched is in the trace.
        response = client.reflect(bank_id=bank or BANK, query=query,
                                  context=context or None, budget="low",
                                  max_tokens=max_tokens,
                                  include_tool_calls=True,
                                  include_tool_call_output=True)
    except Exception as exc:
        return {"text": "", "based_on": [], "usage": {}, "searched": [],
                "error": f"{type(exc).__name__}: {exc}"[:300]}

    # Provenance, rebuilt from the trace: which searches it ran and what each
    # returned. A briefing that cannot show its working is the one thing this
    # panel must not be, given it is prose nobody downstream re-checks.
    based_on, seen = [], set()
    searched = []
    trace = getattr(response, "trace", None)
    for call in (getattr(trace, "tool_calls", None) or []):
        params = getattr(call, "input", None) or {}
        if isinstance(params, dict):
            wanted = str(params.get("query") or params.get("q") or "").strip()
            if wanted and wanted not in searched:
                searched.append(wanted)
        for fact in _facts_in(getattr(call, "output", None)):
            key = fact["id"] or fact["text"]
            if key in seen:
                continue
            seen.add(key)
            based_on.append(fact)

    usage = getattr(response, "usage", None)
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()
    elif not isinstance(usage, dict):
        usage = {}

    return {"text": (getattr(response, "text", "") or "").strip(),
            "based_on": based_on, "searched": searched, "usage": usage, "error": ""}


def stats(bank: str = "") -> dict:
    """How much the bank holds, for the page. Zeroes when it cannot be read."""
    client = _get()
    if client is None:
        return {"memories": 0}
    try:
        listed = client.list_memories(bank_id=bank or BANK, limit=1)
        total = getattr(listed, "total", None)
        if total is None:
            total = len(getattr(listed, "items", None) or [])
        return {"memories": int(total)}
    except Exception:
        return {"memories": 0}


def describe() -> dict:
    """Everything the UI needs to decide what to show, in one call."""
    ok, detail = available()
    info = {"configured": configured(), "available": ok, "detail": detail,
            "url": URL, "bank": BANK}
    if ok:
        info.update(stats())
    return info


def close() -> None:
    """Release every client's HTTP session. Called from the app's shutdown.

    Without it aiohttp prints "Unclosed client session" on exit, which looks
    like a leak in this application rather than a socket nobody asked to keep.

    Clients made on other threads are closed from this one, which aiohttp
    grumbles about ("Task was destroyed but it is pending"). That is the
    lesser of the two noises -- leaving them prints the unclosed-session
    warning per client instead -- and closing a session from the thread that
    owns it would mean keeping those threads alive to be asked, which is not
    worth a tidier exit.
    """
    global _probe
    with _clients_lock:
        clients, _all_clients[:] = list(_all_clients), []
    _local.__dict__.clear()
    _probe = (0.0, False, "")
    for client in clients:
        try:
            client.close()
        except Exception:
            pass
