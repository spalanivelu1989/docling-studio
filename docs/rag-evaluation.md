# Scoring the answers

Ask RAG has always recorded what was asked, what was retrieved and what was
written. Nothing in it had an opinion about whether the answer was any good, so
a hallucinated claim and a well-supported one produced identical rows, looked
identical in the history and looked identical in Langfuse.

This is the opinion. Every answer is judged by Ragas, the verdict is stored
beside the question, pushed into Langfuse as scores, and drawn on the Ask page
as a scorecard.

```
question ──► retrieval ──► Claude writes ──► answer streams to the browser
                                                      │
                                    ┌─────────────────┘  (the reader is done here)
                                    ▼
                          a daemon thread, ~35s
                          9 judges in parallel
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
             ask_evaluations   Langfuse scores   the scorecard
             (Postgres)        (11 per answer)   (polled by the page)
```

---

## What is measured, and what cannot be

Nine judges run on a live answer, and all nine are **reference-free**: they
compare the answer against the excerpts it was written from, which is all a
live question has. Two more, `toxicity` and `bias`, exist and are off by
default.

| Score | What it asks | Weight |
|---|---|---|
| `faithfulness` | Is every claim supported by the excerpts? | 0.30 |
| `answer_relevancy` | Is this an answer to the question asked? | 0.20 |
| `context_precision` | Were the excerpts that mattered ranked first? | 0.15 |
| `context_relevance` | Do the excerpts bear on the question at all? | 0.10 |
| `context_utilization` | How much of what was retrieved was used? | 0.10 |
| `coherence` | Does the answer hold together? | 0.10 |
| `conciseness` | Is everything it says doing work? | 0.05 |
| `harmfulness` | Content that is a problem even if true | gate |
| `maliciousness` | Content designed to deceive | gate |
| `toxicity`, `bias` | off unless `RAG_EVAL_OPTIONAL_METRICS` names them | gate |

Two further metrics are not reference-free, and this is the load-bearing
limitation of the whole feature:

| Score | Needs |
|---|---|
| `context_recall` | a reference answer |
| `correctness` | a reference answer |

**A live question has no reference answer.** Both are therefore computed only
on the evaluation set (below), and the scorecard shows them greyed out with
"Needs a reference answer" rather than as a zero. Scoring them against an
invented reference would produce numbers that look exactly like the others and
mean nothing, which is worse than showing nothing.

The original specification asked for Correctness per execution. This is the one
place the delivered feature is narrower than the request, and the reason is
that the wider version would not be true.

---

## The two derived numbers

The request asked for an "Overall Quality Score" and a "Safety Score" without
saying what either is. Both are computed as **stated arithmetic**, following the
rule `evidence/scoring.py` already sets out for the Evidence Agent's support
score — *arithmetic over the evidence, never the model's opinion*:

```
safety  = 1.0 unless a safety judge flagged the answer, then 0.0

overall = Σ(weight × value) / Σ(weight)  over the judges that RETURNED
          and if safety < 1.0, capped at 0.25
```

Two properties of that formula are deliberate and worth defending.

**A judge that failed is dropped from both sides, not counted as zero.** A
timed-out judge is not evidence of a bad answer, and scoring it zero would turn
a flaky judge into a quality regression on the dashboard. The weights are
renormalised over what came back, and the tooltip names what was left out.

**A safety flag caps rather than zeroes.** "This needs a human" is a different
claim from "this answer is worthless", but the cap is low enough that a flagged
answer still sorts to the top of the failures list.

The weights are a judgement, not a measurement. They live in one table in
`evaluation.py` so they can be argued with. Faithfulness carries the most
because hallucination is this corpus's characteristic failure.

### The safety rubric had to be rewritten once

The first draft of the harmfulness rubric asked whether *acting on* the answer
could cause harm. The judge duly flagged every hallucination, reasoning that
acting on a wrong interface design would hurt — which is not wrong, but made
the safety gate a second, noisier faithfulness score and capped the overall on
every inaccurate answer.

It now asks whether the content is harmful **in itself, whether or not it is
accurate**, and says explicitly that factual accuracy is measured elsewhere and
is not its concern. Measured before and after on the same invented answer:

```
                 before      after
faithfulness      0.00        0.00     (unchanged — the answer is still wrong)
harmfulness       1.00        0.00
overall           0.250       0.336    (no longer capped)
```

---

## Running it

Nothing to turn on. With `ANTHROPIC_API_KEY` set and Ragas installed, every
finished answer is judged.

```bash
python evaluation.py status      # what scoring is configured to do
python evaluation.py selftest    # score one good and one bad answer
```

`selftest` is the one to run after any change to a rubric or a weight. It
scores the same two answers over the same excerpts and prints the gap; the gap
is the thing being tested, not either number. A judge that scores a supported
answer and an invented one alike is broken however plausible its figures.

```
--- a supported answer --- done, 9.4s, claude-sonnet-5
    faithfulness             1.000
    ...
    OVERALL                  0.894
--- an invented answer --- done, 9.5s, claude-sonnet-5
    faithfulness             0.000
    ...
    OVERALL                  0.336
gap: +0.559
```

### Settings

| Variable | Default | Notes |
|---|---|---|
| `RAG_EVAL` | `on` | `off` stops all scoring; the page says so rather than showing an empty panel |
| `RAG_EVAL_MODEL` | `claude-sonnet-5` | Not `RAG_ANSWER_MODEL`. Grading on Opus costs more than writing did |
| `RAG_EVAL_SAMPLE` | `1.0` | Fraction of answers judged. A run that loses the draw is recorded `skipped`, not left blank |
| `RAG_EVAL_TIMEOUT` | `180` | For the whole set of judges, which measures at 30–40s against real excerpts |
| `RAG_EVAL_MAX_TOKENS` | `16000` | See below — 4096 was not enough |
| `RAG_EVAL_OPTIONAL_METRICS` | empty | `toxicity,bias` |
| `ASK_LOW_QUALITY` | `0.7` | Where the history panel's "low quality" filter draws its line |

---

## In the interface

**On the Ask page**, a Quality panel between the answer and the sources. It
opens as "Scoring…" the moment the answer finishes and fills in when the judges
return; the page polls rather than holding the SSE stream open, so closing the
tab mid-evaluation costs nothing — the result is written to Postgres either way
and is there when the question is reopened.

The overall figure carries its whole arithmetic in a tooltip: the weights used,
the judges dropped, the cap if one applied. A headline number that cannot be
taken apart is one nobody will trust twice.

**Click any metric** and it opens beside the page, carrying the judge's own
working rather than a longer version of the number:

| Metric | What the panel shows |
|---|---|
| `faithfulness` | every claim the answer makes, with a verdict and a reason for each — the hallucination report |
| `context_precision`, `context_utilization` | a verdict per excerpt, named by its source document |
| `answer_relevancy` | the questions the judge reverse-engineered from the answer, where the drift is legible |
| `context_relevance` | the two judges' ratings, which are of the whole set and not per excerpt |
| `coherence`, `conciseness`, the safety pair | the rubric, and the judge's reasoning verbatim |

Plus, for every one: how it is measured, and what it contributed to the overall
score. The metric is switched from inside the panel rather than by closing it.

Ragas does not return any of this — its `MetricResult` carries the number and
nothing else — so it is intercepted at the judge LLM and normalised into four
shapes server-side. **This costs no extra model calls and no extra time**: the
calls happen either way, and only the throwing-away is skipped. It adds about
5 KB to an evaluation row.

> Per-excerpt verdicts are numbered by the order their calls were *issued*, not
> the order they finished. Ragas judges the excerpts concurrently, so arrival
> order says nothing, but it builds one task per excerpt in rank order. This
> was checked with a marker planted in each excerpt rather than assumed — the
> first attempt matched the excerpt text inside the prompt and got it visibly
> wrong, because two excerpts from one spreadsheet share a long prefix: three
> verdicts came out labelled "Excerpt 1" and two went unidentified.

**In the history drawer**, a score badge per row and five segments (the four
below, plus *All*):

| Segment | Finds |
|---|---|
| Low quality | overall below `ASK_LOW_QUALITY` |
| Unfaithful | `faithfulness` below the same line — the hallucinations |
| Unsafe | a safety judge flagged it |
| Unscored | never judged, or judging did not finish |

---

## The Answer Quality workspace

A **RAG Metrics** tab beside Ask RAG, with four views, each for one reader and one
question. The design and the survey of other tools behind it are in the
proposal; this is what was built.

| View | For | Question |
|---|---|---|
| **Overview** | programme leads | Are our answers good, and is that changing? |
| **Failure explorer** | analysts, document owners | What goes wrong, on which subjects, from which documents? |
| **Experiments** | whoever changes the pipeline | Is this change better, and what did it break? |
| **Judge trust** | whoever owns the scoring | Can we believe these scores? |

Every aggregate opens the answers behind it, and every answer opens the same
metric drawer the Ask page uses — with a place underneath for a person's
verdict. All the arithmetic is in `quality.py`; nothing in it calls a judge.

**Overview.** The RAG triad plus overall quality, each against the same window
one window earlier. The timeline draws the median with a 10th–90th percentile
band, and marks every point where `prompt_hash` or `corpus_fingerprint`
changed — only across questions asked of the whole corpus, since a scoped
question has its own corpus fingerprint. *Needs attention* is generated by
rules: a subject averaging below the line, a document retrieved often and
rarely useful, a fall in quality in the week after a change.

**Failure explorer.** Each answer gets a failure type from stated rules,
first match wins:

| Failure | Rule |
|---|---|
| Safety flag | `safety < 1` |
| Wrong sources | `context_relevance < 0.5` |
| Evidence buried | relevance ≥ 0.7 and `context_precision < 0.5` |
| Evidence ignored | precision ≥ 0.7 and `context_utilization < 0.5` |
| Invented claims | `faithfulness < 0.7` and relevance ≥ 0.5 |
| Off the question | `answer_relevancy < 0.6` |

A rule whose score is missing is skipped rather than failed. Then: a quadrant
of retrieval against faithfulness, which separates the two causes of a bad
answer that look identical from outside; subjects, found by grouping the
questions by meaning with bge-m3 and an average-linkage tree; documents, with
how often each is retrieved and how often the judge found its excerpts
useful; and every unsupported claim, grouped the same way.

**Experiments.** Every run of `python evaluation.py experiment` is now kept in
Postgres (`eval_experiments`, `eval_experiment_items`) with each question's
working, as well as going to Langfuse — and runs without Langfuse at all. Two
runs are compared question by question: a move under 0.05 counts as
unchanged, regressions sort first, and *why it moved* is read off the two
runs' excerpts (documents that entered or left, useful excerpts before and
after), not asked of a model. The header shows which configuration keys
differ, and warns when it is more than one.

**Judge trust.** Agreement with people is Cohen's kappa over reviewed answers,
withheld until there are 20 — a kappa over six answers is noise. Stability is
the change between the last two scores of the same answer, from a new
`ask_evaluation_history` table; `python evaluation.py rescore --sample 10`
produces it, and is safe to schedule. The two context-relevance judges' ratings
were already kept apart, so their agreement is free. The review queue puts
disagreements first, then split relevance judges and unstable re-scores, then a
sample that stays the same all week. A review is saved to `ask_reviews` and
sent to the answer's Langfuse trace as a categorical `human_grounded` score.

Until 20 answers have been reviewed, every view says the judge has not been
checked against people.

### What the workspace found on its first real data

Eleven answers, eight of them to questions from the evaluation set. Two
findings came out of it that are worth acting on.

**The largest group of "invented claims" is not invention.** Eighteen of 76
unsupported claims were statements an answer made about its own sources —
*"Excerpts [3], [7] and [8] come from slide/flowchart material…"*, *"All of the
information provided rests on PKG package documents"*. `rag.ANSWER_SYSTEM`
tells the answering model to say which category an answer rests on and to
flag OCR'd text; the faithfulness judge then marks those sentences unsupported,
because no excerpt says it was OCR'd. So faithfulness — and through it the
overall score — is pulled down for answers that follow their own
instructions. Two ways to fix it, and the choice is a decision about what
faithfulness should mean: strip provenance notes before the faithfulness judge
sees the answer, or tell the judge that statements about the excerpts
themselves are not claims about the subject. Neither is made yet.

**Some documents are retrieved and rarely help.** *Solvay@eCommerce – SAP user
guide* was retrieved six times and judged useful in none; *Delivery Blocks
(xlsx)* seven times and useful in two — several slices of one spreadsheet
crowding each other out of the top eight.

## In Langfuse

Eleven scores per answer, attached to the answer's own trace.

```bash
python evaluation.py configs      # declare the names, types and 0..1 ranges
python evaluation.py dashboard    # upload docs/langfuse-rag-quality-dashboard.json
```

Scores, **not** trace metadata. The request asked for metadata; metadata is an
opaque blob that cannot be filtered by range, sorted or aggregated, so every
other thing the request asked for — `Faithfulness < 0.70`, trend lines,
distributions, comparison by model — would have been impossible. Scores are the
first-class object the traces table and the query engine are built around.

Segmenting is then native: filter the traces table on a score name and value.
The dashboard covers average by metric, quality and grounding over time, the
distribution, comparison by search mode, and counts of answers below the line.
It deliberately carries no "top failing traces" table — `traceId` is a
high-cardinality dimension the query engine will not group on, and the traces
table filtered by score is the better version of that list anyway.

`score_id` is derived from `(run id, metric)`, so asking for a second opinion
replaces the score rather than adding a second one and double-counting every
average. Verified against a live project.

> One thing to know before chasing a discrepancy: Langfuse's score **list**
> endpoint is served from an analytics store that lags the write, so shortly
> after a re-score it still shows the previous value while a GET of the score
> by id already shows the new one. The GET is the truth.

---

## Measuring properly: the evaluation set

Live scoring cannot answer "is hybrid better than vector here", because the
questions people ask in each mode are not the same questions. And it cannot
compute correctness at all.

`docs/three-engine-eval-questions.md` holds 27 questions whose ground truth was
read out of the corpus by hand. They become a Langfuse dataset:

```bash
python evaluation.py questions            # check the parse first
python evaluation.py dataset              # push all 27
python evaluation.py experiment --mode hybrid --k 8
python evaluation.py experiment --mode vector --k 8   # then compare in Langfuse
```

The questions are parsed out of the document rather than copied into a second
list, because a second hand-written copy of the same 27 things drifts from the
first one silently — and the ground truth is the half that has to stay right.

### Read the reference-based numbers carefully

A three-question smoke run:

```
answer_relevancy     0.864        context_recall    0.083
faithfulness         0.804        correctness       0.251
context_precision    0.722        overall_quality   0.827
```

The reference-free metrics look healthy and the reference-based ones look
terrible. **Do not read that as a retrieval verdict yet.** Two things are mixed
into it:

1. This set was *built to be hard*. Its own document says a question is only
   doing its job if the three engines answer it differently, and several are
   designed to provoke a specific failure.
2. Some of these questions' correct answer is a **refusal** — Q2's ground truth
   is "it does not", Q4's is "there is no SPARK-21999". Context recall asks how
   much of the reference the retrieval found; against a reference that says
   something does not exist, the metric is close to meaningless.

Before this becomes a regression gate rather than a diagnostic, the references
need rewriting as clean reference *answers* rather than as explanations aimed at
a human reader, and the refusal questions need excluding from the two
reference-based metrics. Until then, treat `context_recall` and `correctness`
here as a floor and watch them for *movement between runs* rather than for
their absolute value.

### What makes two runs comparable

Three things are recorded per question so that a comparison is valid rather
than merely available:

* `corpus_fingerprint` — what the corpus held
* `prompt_hash` — a fingerprint of `rag.ANSWER_SYSTEM`, added with this work
* `judge_model` and `ragas_version` — on the evaluation row

A step in a quality trend usually means one of these changed, not that the
system got worse overnight. Check them before reading a cliff as a regression.

---

## Three incompatibilities, and why the adapter is hand-built

Ragas' own `llm_factory(provider="anthropic")` does not work against this
project's packages. All three failures are worth naming because two are loud
and one is not.

**1. `import ragas` fails on langchain-community 0.4.x.** Ragas 0.4.3 imports
`langchain_community.chat_models.vertexai` at module scope and 0.4.0 removed it.
`requirements.txt` pins `langchain-community<0.4` for this reason and no other.
Nothing in this project uses LangChain directly.

**2. This Anthropic SDK has no `temperature` or `top_p`.** Sampling moved into
`output_config.effort`; Ragas sends both from its defaults and the call is
rejected. They are popped. There is nothing to put in their place — the API no
longer offers the knob, so the judge runs at the model's default sampling.

**3. `instructor.from_anthropic` defaults to a tool-calling mode that produces
malformed output.** Intermittently the judge writes tool-call XML *into* a
string field — `...</reason>\n<parameter name="verdict">0` — which fails
validation, exhausts the retries and loses the whole metric. This is the quiet
one: it looks like a flaky judge. `Mode.ANTHROPIC_JSON` is stable over repeated
runs and is what is used. Ragas made the same fix for OpenAI and not for
Anthropic.

**And one setting that is not an incompatibility but reads like one.**
Faithfulness decomposes an answer into statements and writes a verdict and a
justification for each against every excerpt, so its output grows with both.
Against real corpus excerpts it exceeded 4096 output tokens and returned
`IncompleteOutputException` instead of a score — silently losing the most
heavily weighted judge. `RAG_EVAL_MAX_TOKENS` defaults to 16000.

---

## Shape of the code

| File | Holds |
|---|---|
| `evaluation.py` | the judges, the arithmetic, the Langfuse push, the CLI |
| `ask_store.py` | `ask_evaluations`, and the quality filters |
| `app.py` | the judging thread and three endpoints |
| `frontend/src/components/QualityScorecard.tsx` | the panel |
| `frontend/src/components/MetricDetailDrawer.tsx` | one metric, opened up |
| `docs/langfuse-rag-quality-dashboard.json` | the dashboard, as code |
| `quality.py` | the four views' arithmetic: failure rules, grouping, kappa, comparison |
| `experiment_store.py` | runs over the evaluation set, kept with their working |
| `frontend/src/pages/QualityPage.tsx`, `components/quality/` | the workspace |

`ask_evaluations` is a table rather than columns on `ask_runs` because an
evaluation has a life of its own — it begins after the answer has finished, it
can fail without the answer failing, and it can be asked for again without the
question being asked again. It is tied to the question with `ON DELETE
CASCADE`, so retention and deletion govern both and there is only ever one
sweeper.

The judging thread reads the run back out of Postgres rather than closing over
what was streamed, so the automatic score and the re-score take the identical
path. It calls `rag.close()` in its `finally`: connections are thread-local and
nothing else can release them.

`evaluate()` and `aevaluate()` both exist because there are two callers with
opposite needs — the judging thread has no event loop and wants one made for
it, while the experiment runner is already inside one, where `asyncio.run()`
raises. The sync entry point refuses loudly if called from a running loop. It
did not, once, and an experiment produced three scored-looking runs carrying no
scores at all.

---

## Tests

```bash
python test_evaluation.py                 # 47, no model calls, no Langfuse writes
python test_quality.py                    # the workspace's arithmetic, no model calls
node frontend/test/quality-page.mjs       # the page and quality.py agree
node frontend/test/rag-quality.mjs        # the four files agree on the metric names
```

`test_evaluation.py` stubs `evaluate` and `push_scores` at import time and one
of its tests asserts the stubs are in place. This is not caution: the sibling
suite in `evidence/` once drove a real agent run without stubbing its memory
writes, and every invocation quietly added fabricated facts to the production
memory bank. The equivalent mistake here would spend money on judges and write
scores onto real traces, corrupting the dashboards this feature exists to make
trustworthy.
