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
"""

from __future__ import annotations

import os
import time
from typing import Any

URL = os.environ.get("HINDSIGHT_URL", "http://127.0.0.1:8888").strip().rstrip("/")
API_KEY = os.environ.get("HINDSIGHT_API_KEY") or None
BANK = os.environ.get("HINDSIGHT_BANK", "spark-evidence").strip() or "spark-evidence"
TIMEOUT = float(os.environ.get("HINDSIGHT_TIMEOUT", "8"))
RECALL_TOKENS = int(os.environ.get("HINDSIGHT_RECALL_TOKENS", "1200"))

# How long an availability answer is trusted. The status endpoint is called on
# every page load and a run asks again before it starts; without this, a server
# that is down costs a connection refusal each time.
_PROBE_TTL = 30.0

_client: Any = None
_probe: tuple[float, bool, str] = (0.0, False, "")


def configured() -> bool:
    """Whether memory is switched on at all. An empty HINDSIGHT_URL means no."""
    return bool(URL)


def _get():
    """The client, made once. None when the library is absent or URL is empty."""
    global _client
    if not configured():
        return None
    if _client is None:
        try:
            from hindsight_client import Hindsight
        except ImportError:
            return None
        _client = Hindsight(base_url=URL, api_key=API_KEY, timeout=TIMEOUT)
    return _client


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
    """Release the client's HTTP session. Called from the app's shutdown.

    Without it aiohttp prints "Unclosed client session" on exit, which looks
    like a leak in this application rather than a socket nobody asked to keep.
    """
    global _client, _probe
    client, _client, _probe = _client, None, (0.0, False, "")
    if client is not None:
        try:
            client.close()
        except Exception:
            pass
