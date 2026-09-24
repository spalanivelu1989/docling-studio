"""The Fit-Gap Copilot's two passes.

Stage 2 of the specification (understand the As-Is) is a separate agent run
from stages 4-7 (compare, classify, score). That is not an implementation
convenience -- §21 puts "understand the As-Is before comparing it" first
because a model given the comparison tools while it is still reading starts
diffing paragraphs, which is the two-document comparison §7 forbids.

So: pass one reads only the attachments and submits a normalised process
model. Pass two is handed that model as text and gets the corpus, the graph
and the BPML sheet to compare it against.

Nothing numeric comes out of the model except 0-4 dimension ratings and a
0-100 harmonization potential per deviation. Every score is arithmetic over
those, done in scoring.py.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Callable

import pydantic

import tracing

from . import tools
from .schemas import SUBJECTS, Analysis, AsIsModel, RunRequest, Subject

MODEL = os.environ.get("ROLLOUT_MODEL") or os.environ.get("RAG_ANSWER_MODEL", "claude-opus-5")
MAX_TOOL_CALLS = {"asis": int(os.environ.get("ROLLOUT_MAX_TOOL_CALLS_ASIS", "14")),
                  "compare": int(os.environ.get("ROLLOUT_MAX_TOOL_CALLS", "22"))}
# Two different limits, because they guard two different things.
#
# MAX_INPUT_TOKENS is a limit on CONTEXT: how much the model is reading in one
# turn. Cached or not, it is all in the window, so the cached prefix counts.
#
# MAX_TOTAL_INPUT_TOKENS is a limit on COST, and there the cached prefix must
# not count: with prompt caching on, a fourteen-turn loop re-reads its prefix
# fourteen times and a cumulative budget over full context grows quadratically
# while the bill grows linearly. Counting cache reads here once cut this pass
# off at turn fourteen -- it submitted an empty deviation register while its
# own headline named three material divergences.
MAX_INPUT_TOKENS = int(os.environ.get("ROLLOUT_MAX_INPUT_TOKENS", "90000"))
MAX_TOTAL_INPUT_TOKENS = int(os.environ.get("ROLLOUT_MAX_BILLED_TOKENS", "220000"))
# The register is the output. A budget that leaves no room to write it out is
# not a budget, it is a way of producing a confident-looking empty analysis.
MAX_TOKENS_OUT = 24000

# §26, verbatim in substance. These are the rules that make the output usable
# by a rollout team, so the hash of this text is stored on every run.
GUARDRAILS = """\
Guardrails, in force at all times:

- Do not invent SAP functionality, scope items, Fiori apps or localization content. \
If you have not read it in a source this run, you do not know it.
- Do not invent statutory obligations. Country-specific is NOT the same as legally required. \
A requirement is a confirmed statutory localization only when an explicit source says so; \
otherwise it is a suspected localization, a corporate policy or a local preference.
- Do not assume the As-Is is a requirement merely because it is what the country does today.
- Do not assume the Global Template is correct when SAP Best Practice or a valid country \
requirement suggests otherwise. A country closer to SAP standard than the template is a \
template finding, not a country failure.
- Do not propose an extension or custom development before you have considered standard \
configuration, SAP-delivered localization and an existing template variant, and recorded \
which you considered.
- Show uncertainty. Expose conflicting sources rather than choosing silently between them.
- Do not score on how thorough a document is. Absence of documentation is not proof that a \
control does not exist -- it is an evidence gap, and it belongs in open_questions.
- Distinguish business impact from implementation effort, and configuration from extension.
- A difference is not a gap, a gap is not a requirement, and a requirement is not a \
development. Never jump from "the country differs" to "custom development".
"""

EVIDENCE_RULES = """\
Evidence rules:

- Every quote must be copied verbatim, character for character, from the text of a chunk a \
tool returned to you in THIS run. Quotes are checked automatically against the chunk text; \
an invented or paraphrased quote is discarded and can force a finding to REQUIRES_DECISION.
- Every piece of evidence carries the side it came from: as_is, template, sap_bp or \
localization. A deviation claims a difference between two sides, so evidence for a material \
deviation should quote both of them.
- Mark each quote's evidence class: E1 explicit (the source states it), E2 derived (it follows \
from two or more explicit facts), E3 hypothesis (plausible, not established), E4 unknown \
(the information is needed and not available). Never present E3 as E1.
"""

# --- the two passes, as templates -------------------------------------------
# The shared blocks are appended after formatting rather than interpolated
# into the template, so a brace appearing in the guardrails one day cannot
# turn into a format placeholder.


def system_subject(subject: Subject) -> str:
    """Pass one: read the subject and normalise it.

    Parameterised rather than written twice. The mechanics of reading a
    process out of a document do not change with whose process it is -- only
    the name of the thing being read and the role it is filed under -- and two
    copies of sixty lines of prompt would drift apart within a month."""
    body = SYSTEM_ASIS_TEMPLATE.format(reading=subject.reading, side=subject.side)
    return (
        f"{body}\n{EVIDENCE_RULES}\n{GUARDRAILS}\n"
        f'Answer in British English. The documents attached under the role "{subject.label}" '
        f"are the subject of this run.\n"
    )


def system_compare(subject: Subject) -> str:
    """Pass two: compare the subject against the Global Template."""
    if subject.localization:
        frame = (
            "    Country As-Is  \u2194  Global Template  \u2194  SAP Best Practice\n\n"
            "with country localization as a contextual lens."
        )
        sources = (
            "1. list_sources, to see which sides you actually have a source for. If no SAP Best "
            "Practice source is attached, you cannot rate the SAP Best Practice score -- leave "
            "every sap_bp_fit_rating null and say why in sap_bp_note."
        )
        localization = (
            "decide the localization state honestly, "
        )
    else:
        # No country in the run, so no localization and no third side. Said
        # explicitly because the vocabularies still offer both, and a model
        # given a CONFIRMED_STATUTORY option will eventually reach for it.
        frame = (
            "    SAP Best Practice  \u2194  Global Template\n\n"
            "There is no country in this run. Localization does not apply: set every "
            "deviation's localization_state to NOT_LOCALIZATION and leave the localization "
            "list empty. Neither does the SAP Best Practice score -- the Best Practice content "
            "is the subject here, not a third side to rate against -- so leave every "
            "sap_bp_fit_rating null."
        )
        sources = (
            "1. list_sources, to confirm which Best Practice documents are attached. They are "
            "the subject of this run; the Global Template is what you compare them against."
        )
        localization = ""
    body = SYSTEM_COMPARE_TEMPLATE.format(
        reading=subject.reading, subject_label=subject.label, noun=subject.noun,
        finding=subject.finding, frame=frame, sources=sources, localization=localization,
    )
    return (f"{body}\n{EVIDENCE_RULES}\n{GUARDRAILS}\n"
            "Answer in British English. Keep every statement short enough for a business "
            "analyst to read.\n")


SYSTEM_ASIS_TEMPLATE = """\
You are the SAP Rollout FitGap Agent, on your first pass.

Your only job on this pass is to understand {reading} precisely, from the \
documents attached to this session. You are NOT comparing anything yet, and you have no \
access to the Global Template on this pass.

Work like this:

1. list_sources, to see what is attached and in which role.
2. read_sources with side="{side}", several times, with different queries. Read the whole \
process, not the first chunk that matches. Use get_chunk when an excerpt is cut off.
3. Break the process into atomic steps in the order they actually happen. For each step \
capture, where the document states it: trigger, actor/role, action, system, input, business \
rule (thresholds, tolerances, calculations), decision/branching, control (approval, \
segregation, audit), output, exception path, integration, timing/SLA and volume.
4. Normalise terminology as you go, and record what you normalised. "Credit hold", "credit \
block" and "delivery block due to credit" may be one control. "Regional CFO approval" and \
"Finance Director approval" are NOT the same role without evidence that they are.
5. submit_asis, once.

Leave an attribute empty when the document does not state it. An empty field is an honest \
answer; an invented one corrupts every comparison built on it. Put what you needed and could \
not find in evidence_gaps.
"""

SYSTEM_COMPARE_TEMPLATE = """\
You are the SAP Rollout FitGap Agent, on your second pass.

You have already read {reading} and it is given to you below as a normalised process \
model. Your job now is the comparison:

{frame}

Compare business MEANING, not document wording. Do not flag harmless differences in phrasing.

A deviation here is {finding}.

Work like this:

{sources}
2. Establish the template side. If the run named a Global Template process, get_scope on its \
BPML code for its name, description and place in the hierarchy. If it named none, identify the \
template's equivalent of this process yourself: search_corpus for what it actually does, \
graph_entity on the systems, dash codes and tickets it mentions, and get_scope on any BPML code \
that comes back. Either way, record what you settled on in `template_process` -- an analysis \
that does not say what it compared against cannot be audited. If you cannot identify one, say \
so there and keep every rating and finding to what you can actually evidence.
3. compare_entities, to see which systems, codes and tickets in the subject the corpus already \
knows. Each shared entity tells you what to search the corpus for.
4. search_corpus for the template's version of each part of the process. Run at least one \
query containing the exact BPML code verbatim. graph_entity and graph_neighbors resolve a \
system, ticket or dash code to what is linked to it.
5. For every step of the subject, ask: does an equivalent template step exist; at the same \
point in the process; with an equivalent actor, business rule, threshold, system capability, \
control, data and exception path? A step that matches is a fit_area -- name it, so the \
workshop can confirm it in one batch instead of walking through it.
6. For every material difference, write one deviation. Classify it with the taxonomy, say \
exactly what the difference is in one sentence, {localization}assess materiality, and rate the \
template fit 0-4. Put it on ONE of the seven scored dimensions -- the one it mostly loads onto.
7. Decide the workshop bucket:
   - MUST_DISCUSS: the difference is material, or legal relevance is uncertain, or a business \
rule changes the outcome, or an approval or control differs, or development may be needed, or \
the template and SAP standard conflict, or you are not confident enough for an important \
decision. Every one of these needs an explicit DECISION QUESTION, two to four options, an \
owner and a realistic length in minutes.
   - CONFIRM: minor or configurable, or the design is equivalent and only a local value \
differs. A business owner should confirm it, but it does not need floor time.
   - NO_WORKSHOP_TIME: a clear semantic match with no decision left.
8. Rate all seven dimensions 0-4 for the template comparison, with a one-line note for each \
saying what drove the rating.
9. Produce backlog candidates ONLY for findings you can evidence, and only where a validated \
need is visible. Every candidate names the gap it came from. A hypothesis is not scope.
10. submit_analysis, once.

You do not compute the scores. You supply the ratings and the harmonization potential per \
deviation; the arithmetic is done for you and published with its formula.

The most important output is not the gap list -- it is the workshop focus list. A Must Discuss \
item without a decision question makes a workshop rediscover instead of decide.
"""


def prompt_hash(subject: Subject | None = None) -> str:
    """Identifies the prompts a run was produced by. Per subject, because two
    subjects are two different sets of instructions and a run compared against
    a hash that does not describe it is not reproducible."""
    s = subject or SUBJECTS["country_as_is"]
    return hashlib.sha256(
        (system_subject(s) + system_compare(s)).encode()).hexdigest()[:12]


def _client():
    import anthropic

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    return anthropic.Anthropic(api_key=key)


def _context(req: RunRequest, scope) -> str:
    """The run's framing, shared by both passes."""
    subject = SUBJECTS[req.subject]
    parts = [
        f"Subject of this run: {subject.label}",
        # Only said when there is one. A Best Practice run has no country, and
        # "Country: not stated" invites the model to go looking for one.
        (f"Country: {req.country or 'not stated'}" if subject.localization else ""),
        f"Global Template process: {scope.code} — {scope.name}" if scope else "",
        f"Template hierarchy: " + " › ".join(f"{a.code} {a.name}" for a in tools.ancestry(scope.code))
        if scope else "",
        f"Template description:\n{scope.description}" if scope and scope.description else "",
        f"Global Template version: {req.gt_version}" if req.gt_version else "",
        f"SAP target solution / release: {req.sap_release}" if req.sap_release else "",
        (f"Country context:\n{req.country_context}"
         if req.country_context and subject.localization else ""),
        # Said out loud rather than left as an absence: without it the model
        # tends to pick the first process the corpus mentions and never
        # records that the choice was its own.
        ("No Global Template process was named for this run. Work out which template process "
         f"corresponds to this {subject.label} from the corpus, and put what you settled on in "
         "`template_process` so the analysis says what it was compared against.")
        if not scope else "",
    ]
    if req.question:
        parts.append(f'The analyst who started this run asked: "{req.question}"\n'
                     "Keep it in view when you choose what to read and what to put in "
                     "open_questions, but still produce the full analysis.")
    return "\n\n".join(p for p in parts if p)


def _run(system: str, user: str, stage: str, sess: tools.Session,
         submit: str, model_cls, on_tool: Callable | None) -> tuple[Any, dict]:
    """One bounded pass. Returns the submitted model (or None) and its cost."""
    client = _client()
    tool_defs = tools.definitions(stage)
    messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
    budget = MAX_TOOL_CALLS[stage]

    calls = 0
    in_tokens = out_tokens = last_in = 0
    submitted = None
    started = time.time()

    while submitted is None:
        over = (calls >= budget or last_in >= MAX_INPUT_TOKENS
                or in_tokens >= MAX_TOTAL_INPUT_TOKENS)
        if over:
            messages.append({"role": "user", "content": (
                f"Your tool budget is exhausted. Call {submit} now with what you have actually "
                "read. Do not guess to fill a field: leave it empty, lower the confidence, and "
                "put what you were still missing in the open questions or evidence gaps. "
                "Write out every difference you have already found -- an empty register with a "
                "rated alignment score says the process matched, which is not what you saw.")})

        # Streamed, not because anything consumes the stream, but because the
        # SDK refuses a non-streamed request whose max_tokens could take it
        # past ten minutes -- and the register needs the output room. The
        # final message is assembled and used exactly as a create() result.
        with client.messages.stream(
            model=MODEL, max_tokens=MAX_TOKENS_OUT, system=system,
            tools=tool_defs, messages=messages,
            # The system prompt and the tool schemas are identical on every
            # turn; the submit schemas alone are several thousand tokens.
            cache_control={"type": "ephemeral"},
        ) as stream:
            response = stream.get_final_message()
        last_in = _input_tokens(response.usage)      # context this turn
        in_tokens += _billed_tokens(response.usage)  # cost, cached prefix excluded
        out_tokens += response.usage.output_tokens
        messages.append({"role": "assistant", "content": response.content})

        uses = [b for b in response.content if b.type == "tool_use"]
        if not uses:
            messages.append({"role": "user",
                             "content": f"You did not call a tool. Call {submit} now."})
            if over:
                break
            calls += 1
            continue

        results = []
        for use in uses:
            if use.name == submit:
                try:
                    submitted = model_cls(**dict(use.input))
                    results.append({"type": "tool_result", "tool_use_id": use.id,
                                    "content": "Accepted."})
                except pydantic.ValidationError as exc:
                    results.append({"type": "tool_result", "tool_use_id": use.id, "is_error": True,
                                    "content": "Rejected:\n" + _errors(exc) +
                                               f"\nCorrect it and call {submit} again."})
                    calls += 1
                continue

            calls += 1
            t0 = time.time()
            fn = tools.DISPATCH.get(use.name)
            args = dict(use.input)
            from fitgap.tools import OBSERVATION_TYPE, ToolCall
            from fitgap import trace

            # The observation records what the tool returned, not the truncated
            # copy handed to the model on the next turn; what the model read is
            # already visible in that turn's generation.
            with tracing.observation(use.name, as_type=OBSERVATION_TYPE.get(use.name, "tool"),
                                     input=args) as observed:
                if fn is None:
                    result: dict = {"error": f"unknown tool {use.name}"}
                else:
                    try:
                        result = fn(sess, **args)
                    except TypeError as exc:
                        result = {"error": f"bad arguments: {exc}"}
                    except Exception as exc:
                        result = {"error": f"{type(exc).__name__}: {exc}"}

                call = ToolCall(
                    name=use.name, arguments=args,
                    summary=tools.summarise(use.name, args, result),
                    ms=int((time.time() - t0) * 1000), error=result.get("error"),
                    sources=tools.describe_sources(use.name, args, result, sess),
                    # The summary says a search ran; the trace says which
                    # passages came back and at what rank. Without it a reader
                    # can see the shape of the run and not check any of it.
                    trace=trace.of(use.name, args, result, sess),
                )
                observed.update(output=result,
                                metadata={"summary": call.summary, "sources": call.sources,
                                          "stage": stage})
                if call.error:
                    observed.update(level="ERROR", status_message=call.error)
            sess.record(call)
            if on_tool:
                on_tool(call, stage)
            results.append({"type": "tool_result", "tool_use_id": use.id,
                            "content": json.dumps(result, default=str)[:30000]})

        messages.append({"role": "user", "content": results})
        if submitted is None and over and not any(r.get("is_error") for r in results):
            break

    return submitted, {"tool_calls": calls, "input_tokens": in_tokens,
                       "output_tokens": out_tokens, "seconds": round(time.time() - started, 2)}


def read_asis(req: RunRequest, scope, sess: tools.Session,
              on_tool: Callable | None = None) -> tuple[AsIsModel | None, dict]:
    """Pass one. Named for the country case it was written for; it reads
    whatever the run's subject is."""
    subject = SUBJECTS[req.subject]
    user = (
        _context(req, scope)
        + f"\n\nRead the attached {subject.label} documentation and submit the normalised "
          "process. Do not compare it to anything yet. Read the whole of what is attached: "
          "the template process above, if one is named, says what the analysis is about -- it "
          "does not limit which parts of the document you may read."
    )
    return _run(system_subject(subject), user, "asis", sess, "submit_asis", AsIsModel, on_tool)


def compare(req: RunRequest, scope, asis: AsIsModel, sess: tools.Session,
            on_tool: Callable | None = None) -> tuple[Analysis | None, dict]:
    steps = "\n".join(_step_line(s) for s in asis.steps) or "(no steps were extracted)"
    notes = ""
    if asis.normalisation_notes:
        notes += "\n\nTerminology normalised while reading:\n" + "\n".join(
            f"  - {n}" for n in asis.normalisation_notes[:20])
    if asis.evidence_gaps:
        notes += "\n\nEvidence gaps recorded on the first pass:\n" + "\n".join(
            f"  - {g}" for g in asis.evidence_gaps[:20])
    subject = SUBJECTS[req.subject]
    user = (
        _context(req, scope)
        + f"\n\nThe {subject.label} process you read, as {len(asis.steps)} atomic steps:\n\n"
        + steps + notes
        + "\n\nNow run the comparison and submit the analysis. You can still call "
          f"read_sources to re-read any {subject.label} detail you need to quote."
    )
    return _run(system_compare(subject), user, "compare", sess, "submit_analysis",
                Analysis, on_tool)


def _step_line(s) -> str:
    bits = [f"[{s.step_id}] {s.name}"]
    for label, value in (("actor", s.actor), ("system", s.system), ("rule", s.business_rule),
                         ("control", s.control), ("decision", s.decision), ("output", s.output),
                         ("exception", s.exception), ("integration", s.integration),
                         ("timing", s.timing)):
        if value:
            bits.append(f"{label}: {value}")
    return "  " + " | ".join(bits) + f" (confidence {s.confidence})"


def _input_tokens(usage) -> int:
    """Everything the model read this turn, cached or not -- its context size."""
    return ((usage.input_tokens or 0)
            + (getattr(usage, "cache_read_input_tokens", 0) or 0)
            + (getattr(usage, "cache_creation_input_tokens", 0) or 0))


def _billed_tokens(usage) -> int:
    """Input tokens charged at full rate. A cache read is a tenth of the price
    and re-reading the prefix is the point of caching, so it is not spending."""
    return ((usage.input_tokens or 0)
            + (getattr(usage, "cache_creation_input_tokens", 0) or 0))


def _errors(exc: pydantic.ValidationError) -> str:
    lines = []
    for e in exc.errors()[:10]:
        loc = ".".join(str(p) for p in e["loc"]) or "payload"
        lines.append(f"- {loc}: {e['msg']}")
    if len(exc.errors()) > 10:
        lines.append(f"- … and {len(exc.errors()) - 10} more")
    return "\n".join(lines)
