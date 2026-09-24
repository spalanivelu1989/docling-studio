# Agent memory

The Evidence Agent starts every investigation from nothing. Ask it the same
question twice and it pays twice: the same searches, the same traversals, the
same fourteen tool calls, to reach the same answer over a corpus that did not
change in between.

Memory fixes that half of the problem. It does **not** fix the other half, and
the distinction is the whole design, so read the next section before the
commands.

---

## Memory orients. It never grounds.

A claim in this system is carried by a quote, and every quote is checked
against `session.retrieved` — the record of what the retrieval tools actually
returned **in this run**. A quote that is not in there is discarded and its
claim falls to the floor.

Nothing recalled from memory is in `session.retrieved`. So a remembered fact
**cannot be cited, no matter what the model does with it.** That is not a rule
the prompt asks for; it is what the verifier already does, and memory was built
to sit on the safe side of it.

What memory is allowed to do is tell the agent where to look first. What it
finds there still has to be proved from the corpus, and if the corpus
disagrees, the corpus wins and the answer says so.

Two rules follow, and both are enforced in code rather than in the prompt:

| Rule | Where | Why |
| --- | --- | --- |
| Only **verified** claims are written down | `evidence/agent.py`, `worth_remembering()` | `finalise()` strips every quote it could not find in the chunk it named. A claim left with no sources is one whose evidence did not hold up — and nothing re-checks a memory, so writing it down would mean believing it for ever. |
| **Holdout** beats the toggle, both ways | `fitgap/memory.py`, `allowed()` | Holdout measures the agent against a corpus with the fit registers hidden. Memory holds answers reached over the corpus *with* them, so a holdout run that reads memory measures the memory. It does not write either: an answer reached without half the corpus is not a finding about it. |

The page says the same thing to the reader. Recalled notes appear in their own
panel, above the investigation and outside it, labelled `not evidence`.

---

## What it is

[Hindsight](https://github.com/vectorize-io/hindsight) (MIT, by Vectorize) is an
agent memory service. It stores facts, consolidates them into observations, and
searches with four strategies at once — semantic, BM25, an entity graph and a
temporal arm. Three operations: `retain`, `recall`, `reflect`. This integration
uses the first two.

It is a **separate HTTP server**. This repo ships only the client.

---

## Why the server is not in this venv

```
uv pip install hindsight-client   →    9 packages, no conflicts
uv pip install hindsight-api      →  115 packages, and:
                                       transformers 5.17.0 → 5.15.1
                                       tokenizers   0.23.2 → 0.22.2
```

Those two are Docling's. Installing the server here would downgrade the
document converter's dependencies to satisfy the memory service, which is a bad
trade in any direction. Give it its own environment.

---

## Setting it up

Somewhere permanent and outside this repo — the venv is about 1.8 GB, and a
temporary directory is not the place for it:

```bash
cd ~
uv venv --python 3.13 hindsight-venv
uv pip install --python hindsight-venv/bin/python hindsight-api
```

The venv is disposable; the memories are not. They live in embedded Postgres
under `~/.pg0/instances/hindsight/`, which is nothing to do with where you put
the venv, so rebuilding the environment does not lose the bank.

Then start it with `./hindsight.sh` from the repository root. That script holds
the configuration and reads `ANTHROPIC_API_KEY` from `.env`.

## Which model, and why it matters more than it looks

One model does everything: it reads each investigation note, extracts facts,
consolidates them into observations, and answers `reflect()`. There is no
separate summarisation model. It decides two things:

* **Cost.** Every retain is an LLM call, and consolidation re-reads facts as
  the bank grows. A full investigation note is around 3 KB.
* **Where the findings go.** That note holds what an investigation concluded
  about Solvay programme documents. `anthropic` or `openai` sends it off this
  machine; `ollama` does not.

**Always set the model.** The provider defaults are `claude-haiku-4-5` for
anthropic and `gemma3:12b` for ollama, and a model that is not there fails
every write *silently* — retain is asynchronous, so the API accepts it, the
agent moves on, and nothing is ever learned. That is exactly what happened
here: a server started with only `HINDSIGHT_API_LLM_PROVIDER=ollama` defaulted
to a `gemma3:12b` that was never pulled, and one investigation's conclusions
were lost before anyone noticed.

### Claude has to go through LiteLLM

`hindsight.sh` reaches Claude with `HINDSIGHT_API_LLM_PROVIDER=litellm` and
`HINDSIGHT_API_LLM_MODEL=anthropic/claude-opus-5`. The two more obvious routes
are both dead ends, and both fail in ways worth recognising:

| Route | What happens |
| --- | --- |
| `HINDSIGHT_API_LLM_PROVIDER=anthropic` | `TypeError: Invalid timeout argument; httpx.Timeout is from the httpx package, but this SDK uses httpx2`. Hindsight builds an `httpx.Timeout`; every `anthropic` 1.x release is on httpx2, so there is no version to pin back to. |
| `openai` provider against `https://api.anthropic.com/v1/` | Chat works. Fact extraction asks for `response_format {"type": "json_object"}` and the endpoint answers **400 — "Input should be 'json_schema'"**. |

LiteLLM speaks Anthropic's native API and translates the request Hindsight
actually sends. Verified end to end: a probe extracted in 10 seconds.

### Staying local instead

```bash
HINDSIGHT_MODEL=qwen3.5 ./hindsight.sh   # won't work — that is a litellm name
```

For Ollama, edit the three `HINDSIGHT_API_LLM_*` lines in `hindsight.sh`:

```bash
export HINDSIGHT_API_LLM_PROVIDER=ollama
export HINDSIGHT_API_LLM_BASE_URL=http://localhost:11434/v1
export HINDSIGHT_API_LLM_MODEL=qwen3.5      # must be pulled: ollama pull qwen3.5
```

Slower — minutes rather than seconds for a full note — and the facts it
extracts are blunter. Nothing leaves the machine.

Check it:

```bash
curl -s http://127.0.0.1:8888/version
```

```json
{"api_version":"0.10.1","features":{"observations":true,"worker":true,...}}
```

That is all the setup there is. Restart the app and the memory toggle on the
Evidence page becomes available.

## Using it

Turn on **memory** beside **holdout** on the Evidence page and ask a question.

* Before the first search, the agent is handed what earlier runs concluded.
  The page shows exactly what it was handed, in its own panel.
* After the answer is verified, what this run established is written back —
  the question, the state, each surviving claim with its score and the
  documents that carried it, and the open questions.

Writing back is asynchronous on the server. Fact extraction is a language-model
job: on Ollama a full investigation note takes minutes to appear in the bank.
The investigation does not wait for it.

The toggle is unavailable, with the reason in its tooltip, when the server is
not reachable or `HINDSIGHT_URL` is empty. A run recorded before memory existed
shows no memory panel at all, rather than an empty one.

---

## Configuration

Read by `fitgap/memory.py`, all optional:

| Variable | Default | Notes |
| --- | --- | --- |
| `HINDSIGHT_URL` | `http://127.0.0.1:8888` | **Empty switches memory off entirely** — nothing is probed and the toggle never offers itself. |
| `HINDSIGHT_API_KEY` | none | Bearer token, for a server that wants one. |
| `HINDSIGHT_BANK` | `spark-evidence` | The memory bank. A second bank is how you keep two corpora apart. |
| `HINDSIGHT_TIMEOUT` | `8` | Seconds. Deliberately far below the client's own 300s default, which would let a sick memory server stall an investigation. |
| `HINDSIGHT_RECALL_TOKENS` | `1200` | The ceiling on what one recall may put into the agent's context. |

---

## When it goes wrong

Every call is best-effort. The server is a separate process that is usually not
running, so "not there" is the ordinary case, not an error: `recall` returns
nothing, `retain` returns `False`, and the investigation proceeds exactly as it
did before any of this existed.

| Symptom | What it means |
| --- | --- |
| Toggle greyed, "No memory server at …" | The server is not running, or is on another port. |
| Toggle greyed, "HINDSIGHT_URL is empty" | Memory is switched off on purpose. |
| Toggle greyed under holdout | Working as intended — see the table at the top. |
| Panel says "Nothing was remembered about this question" | The bank has nothing relevant yet. The first run on a topic always says this. |
| Bank count does not move after a run | Extraction is still running (seconds on Claude, minutes on Ollama) — or it failed. Check: `list_operations` on the bank returns each one's `error_message`, and a wrong model name shows up there and nowhere else. |
| `cannot bind 127.0.0.1:8888: [Errno 48] Address already in use` | A Hindsight server is already running. `lsof -nP -iTCP:8888 -sTCP:LISTEN` says which process; it may well be one you want, since they all share the same bank. Stop it, or start this one on another port with `--port` and set `HINDSIGHT_URL` to match. |
| `Unclosed client session` on shutdown | The app did not call `memory.close()`. It does, from the lifespan. |

---

## The investigation log

Every run now keeps a step-by-step record, on the **Logs** button beside
Investigate. It is the run as a sequence, which is a different thing from the
panels below it: those say what happened, this says in what order and why.

```
 0  06:38:12.524  question  Which systems does the SOVOS interface specification connect?
 1  06:38:12.908  memory    used=True recalled=6
 2  06:38:12.910  note      Context handed to the agent
 3  06:38:15.523  thinking  I'll start by resolving SOVOS in the knowledge graph...
 4  06:38:15.618  tool_call graph_entity — "SOVOS" → 1 node
 5  06:38:15.954  tool_call search_corpus — "SOVOS interface specification SAP" → 10 chunks
 6  06:38:19.842  thinking  The corpus is clear; now the graph's view of SOVOS and the ticket...
...
14  06:39:29.171  thinking  I have what I need. Submitting the answer.
15  06:39:29.174  note      Answer rejected, sent back for correction
16  06:40:12.753  thinking  The tag was malformed; resubmitting.
17  06:40:12.761  note      Written back to memory
18  06:40:14.133  answer    supported · 8 claims
```

Four of those kinds had no record anywhere before:

| Kind | What it is |
| --- | --- |
| `question` | What was asked, with the scope and the toggles it was asked under. |
| `note: prompt` | The context **as assembled** — question, scope note, and the page of recalled notes. Not the sentence that was typed. |
| `thinking` | The agent's own account of what it is about to do. |
| `note: budget` / `note: rejected` / `note: retained` | Running out of tool budget; a submission the schema refused and sent back; the text written to memory. |

It is stored in `evidence_runs.log`, so reopening a past investigation restores
it. A `tool_call` line holds an index into `calls` rather than a second copy of
the passages, so clicking it opens the same trace drawer the panel does.

### Why `thinking` is narration, not extended thinking

`claude-opus-5` rejects `thinking: {"type": "enabled"}` outright, and
`{"type": "adaptive"}` returns a block whose `thinking` field is **empty** and
whose `signature` is encrypted. There is no plaintext reasoning to show,
whatever is asked for.

So the prompt asks the agent to state what it is doing in one sentence before
each tool call, and the log shows that. This changed `prompt_hash`
(`22ce11d0e928` → `a89375f129bf`), which means answers from before that change
are not strictly comparable with answers after it — that is what the hash on
every row is for. The code still reads a `thinking` block if one ever arrives
with text in it, so a model that does return reasoning is shown rather than
silently dropped.

---

## What is not done yet

* **Only the Evidence Agent uses it.** The transport is in `fitgap/memory.py`
  precisely so the Fit-Gap Copilot can, but it does not yet.
* **No way to read or prune the bank from the UI.** A wrong memory can only be
  removed with the Hindsight client or its own UI. Worth having before this is
  trusted with a lot of runs.
* **`reflect` is unused.** It is the operation that reasons over memory rather
  than retrieving from it, and the obvious next thing to try.
