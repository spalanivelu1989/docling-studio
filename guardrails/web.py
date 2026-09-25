"""Web search the agents may ask for, and the code decides whether they get.

The agents are corpus-first: the programme's own documents are the evidence,
and the verifier will not let a claim stand on anything else. Some tasks do
need an outside fact the corpus cannot hold -- what SAP delivers as standard,
what a country's e-invoicing law requires -- and for those the agent can call
`web_search`. Whether the call RUNS is decided here, not by the model:

  1. Web search is switched on (AGENT_WEB_SEARCH) and this is not a holdout run.
     Holdout measures the agent against a corpus with answers hidden; the web
     would be a way around that.
  2. The corpus has already been searched in this run. The web is a fallback
     for a gap, never the first place an agent looks.
  3. The run has searches left (AGENT_WEB_MAX_SEARCHES, default 2).
  4. The query carries nothing internal: no ticket numbers, no BPML codes, no
     e-mail addresses or phone numbers. A query leaves the building; the
     programme's identifiers must not.
  5. The query is itself about the programme's subject matter (scope.check).
     A web search is not a way to answer "who won the match".

What comes back is Anthropic's server-side web search, restricted to an
allow-list of sites (AGENT_WEB_DOMAINS), with the answer's citations as the
only thing kept. Each citation is a verbatim passage from a page, and each
becomes a "chunk" in the session's retrieval record under a WEB: id -- so a
claim built on it is verified character-for-character like any other, and a
quote the model paraphrased from a page falls to the floor the same way.
Every result is marked external, and the Evidence Agent's scoring caps a
claim resting on web pages alone below one resting on the programme's own
documents.
"""

from __future__ import annotations

import html
import os
import re
import time
from urllib.parse import urlparse

from . import contact, scope

ENABLED = os.environ.get("AGENT_WEB_SEARCH", "on").lower() not in ("off", "0", "false", "no")
MODEL = os.environ.get("AGENT_WEB_MODEL", "claude-sonnet-5")
MAX_SEARCHES = int(os.environ.get("AGENT_WEB_MAX_SEARCHES", "2"))
# SAP's own sites (help, community, support notes, learning -- all subdomains
# of sap.com) and the EU's, for the statutory side. Extend per country with
# the tax authority's domain: AGENT_WEB_DOMAINS=sap.com,europa.eu,gov.pl
DOMAINS = tuple(d.strip().lower() for d in os.environ.get(
    "AGENT_WEB_DOMAINS", "sap.com,europa.eu").split(",") if d.strip())
TIMEOUT = float(os.environ.get("AGENT_WEB_TIMEOUT", "90"))
MAX_QUERY_CHARS = 200
MAX_RESULTS = 8
CATEGORY = "WEB"

_INTERNAL = re.compile(r"\bSPARK[-_ ]?\d{3,}\b|\b[A-Za-z]-\d{2,3}(?:-\d{2,3})+\b", re.I)

DEFINITION = {
    "name": "web_search",
    "description": (
        "Search a small allow-list of external sites (SAP documentation, EU regulation) for a "
        "fact the programme's own documents do not hold: what SAP delivers as standard, or "
        "what a statutory requirement says. Only allowed AFTER you have searched the corpus in "
        "this run and it did not answer the point. At most "
        f"{MAX_SEARCHES} calls per run. Never put ticket numbers, BPML codes, names or customer "
        "data in the query -- it leaves the organisation. Results are external passages with "
        "chunk_ids starting WEB:; cite them like any chunk, quote them verbatim, and say in "
        "your text that the point comes from an external source."),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string",
                      "description": "A short, generic search query about SAP standard or regulation."},
            "reason": {"type": "string",
                       "description": "What the corpus search in this run did not answer."},
        },
        "required": ["query", "reason"],
    },
}


def enabled(session) -> bool:
    return ENABLED and bool(DOMAINS) and not getattr(session, "holdout", False)


def definitions(session) -> list[dict]:
    """The web tool, for an agent's tool list -- or nothing, when it is off.

    Left out entirely rather than offered and refused: a tool the model can
    see and never use is budget it will spend finding that out."""
    return [DEFINITION] if enabled(session) else []


def allowed_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in DOMAINS)


def gate(session, query: str) -> str:
    """Why this search may not run, or '' when it may."""
    if not ENABLED or not DOMAINS:
        return "Web search is switched off for these agents."
    if getattr(session, "holdout", False):
        return "Web search is not available in a holdout run."
    if getattr(session, "corpus_searches", 0) < 1:
        return ("Search the corpus first. Web search is only for a point the programme's own "
                "documents, searched in this run, do not answer.")
    if getattr(session, "web_searches", 0) >= MAX_SEARCHES:
        return (f"The web search budget for this run ({MAX_SEARCHES}) is used up. Work from what "
                "you have and record what is still missing as an open question.")
    q = (query or "").strip()
    if len(q) < 3:
        return "The query is empty."
    if len(q) > MAX_QUERY_CHARS:
        return f"Keep the query under {MAX_QUERY_CHARS} characters: a search, not a paragraph."
    if m := _INTERNAL.search(q):
        return (f"The query contains an internal identifier ({m.group(0)}). Those are "
                "meaningless outside the programme and must not leave it; describe the "
                "SAP function or the regulation instead.")
    if contact.found(q):
        return "The query contains contact details. Remove them."
    verdict = scope.check(q)
    if not verdict.allowed:
        return ("That query is not about SAP or the programme's processes, so it is not "
                f"searched ({verdict.reason or verdict.category}).")
    return ""


def _search(query: str) -> tuple[list[dict], dict]:
    """Run one allow-listed search. Returns (passages, usage)."""
    import anthropic

    client = anthropic.Anthropic(timeout=TIMEOUT, max_retries=1)
    resp = client.messages.create(
        model=MODEL, max_tokens=3000,
        tools=[{"type": "web_search_20250305", "name": "web_search",
                "max_uses": 1, "allowed_domains": list(DOMAINS)}],
        messages=[{"role": "user", "content": (
            f"Search the web for: {query}\n\n"
            "Report only what the sources say, quoting them. Do not add knowledge of your own.")}],
    )
    usage = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens,
             "web_search_requests": getattr(getattr(resp.usage, "server_tool_use", None),
                                            "web_search_requests", 0) or 0}
    return pages(resp.content), usage


def pages(content) -> list[dict]:
    """The cited passages in a response, grouped by page.

    Citations only. The model's own prose around them is its summary, not the
    source, and the verifier must be able to find every quote in what a page
    actually said. A page off the allow-list is dropped even though the API
    was told to stay on it: that is its promise, and this is the check."""
    by_url: dict[str, dict] = {}
    for block in content:
        for cite in (getattr(block, "citations", None) or []):
            url = getattr(cite, "url", "") or ""
            text = html.unescape(getattr(cite, "cited_text", "") or "").strip()
            if not url or not text or not allowed_url(url):
                continue
            hit = by_url.setdefault(url, {"url": url, "title": html.unescape(
                getattr(cite, "title", "") or url), "passages": []})
            if text not in hit["passages"]:
                hit["passages"].append(text)
    return list(by_url.values())[:MAX_RESULTS]


def search(session, query: str, reason: str = "") -> dict:
    """The `web_search` tool. Gated, allow-listed, and recorded for the verifier."""
    why_not = gate(session, query)
    if why_not:
        return {"error": why_not, "gated": True}
    session.web_searches = getattr(session, "web_searches", 0) + 1
    started = time.time()
    try:
        pages, usage = _search(query.strip())
    except Exception as exc:
        return {"error": f"web search failed: {type(exc).__name__}: {exc}"}
    results = []
    for page in pages:
        n = len([k for k in session.retrieved if k.startswith(CATEGORY + ":")]) + 1
        cid = f"{CATEGORY}:{n}"
        text = contact.redact("\n\n".join(page["passages"]))
        host = urlparse(page["url"]).hostname or ""
        rec = {
            "chunk_id": cid,
            "doc": f"{page['title']} ({host})",
            "heading_path": page["url"],
            "text": text,
            "url": page["url"],
            "external": True,
        }
        session.retrieved[cid] = {**rec, "full_text": text, "true_doc": rec["doc"],
                                  "true_heading_path": page["url"], "source": page["url"],
                                  "category": CATEGORY}
        results.append(rec)
    log = getattr(session, "web_log", None)
    if log is not None:
        log.append({"query": query, "reason": reason, "urls": [r["url"] for r in results],
                    "seconds": round(time.time() - started, 1), **usage})
    return {
        "query": query,
        "results": results,
        "external": True,
        "allowed_domains": list(DOMAINS),
        "searches_left": max(0, MAX_SEARCHES - session.web_searches),
        "note": ("External web passages, not programme documents. Cite them by chunk_id and "
                 "quote verbatim; say in your text that the point is from an external source; "
                 "never let one override what the programme's own documents say."
                 if results else "Nothing on the allowed sites answered this query."),
    }
