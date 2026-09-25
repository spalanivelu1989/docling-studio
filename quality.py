"""The Answer Quality workspace: four views over the judged Ask RAG answers.

    Overview          are our answers good, and is that changing?
    Failure explorer  what goes wrong, on which subjects, from which documents?
    Experiments       is this change better, and what did it break?
    Judge trust       can we believe these scores?

Everything here is arithmetic over what `evaluation.py` already stored. No
function in this module calls a judge, and the only model it touches is the
corpus's own embedder, to group questions and claims by meaning.

Why this lives in the app rather than in the Langfuse dashboard
---------------------------------------------------------------
Langfuse holds the scores. It does not hold the judge's working -- the claim
verdicts, the per-excerpt verdicts -- because those are too structured to be
scores and too large to be comments. The two views that matter most read that
working directly: the document list is built from per-excerpt verdicts, and
the invented-claims list is built from per-claim ones. Time series and counts
are still in the Langfuse dashboard too; this module does not replace it.

Scale
-----
Ask history is capped at ASK_HISTORY_LIMIT (500) questions, so every view is
computed in Python over at most a few hundred rows loaded in one query. That is
simpler than pushing percentiles and clustering into SQL, and fast enough that
nothing here is cached except embeddings.
"""

from __future__ import annotations

import hashlib
import math
import re
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

import ask_store

# Where "below the line" is drawn, everywhere on the dashboard. The same line
# the history drawer's low-quality filter uses, so a number means one thing.
LINE = ask_store.LOW_QUALITY


# --- failure types ------------------------------------------------------------
#
# Stated rules, applied in order, first match wins. Written down the way
# evidence/scoring.py writes down its support score: an answer's failure type
# is arithmetic over its scores, so anyone can check why it landed where it
# did, and the "Needs attention" list names a cause rather than a metric.
#
# The thresholds are a starting point chosen to agree with the scorecard's
# colour bands. Expect to move them once there are real distributions.

FAILURES: list[dict[str, str]] = [
    {"key": "safety", "label": "Safety flag",
     "rule": "safety < 1",
     "means": "A safety judge flagged the content itself",
     "fix": "A person reads it; nothing to tune"},
    {"key": "wrong_sources", "label": "Wrong sources",
     "rule": "context relevance < 0.5",
     "means": "The corpus does not hold it, or search missed it",
     "fix": "The corpus, the embedding, the keyword terms"},
    {"key": "buried", "label": "Evidence buried",
     "rule": "relevance ≥ 0.7 and precision < 0.5",
     "means": "Found, but ranked below noise",
     "fix": "Fusion, k, re-ranking"},
    {"key": "ignored", "label": "Evidence ignored",
     "rule": "precision ≥ 0.7 and utilization < 0.5",
     "means": "Good excerpts the answer did not use",
     "fix": "The answering prompt"},
    {"key": "invented", "label": "Invented claims",
     "rule": "faithfulness < 0.7 and relevance ≥ 0.5",
     "means": "The sources were adequate; the answer went beyond them",
     "fix": "The answering prompt, the model"},
    {"key": "off_question", "label": "Off the question",
     "rule": "answer relevancy < 0.6",
     "means": "An answer, but to a different question",
     "fix": "Question handling, the prompt"},
]
FAILURE_KEYS = [f["key"] for f in FAILURES]


def failure(values: dict[str, float | None], safety: float | None) -> str | None:
    """The first failure rule this answer meets, or None.

    A rule whose inputs are missing -- a judge that did not return -- is
    skipped rather than treated as failed, for the same reason `overall`
    renormalises instead of counting a missing judge as zero."""
    v = values.get
    rel, prec, util = v("context_relevance"), v("context_precision"), v("context_utilization")
    faith, ans = v("faithfulness"), v("answer_relevancy")
    if safety is not None and safety < 1:
        return "safety"
    if rel is not None and rel < 0.5:
        return "wrong_sources"
    if rel is not None and prec is not None and rel >= 0.7 and prec < 0.5:
        return "buried"
    if prec is not None and util is not None and prec >= 0.7 and util < 0.5:
        return "ignored"
    if faith is not None and faith < 0.7 and (rel is None or rel >= 0.5):
        return "invented"
    if ans is not None and ans < 0.6:
        return "off_question"
    return None


def retrieval(values: dict[str, float | None]) -> float | None:
    """One number for "did retrieval do its job": the mean of relevance and
    precision, over whichever of the two returned. It is the horizontal axis of
    the explorer's quadrant, so its job is to separate retrieval failures from
    generation failures, not to be a metric in its own right."""
    got = [x for x in (values.get("context_relevance"), values.get("context_precision"))
           if x is not None]
    return round(sum(got) / len(got), 4) if got else None


def half(sources: list[dict]) -> str:
    """Which half of the corpus an answer was written from: the categories of
    the excerpts it actually read, not the scope the question asked for -- the
    Ask page searches everything, so the scope is almost always "all"."""
    cats = sorted({(s.get("category") or "").upper() for s in sources if s.get("category")})
    if not cats:
        return "—"
    if cats == ["DR", "PKG"]:
        return "PKG+DR"
    return "+".join(cats)


# --- loading ------------------------------------------------------------------


def _values(metrics: dict) -> dict[str, float | None]:
    return {name: (m or {}).get("value") for name, m in (metrics or {}).items()}


def load(conn) -> list[dict[str, Any]]:
    """Every question with a finished evaluation, newest first.

    The excerpt text is left in the database -- the views need each excerpt's
    title and category, and the text would be most of the payload."""
    ask_store.create_schema(conn)
    rows = conn.execute(
        """SELECT r.id, r.question, r.mode, r.categories, r.started_at,
                  r.prompt_hash, r.corpus_fingerprint, r.answer_model, r.trace_id,
                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                             'n', s -> 'n', 'title', s -> 'title',
                             'category', s -> 'category')), '[]'::jsonb)
                   FROM jsonb_array_elements(r.sources) s),
                  e.metrics, e.overall, e.safety, e.judge_model, e.finished_at,
                  v.verdict, r.input_tokens, r.output_tokens
           FROM ask_runs r
           JOIN ask_evaluations e ON e.run_id = r.id
           LEFT JOIN ask_reviews v ON v.run_id = r.id
           WHERE r.status = 'done' AND e.status = 'done'
           ORDER BY r.started_at DESC"""
    ).fetchall()
    out = []
    for r in rows:
        metrics = r[10] or {}
        values = _values(metrics)
        sources = r[9] or []
        out.append({
            "run_id": r[0], "question": r[1], "mode": r[2],
            "categories": r[3] or [], "at": r[4],
            "prompt_hash": r[5] or "", "corpus_fingerprint": r[6] or "",
            "answer_model": r[7] or "", "trace_id": r[8] or "",
            "sources": sources, "metrics": metrics, "values": values,
            "overall": r[11], "safety": r[12], "judge_model": r[13] or "",
            "judged_at": r[14], "review": r[15],
            "tokens": (r[16] or 0) + (r[17] or 0),
            "half": half(sources),
            "retrieval": retrieval(values),
            "failure": failure(values, r[12]),
        })
    return out


def select(rows: list[dict], *, days: int = 28, half_: str = "", mode: str = "",
           now: datetime | None = None, offset: int = 0) -> list[dict]:
    """The rows inside the window, after filters. `offset` shifts the window
    back by whole windows, which is how the previous period is found."""
    now = now or datetime.now(timezone.utc)
    end = now - timedelta(days=days * offset)
    start = end - timedelta(days=days)
    return [r for r in rows
            if r["at"] and start < r["at"] <= end
            and (not half_ or r["half"] == half_)
            and (not mode or r["mode"] == mode)]


def _mean(xs: Iterable[float | None]) -> float | None:
    got = [x for x in xs if x is not None]
    return round(sum(got) / len(got), 4) if got else None


def _pct(xs: list[float], q: float) -> float | None:
    """Linear-interpolated percentile, the same method numpy defaults to."""
    if not xs:
        return None
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return round(s[lo] + (s[hi] - s[lo]) * (pos - lo), 4)


# --- grouping by meaning ------------------------------------------------------
#
# Questions are grouped into subjects and invented claims into kinds by
# embedding them with bge-m3 -- the model the corpus is already indexed with,
# so there is no second model -- and cutting an average-linkage tree at a
# cosine distance. Hierarchical rather than k-means because the number of
# subjects is the thing being discovered, and it must not have to be guessed.

QUESTION_DISTANCE = 0.42
CLAIM_DISTANCE = 0.40

_vector_cache: dict[str, Any] = {}
# Replaceable, so the tests can group text without an Ollama server.
EMBED: Callable[[list[str]], list] | None = None


def _vectors(texts: list[str]):
    import numpy as np

    embed = EMBED
    if embed is None:
        import rag

        embed = lambda batch: rag.embed(batch, "search_query")  # noqa: E731
    keys = [hashlib.sha256(t.encode()).hexdigest() for t in texts]
    missing = [t for t, k in zip(texts, keys) if k not in _vector_cache]
    if missing:
        for t, vec in zip(missing, embed(missing)):
            _vector_cache[hashlib.sha256(t.encode()).hexdigest()] = np.asarray(vec, dtype=float)
    return np.vstack([_vector_cache[k] for k in keys])


def cluster(texts: list[str], distance: float) -> list[int]:
    """A group number per text, 0 for the largest group. Deterministic."""
    if not texts:
        return []
    if len(texts) == 1:
        return [0]
    from scipy.cluster.hierarchy import fcluster, linkage

    matrix = _vectors(texts)
    raw = fcluster(linkage(matrix, method="average", metric="cosine"),
                   t=distance, criterion="distance")
    # Renumber by size, then by first appearance, so group 0 is the biggest
    # and the numbering does not wobble between two identical calls.
    sizes = Counter(raw)
    first = {}
    for i, g in enumerate(raw):
        first.setdefault(g, i)
    order = sorted(sizes, key=lambda g: (-sizes[g], first[g]))
    renumber = {g: n for n, g in enumerate(order)}
    return [renumber[g] for g in raw]


def _medoid(indices: list[int], texts: list[str]) -> int:
    """The member closest to all the others -- the most typical one, used as
    the example a reader sees for the group."""
    if len(indices) <= 2:
        return indices[0]
    import numpy as np

    m = _vectors([texts[i] for i in indices])
    m = m / (np.linalg.norm(m, axis=1, keepdims=True) + 1e-12)
    return indices[int(np.argmax((m @ m.T).sum(axis=1)))]


_STOP = set("""
a about above after again against all also am an and any are as at be because
been before being below between both but by can could did do does doing down
during each few for from further had has have having here how i if in into is
it its itself just me more most my no nor not now of off on once only or other
our out over own same should so some such than that the their them then there
these they this those through to too under until up very was we were what when
where which while who whom why will with would you your yes also does done get
given used using use per via one two three whether said says say still
answer answers context excerpt excerpts document documents question questions
explain describe tell list show give happens happen
""".split())
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9\-_/.]*[A-Za-z0-9]|[A-Za-z]{2,}")


def _terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(text) if len(w) > 2 and w.lower() not in _STOP]


def label(groups: dict[int, list[int]], texts: list[str], top: int = 3) -> dict[int, str]:
    """A few words that tell each group apart from the others.

    Term frequency inside the group weighed against how many groups use the
    term at all, so "SPARK", which is in every question, names nothing. The
    spelling that appears most is kept -- "SOVOS" rather than "sovos"."""
    spelling: dict[str, Counter] = defaultdict(Counter)
    per_group: dict[int, Counter] = {}
    for g, idx in groups.items():
        c = Counter()
        for i in idx:
            for w in _terms(texts[i]):
                c[w.lower()] += 1
                spelling[w.lower()][w] += 1
        per_group[g] = c
    spread = Counter()
    for c in per_group.values():
        spread.update(set(c))
    n = len(per_group)
    out = {}
    for g, c in per_group.items():
        # log(n / spread) is zero for a term every group uses, so "SPARK" can
        # never name a group when there is more than one. With a single group
        # there is nothing to tell apart, and plain frequency decides.
        weight = {w: c[w] * (math.log(n / spread[w]) if n > 1 else 1.0) for w in c}
        ranked = sorted(c, key=lambda w: (-weight[w], -c[w], w))
        picked: list[str] = []
        for w in ranked:
            if n > 1 and weight[w] <= 0 and picked:
                break
            if any(w in p or p in w for p in picked):
                continue
            picked.append(w)
            if len(picked) == top:
                break
        out[g] = " · ".join(spelling[w].most_common(1)[0][0] for w in picked) or "misc"
    return out


def subjects(rows: list[dict]) -> tuple[list[dict], dict[str, int], str]:
    """Group the questions by meaning. Returns (subjects, run_id -> subject,
    error). With the embedder unreachable the explorer still works; it just has
    no subject view, and says why."""
    if not rows:
        return [], {}, ""
    texts = [r["question"] for r in rows]
    try:
        ids = cluster(texts, QUESTION_DISTANCE)
    except Exception as exc:
        return [], {}, f"Questions could not be grouped: {type(exc).__name__}: {exc}"
    groups: dict[int, list[int]] = defaultdict(list)
    for i, g in enumerate(ids):
        groups[g].append(i)
    names = label(groups, texts)
    out = []
    for g, idx in sorted(groups.items()):
        members = [rows[i] for i in idx]
        fails = Counter(r["failure"] for r in members if r["failure"])
        out.append({
            "id": g, "label": names[g], "n": len(members),
            "overall": _mean(r["overall"] for r in members),
            "faithfulness": _mean(r["values"].get("faithfulness") for r in members),
            "failure": fails.most_common(1)[0][0] if fails else None,
            "failing": sum(1 for r in members if r["failure"]),
            "example": texts[_medoid(idx, texts)],
            "run_ids": [r["run_id"] for r in members],
        })
    return out, {rows[i]["run_id"]: g for i, g in enumerate(ids)}, ""


# --- documents, from the per-excerpt verdicts ---------------------------------

NOISY_MIN_RETRIEVED = 5
NOISY_BELOW = 0.40


def documents(rows: list[dict], limit: int = 15) -> list[dict]:
    """How often each document is retrieved, and how often it helps.

    "Helps" is the context-precision judge's per-excerpt verdict: was this
    excerpt useful in arriving at the answer. A document retrieved often and
    judged useful rarely is crowding out something better, and is the first
    place to look when retrieval quality falls. Galileo calls this chunk
    attribution; here it falls out of verdicts already stored."""
    seen: dict[str, dict] = {}
    for r in rows:
        by_n = {s.get("n"): s for s in r["sources"]}
        for s in r["sources"]:
            d = seen.setdefault(s.get("title") or "?", {
                "title": s.get("title") or "?", "category": s.get("category") or "",
                "retrieved": 0, "judged": 0, "useful": 0, "run_ids": set()})
            d["retrieved"] += 1
            d["run_ids"].add(r["run_id"])
        work = (r["metrics"].get("context_precision") or {}).get("working") or {}
        if work.get("kind") != "excerpts":
            continue
        for item in work.get("items") or []:
            src = by_n.get(item.get("n"))
            if not src:
                continue  # unnumbered: the attribution is unknown, so not counted
            d = seen[src.get("title") or "?"]
            d["judged"] += 1
            d["useful"] += 1 if item.get("useful") else 0
    out = []
    for d in seen.values():
        rate = round(d["useful"] / d["judged"], 4) if d["judged"] else None
        out.append({**d, "run_ids": sorted(d["run_ids"]), "useful_rate": rate,
                    "noisy": bool(rate is not None and d["retrieved"] >= NOISY_MIN_RETRIEVED
                                  and rate < NOISY_BELOW)})
    out.sort(key=lambda d: (-d["retrieved"], d["title"]))
    return out[:limit]


# --- invented claims, grouped -------------------------------------------------


def claim_groups(rows: list[dict], limit: int = 8) -> tuple[list[dict], int, str]:
    """Every claim the faithfulness judge found unsupported, grouped by meaning.

    Reading fifty unsupported claims one by one tells you there is a problem.
    Reading them as five groups of ten tells you what the problem is. This is
    the rationale clustering Google's LLM Comparator does, applied to claims."""
    claims = []
    for r in rows:
        work = (r["metrics"].get("faithfulness") or {}).get("working") or {}
        if work.get("kind") != "claims":
            continue
        for c in work.get("items") or []:
            if not c.get("supported") and c.get("text"):
                claims.append({"text": c["text"], "reason": c.get("reason", ""),
                               "run_id": r["run_id"], "question": r["question"]})
    if not claims:
        return [], 0, ""
    claims = claims[:400]
    texts = [c["text"] for c in claims]
    try:
        ids = cluster(texts, CLAIM_DISTANCE)
    except Exception as exc:
        return [], len(claims), f"Claims could not be grouped: {type(exc).__name__}: {exc}"
    groups: dict[int, list[int]] = defaultdict(list)
    for i, g in enumerate(ids):
        groups[g].append(i)
    names = label(groups, texts)
    out = []
    for g, idx in sorted(groups.items())[:limit]:
        example = claims[_medoid(idx, texts)]
        out.append({"id": g, "label": names[g], "count": len(idx),
                    "example": example["text"], "reason": example["reason"],
                    "run_ids": sorted({claims[i]["run_id"] for i in idx})})
    return out, len(claims), ""


# --- the timeline -------------------------------------------------------------


def _bucket(at: datetime, daily: bool) -> datetime:
    day = at.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return day if daily else day - timedelta(days=day.weekday())


def series(rows: list[dict], days: int, now: datetime) -> list[dict]:
    """Median and the 10th-90th percentile band per week (per day for short
    windows). The band is the point: two weeks with the same median can be one
    consistent week and one of great answers mixed with terrible ones."""
    daily = days <= 14
    buckets: dict[datetime, list[dict]] = defaultdict(list)
    for r in rows:
        if r["overall"] is not None:
            buckets[_bucket(r["at"], daily)].append(r)
    out = []
    for at in sorted(buckets):
        xs = [r["overall"] for r in buckets[at]]
        out.append({"at": at.isoformat(), "n": len(xs),
                    "median": _pct(xs, 0.5), "p10": _pct(xs, 0.1), "p90": _pct(xs, 0.9),
                    "faithfulness": _mean(r["values"].get("faithfulness") for r in buckets[at])})
    return out


def events(conn, start: datetime, end: datetime) -> list[dict]:
    """Where the answering prompt or the corpus changed, for the timeline.

    Every question records both fingerprints, so a change is found by walking
    the questions in order. Only questions asked across the whole corpus are
    compared: the corpus fingerprint covers the categories in scope, and a
    question scoped to PKG has a different fingerprint without anything having
    changed."""
    rows = conn.execute(
        """SELECT started_at, prompt_hash, corpus_fingerprint FROM ask_runs
           WHERE status = 'done' AND categories = '[]'::jsonb
           ORDER BY started_at"""
    ).fetchall()
    out: list[dict] = []
    prev = {"prompt": "", "corpus": ""}
    for at, prompt, corpus in rows:
        for kind, value in (("prompt", prompt or ""), ("corpus", corpus or "")):
            if value and prev[kind] and value != prev[kind] and start < at <= end:
                out.append({"at": at.isoformat(), "kind": kind, "value": value[:6]})
            if value:
                prev[kind] = value
    return out


# --- the four views -----------------------------------------------------------

TRIAD = [
    ("overall", "Answer quality", "overall_quality"),
    ("context_relevance", "Found the right sources", "context_relevance"),
    ("faithfulness", "Stuck to the sources", "faithfulness"),
    ("answer_relevancy", "Answered the question", "answer_relevancy"),
]


def _metric(r: dict, key: str) -> float | None:
    return r["overall"] if key == "overall" else r["values"].get(key)


def overview(conn, *, days: int = 28, half_: str = "", mode: str = "",
             now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    rows = load(conn)
    cur = select(rows, days=days, half_=half_, mode=mode, now=now)
    prev = select(rows, days=days, half_=half_, mode=mode, now=now, offset=1)

    tiles = []
    for key, name, metric in TRIAD:
        a, b = _mean(_metric(r, key) for r in cur), _mean(_metric(r, key) for r in prev)
        tiles.append({
            "key": key, "label": name, "metric": metric,
            "value": a, "previous": b,
            "delta": round(a - b, 4) if a is not None and b is not None else None,
            # Not `(x or 1) < LINE`: that reads a score of exactly 0.0 as a pass.
            "below": sum(1 for r in cur
                         if (x := _metric(r, key)) is not None and x < LINE),
            "n": sum(1 for r in cur if _metric(r, key) is not None),
        })

    bins = [0] * 10
    for r in cur:
        if r["overall"] is not None:
            bins[min(9, int(r["overall"] * 10))] += 1

    halves = []
    for h in sorted({r["half"] for r in cur}):
        members = [r for r in cur if r["half"] == h]
        halves.append({"half": h, "n": len(members),
                       "overall": _mean(r["overall"] for r in members),
                       "faithfulness": _mean(r["values"].get("faithfulness") for r in members)})

    start = now - timedelta(days=days)
    marks = events(conn, start, now)
    subj, _map, subj_error = subjects(cur)
    docs = documents(cur)
    return {
        "days": days, "line": LINE,
        "scored": len(cur), "previous_scored": len(prev),
        "failing": sum(1 for r in cur if r["failure"]),
        "tiles": tiles,
        "series": series(cur, days, now),
        "events": marks,
        "histogram": bins,
        "halves": halves,
        "attention": attention(cur, subj, docs, marks),
        "attention_error": subj_error,
        "reviewed": sum(1 for r in rows if r["review"]),
        "checked": sum(1 for r in rows if r["review"]) >= MIN_REVIEWS,
    }


def attention(rows: list[dict], subj: list[dict], docs: list[dict],
              marks: list[dict]) -> list[dict]:
    """The few things worth a person's time, named as causes.

    Three sources, each a stated rule rather than a model's opinion: subjects
    whose answers fall below the line, documents retrieved often and rarely
    useful, and a fall in quality right after the prompt or the corpus changed.
    Ranked by how many answers each one touches."""
    names = {f["key"]: f["label"] for f in FAILURES}
    items = []
    for s in subj:
        if s["n"] >= 2 and s["overall"] is not None and s["overall"] < LINE:
            items.append({
                "severity": "bad" if s["overall"] < 0.55 else "warn",
                "kind": "subject", "target": s["id"], "subject": s["label"],
                "text": "Answers about {subject} fall below the line",
                "detail": f"{s['n']} answers · answer quality {s['overall']:.2f}"
                          + (f" · mostly {names[s['failure']].lower()}" if s["failure"] else ""),
                "weight": s["n"],
            })
    for d in docs:
        if d["noisy"]:
            items.append({
                "severity": "warn", "kind": "document", "target": d["title"],
                "subject": d["title"],
                "text": "{subject} is retrieved often and rarely useful",
                "detail": f"retrieved {d['retrieved']}× · useful {round((d['useful_rate'] or 0) * 100)}%",
                "weight": d["retrieved"] / 3,
            })
    for m in marks:
        at = datetime.fromisoformat(m["at"])
        before = [r["overall"] for r in rows if r["overall"] is not None
                  and at - timedelta(days=7) <= r["at"] < at]
        after = [r["overall"] for r in rows if r["overall"] is not None
                 and at <= r["at"] < at + timedelta(days=7)]
        if len(before) >= 2 and len(after) >= 2:
            drop = statistics.mean(before) - statistics.mean(after)
            if drop > 0.05:
                what = "answering prompt" if m["kind"] == "prompt" else "corpus"
                items.append({
                    "severity": "warn", "kind": "event", "target": m["at"],
                    "subject": f"the {what} changed",
                    "text": "Quality fell after {subject}",
                    "detail": f"{statistics.mean(before):.2f} → {statistics.mean(after):.2f}"
                              f" in the week either side · {m['kind']} {m['value']}",
                    "weight": len(after),
                })
    items.sort(key=lambda i: (i["severity"] != "bad", -i["weight"]))
    return items[:5]


def explorer(conn, *, days: int = 28, half_: str = "", mode: str = "",
             now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cur = select(load(conn), days=days, half_=half_, mode=mode, now=now)
    subj, subject_of, subj_error = subjects(cur)
    groups, claim_count, claim_error = claim_groups(cur)
    counts = Counter(r["failure"] for r in cur if r["failure"])
    return {
        "days": days, "line": LINE,
        "failures": [{**f, "count": counts.get(f["key"], 0)} for f in FAILURES],
        "points": [{
            "run_id": r["run_id"], "question": r["question"],
            "at": r["at"].isoformat() if r["at"] else None,
            "overall": r["overall"], "safety": r["safety"],
            "retrieval": r["retrieval"],
            "faithfulness": r["values"].get("faithfulness"),
            "failure": r["failure"], "half": r["half"], "mode": r["mode"],
            "subject": subject_of.get(r["run_id"]),
            "review": r["review"],
            # Every score the judge returned, for the answers table's columns.
            "values": r["values"],
            "tokens": r.get("tokens", 0),
        } for r in cur],
        "subjects": subj, "subjects_error": subj_error,
        "documents": documents(cur),
        "claims": groups, "claim_count": claim_count, "claims_error": claim_error,
    }


# --- judge trust --------------------------------------------------------------

# Below this many reviews, agreement is not reported as a number: a kappa over
# six answers is noise dressed as a finding.
MIN_REVIEWS = 20
UNSTABLE = 0.15
BUCKETS = ("grounded", "partly", "not")


def bucket(faithfulness: float | None) -> str | None:
    """The judge's faithfulness, cut into a reviewer's three verdicts."""
    if faithfulness is None:
        return None
    return "grounded" if faithfulness >= 0.8 else "partly" if faithfulness >= 0.5 else "not"


def kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Cohen's kappa: agreement between judge and reviewer beyond chance.

    Raw agreement flatters a judge on a corpus where most answers are fine --
    saying "grounded" every time would agree 90% of the time and mean nothing.
    Kappa subtracts what that kind of guessing would have scored."""
    n = len(pairs)
    if not n:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    left, right = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    expected = sum(left[c] * right[c] for c in BUCKETS) / (n * n)
    if expected >= 1:
        return None
    return round((observed - expected) / (1 - expected), 4)


def judge(conn, *, queue_size: int = 12, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    rows = load(conn)
    by_id = {r["run_id"]: r for r in rows}

    # Judges that did not return, per metric.
    tried: Counter = Counter()
    lost: Counter = Counter()
    for r in rows:
        for name, m in r["metrics"].items():
            tried[name] += 1
            if (m or {}).get("error") or (m or {}).get("value") is None:
                lost[name] += 1
    dropped = sorted(
        ({"metric": n, "tried": tried[n], "lost": lost[n],
          "rate": round(lost[n] / tried[n], 4)} for n in tried),
        key=lambda d: (-d["rate"], d["metric"]))

    # The two context-relevance judges. Their ratings are kept separately, so
    # how often they agree is free.
    pairs, split = 0, []
    for r in rows:
        work = (r["metrics"].get("context_relevance") or {}).get("working") or {}
        ratings = [i.get("rating") for i in work.get("items") or []]
        if work.get("kind") == "ratings" and len(ratings) == 2 and None not in ratings:
            pairs += 1
            if ratings[0] != ratings[1]:
                split.append((r["run_id"], ratings))
    relevance = {"pairs": pairs, "agree": pairs - len(split),
                 "rate": round((pairs - len(split)) / pairs, 4) if pairs else None}

    # The same answer scored more than once.
    hist = conn.execute(
        """SELECT run_id, overall, (scores ->> 'faithfulness')::real
           FROM ask_evaluation_history ORDER BY run_id, finished_at"""
    ).fetchall()
    runs: dict[str, list] = defaultdict(list)
    for run_id, ov, faith in hist:
        runs[run_id].append((ov, faith))
    spreads, unstable = [], []
    for run_id, seq in runs.items():
        if len(seq) < 2 or run_id not in by_id:
            continue
        (o1, f1), (o2, f2) = seq[-2], seq[-1]
        if f1 is not None and f2 is not None:
            spread = abs(f2 - f1)
            spreads.append(spread)
            if spread >= UNSTABLE:
                unstable.append((run_id, f1, f2))
    stability = {"rescored": len(spreads),
                 "median": _pct(spreads, 0.5) if spreads else None,
                 "unstable": len(unstable)}

    # People.
    reviewed = [(bucket(r["values"].get("faithfulness")), r["review"], r) for r in rows
                if r["review"] and bucket(r["values"].get("faithfulness"))]
    matrix = [[sum(1 for j, h, _ in reviewed if j == jb and h == hb) for hb in BUCKETS]
              for jb in BUCKETS]
    agreement = {
        "reviews": len(reviewed),
        "kappa": kappa([(j, h) for j, h, _ in reviewed]) if len(reviewed) >= MIN_REVIEWS else None,
        "raw": round(sum(1 for j, h, _ in reviewed if j == h) / len(reviewed), 4) if reviewed else None,
        "matrix": matrix, "buckets": list(BUCKETS),
        "min_reviews": MIN_REVIEWS,
    }

    # The queue: disagreements first, because they are what the agreement
    # figure is made of; then split relevance judges and unstable re-scores;
    # then a sample, so the figure is not built only from awkward cases.
    queue: list[dict] = []
    for j, h, r in reviewed:
        if j != h:
            queue.append({"run_id": r["run_id"], "question": r["question"], "kind": "disagree",
                          "severity": "bad" if {j, h} == {"grounded", "not"} else "warn",
                          "detail": f"Judge said {j} ({r['values'].get('faithfulness'):.2f}), reviewer said {h}"})
    for run_id, ratings in split:
        if run_id in by_id and not by_id[run_id]["review"]:
            queue.append({"run_id": run_id, "question": by_id[run_id]["question"],
                          "kind": "relevance_split", "severity": "warn",
                          "detail": f"The two relevance judges rated it {ratings[0]} and {ratings[1]}"})
    for run_id, f1, f2 in unstable:
        if not by_id[run_id]["review"]:
            queue.append({"run_id": run_id, "question": by_id[run_id]["question"],
                          "kind": "unstable", "severity": "warn",
                          "detail": f"Faithfulness {f1:.2f}, then {f2:.2f} on a re-score"})
    seen = {q["run_id"] for q in queue}
    week = now.strftime("%G-%V")
    pool = sorted((r for r in rows if not r["review"] and r["run_id"] not in seen),
                  key=lambda r: hashlib.sha256(f"{week}:{r['run_id']}".encode()).hexdigest())
    for r in pool[: max(0, queue_size - len(queue))]:
        queue.append({"run_id": r["run_id"], "question": r["question"], "kind": "sample",
                      "severity": "info",
                      "detail": "Random sample — keeps the agreement figure honest"})

    return {
        "judge_models": sorted({r["judge_model"] for r in rows if r["judge_model"]}),
        "scored": len(rows),
        "dropped": dropped,
        "dropped_rate": round(sum(lost.values()) / sum(tried.values()), 4) if tried else None,
        "relevance": relevance,
        "stability": stability,
        "agreement": agreement,
        "checked": len(reviewed) >= MIN_REVIEWS,
        "queue": queue[:queue_size],
        "unstable_above": UNSTABLE,
    }


# --- experiments --------------------------------------------------------------

# A change in overall quality smaller than this is called unchanged. The judge
# is not perfectly repeatable; a 0.02 move on one question is mostly noise, and
# counting it as an improvement would make every comparison look decisive.
NOISE = 0.05
COMPARED = ("overall", "correctness", "context_recall", "faithfulness",
            "context_precision", "context_relevance", "context_utilization",
            "answer_relevancy")
CONFIG_KEYS = ("mode", "k", "answer_model", "judge_model", "prompt_hash",
               "corpus_fingerprint", "ragas_version")


def part(item_id: str) -> str:
    """Q1-Q16 are grounded in PKG, D1-D6 in DR, C1-C5 need both -- the three
    parts of docs/three-engine-eval-questions.md."""
    return {"Q": "PKG", "D": "DR", "C": "PKG+DR"}.get(item_id[:1].upper(), "")


def _item_value(item: dict, key: str) -> float | None:
    if key == "overall":
        return item.get("overall")
    return ((item.get("metrics") or {}).get(key) or {}).get("value")


def _useful(item: dict) -> int | None:
    work = ((item.get("metrics") or {}).get("context_precision") or {}).get("working") or {}
    if work.get("kind") != "excerpts":
        return None
    return sum(1 for i in work.get("items") or [] if i.get("useful"))


def why_moved(base: dict, cand: dict) -> list[str]:
    """Why a question's score moved, read off the two runs' excerpts.

    Not a model's explanation: which documents entered the retrieved set,
    which left it, and how many excerpts the judge found useful before and
    after. Most regressions from a retrieval change are one of those three."""
    b = {s.get("title") for s in base.get("sources") or [] if s.get("title")}
    c = {s.get("title") for s in cand.get("sources") or [] if s.get("title")}
    out = []
    if c - b:
        out.append("now reads " + ", ".join(sorted(c - b)[:2])
                   + (f" and {len(c - b) - 2} more" if len(c - b) > 2 else ""))
    if b - c:
        out.append("no longer reads " + ", ".join(sorted(b - c)[:2])
                   + (f" and {len(b - c) - 2} more" if len(b - c) > 2 else ""))
    ub, uc = _useful(base), _useful(cand)
    if ub is not None and uc is not None and ub != uc:
        out.append(f"useful excerpts {ub} → {uc}")
    nb, nc = len(base.get("sources") or []), len(cand.get("sources") or [])
    if nb != nc:
        out.append(f"{nb} → {nc} excerpts")
    return out


def compare(base: dict, cand: dict) -> dict:
    """Two runs over the evaluation set, question by question."""
    bi = {i["item_id"]: i for i in base["items"]}
    ci = {i["item_id"]: i for i in cand["items"]}
    rows = []
    for item_id in sorted(set(bi) | set(ci), key=lambda s: (s[:1], int(s[1:]) if s[1:].isdigit() else 0, s)):
        b, c = bi.get(item_id), ci.get(item_id)
        if not b or not c:
            rows.append({"item_id": item_id, "question": (b or c)["question"],
                         "part": part(item_id), "verdict": "missing",
                         "missing_from": "baseline" if not b else "candidate",
                         "deltas": {}, "base": {}, "cand": {}, "why": []})
            continue
        deltas, bv, cv = {}, {}, {}
        for key in COMPARED:
            x, y = _item_value(b, key), _item_value(c, key)
            bv[key], cv[key] = x, y
            deltas[key] = round(y - x, 4) if x is not None and y is not None else None
        d = deltas["overall"]
        verdict = ("unchanged" if d is None or abs(d) < NOISE
                   else "improved" if d > 0 else "regressed")
        rows.append({"item_id": item_id, "question": c["question"], "part": part(item_id),
                     "verdict": verdict, "deltas": deltas, "base": bv, "cand": cv,
                     # For every row, not just the moved ones: a question can
                     # hold its overall score while correctness falls, and the
                     # reason is just as readable off the excerpts.
                     "why": why_moved(b, c)})

    both = [r for r in rows if r["verdict"] != "missing"]
    summary = {key: _mean(r["deltas"].get(key) for r in both) for key in COMPARED}

    def tokens(items):
        got = [(i.get("input_tokens") or 0) + (i.get("output_tokens") or 0) for i in items]
        got = [g for g in got if g]
        return statistics.mean(got) if got else None

    tb, tc = tokens(base["items"]), tokens(cand["items"])
    order = {"regressed": 0, "improved": 1, "missing": 2, "unchanged": 3}
    rows.sort(key=lambda r: (order[r["verdict"]],
                             (r["deltas"].get("overall") or 0) * (1 if r["verdict"] == "regressed" else -1)))
    bc, cc = base["config"], cand["config"]
    return {
        "base": {k: base[k] for k in ("id", "name", "started_at", "config", "baseline")},
        "cand": {k: cand[k] for k in ("id", "name", "started_at", "config", "baseline")},
        "differs": [k for k in CONFIG_KEYS if str(bc.get(k, "")) != str(cc.get(k, ""))],
        "counts": Counter(r["verdict"] for r in rows),
        "summary": summary,
        "tokens": {"base": tb, "cand": tc,
                   "change": round((tc - tb) / tb, 4) if tb and tc else None},
        "rows": rows,
        "noise": NOISE,
    }
