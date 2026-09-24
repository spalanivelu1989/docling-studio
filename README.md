# Docling Extraction Studio

A local split-screen tool for checking document extraction quality. Load a
PPTX, DOCX, XLSX, PDF, or a PNG/JPEG image on the left, click **Convert to Markdown**, and see the
extracted Markdown on the right next to the original.

Built on [Docling](https://docling-project.github.io/docling/), with a Tesseract
OCR pass that Docling's Office backends don't provide on their own — embedded
screenshots (scanned tables, diagrams pasted as images) would otherwise come
through empty.

## Prerequisites

| Dependency | Why | Install |
|---|---|---|
| Python 3.12 | Docling allows 3.10+, but the heavy wheels (torch, tesserocr) lag behind the newest releases | `brew install python@3.12` |
| LibreOffice | Renders the original document for the left pane | `brew install --cask libreoffice` |
| Poppler | `pdftoppm`, splits the render into per-page images | `brew install poppler` |
| Tesseract | OCR for embedded images | `brew install tesseract` |
| Node.js 20+ | Only to change the web UI; the built UI in `static/dist/` is served as-is | `brew install node` |

## Setup

```bash
uv venv --python 3.12 .venv
VIRTUAL_ENV=.venv uv pip install -r requirements.txt
```

The web UI is a React app in `frontend/` (MUI components, Lucide icons, Framer
Motion animations). It is already built into `static/dist/`; after changing
anything under `frontend/src`, rebuild it:

```bash
cd frontend
npm install        # once
npm run build      # typecheck + build into ../static/dist
npm run dev        # or: live-reloading UI on http://localhost:5173, API calls go to ./run.sh on :8000
```

## Run

```bash
brew services start postgresql@18   # the Ask tab needs Postgres running; skip if it already is
./run.sh              # http://localhost:8000  (PORT=9000 ./run.sh to change)
```

Then: **Open document** (or drop a file on the page) → wait for the preview →
**Convert to Markdown**. A timer shows how long the server has been working.
Use **Raw** to see literal Markdown, the copy and download icons to take the
`.md`, and **Add to knowledge base** to make it searchable from the **Ask** tab.
The divider between the panes can be dragged.

The **Extract** and **Ask** tabs keep their state when you switch between them.
The sun/moon button switches between light and dark; it follows your OS setting
on first load and remembers your choice after that. Animations are turned off
when the OS asks for reduced motion.

## Command line

Same conversion engine, no browser:

```bash
.venv/bin/python pptx_to_md.py P2P.pptx -o out
```

Options: `--lang eng+deu`, `--scale 4` (upscale before OCR), `--no-ocr`,
`--no-flows`, `--vlm` (read dense images with the local vision model).

To convert a whole folder of `.xlsx`, `.pptx`, `.docx`, `.png` and `.jpg`/`.jpeg`
files in one go:

```bash
.venv/bin/python folder_to_md.py solvay-spark          # Tesseract OCR only
.venv/bin/python folder_to_md.py solvay-spark --vlm    # + local vision model
.venv/bin/python folder_to_md.py solvay-spark --vlm-provider claude   # or openai
```

The `.md` files are written to `solvay-spark/markdown/`, named after the file
and its type (`report.pptx` → `report_pptx.md`) so same-named files don't
overwrite each other. `-o DIR` writes somewhere else. Only the top level of the
folder is read, and a file that fails is reported and skipped. Progress is
printed per file:

```
[1/4] Converting deck.pptx ...
  144 pages, 2 image(s): 1 OCR, 1 tables, 0 flows, 0 vision model, 0 no text
  -> solvay-spark/markdown/deck_pptx.md (0.9s)
```

The vision model is **off unless you pass `--vlm` or `--vlm-provider`**. If
`mlx_vlm` is not installed the run falls back to Tesseract without an error, so
check that `vision model` is non-zero on the first run.

### Choosing the vision model

`--vlm-provider` (both CLIs) or the drop-down next to the AI toggle (web UI)
picks who reads the images:

| Provider | Where the image goes | Needs | Model |
|---|---|---|---|
| `qwen` (default) | Nowhere -- Qwen3-VL-8B runs on this Mac | `mlx_vlm` installed | `mlx-community/Qwen3-VL-8B-Instruct-4bit` |
| `openai` | OpenAI's API, through Docling's VLM pipeline | `OPENAI_API_KEY` | `gpt-5`, or set `OPENAI_VLM_MODEL` |
| `claude` | Anthropic's API, through Docling's VLM pipeline | `ANTHROPIC_API_KEY` | `claude-opus-5`, or set `CLAUDE_VLM_MODEL` |

```bash
export ANTHROPIC_API_KEY=...          # set where the CLI or ./run.sh runs
.venv/bin/python folder_to_md.py solvay-spark --vlm-provider claude
```

With `openai` or `claude`, **every dense image is uploaded to that company's
API** -- check that the documents may leave the machine before using them. The
cloud providers only re-read tables and screenshots as Markdown; flattened
flowcharts are still traced locally by `flow_cv.py`. If the key is missing or
the API refuses the call, the run carries on with image processing and OCR, and
says so on stderr (CLI) or in the status line (web UI).

Docling can only call an OpenAI-style `/v1/chat/completions` endpoint, so Claude
is reached through Anthropic's OpenAI-compatible endpoint. Anthropic describes
that endpoint as intended for evaluating models rather than as a long-term
production integration.

## Ask questions about the Markdown (RAG)

`rag.py` answers questions from the converted `.md` files: it splits them into
chunks, embeds each chunk locally using **BGE-M3** via [Ollama](https://ollama.com)
(`1024` dimensions), stores text and vectors in Postgres with
[pgvector](https://github.com/pgvector/pgvector) next to a full-text index, and
has Claude answer from the best chunks, citing them.

Make sure **Ollama** is running with `bge-m3` pulled:

```bash
ollama pull bge-m3
```

Needs a Postgres with the `vector` extension available (Homebrew's
`postgresql@18` ships it). Start it before running the app, or searches fail
to connect:

```bash
brew services start postgresql@18
```

Settings in `.env`:

```bash
DATABASE_URL=postgresql://user:password@localhost:5433/docling
ANTHROPIC_API_KEY=...     # for Claude answer synthesis
# Optional overrides (defaults shown):
OLLAMA_HOST=http://127.0.0.1:11434
RAG_EMBED_MODEL=bge-m3
RAG_EMBED_DIMENSION=1024
RAG_ANSWER_MODEL=claude-opus-5
RAG_HNSW_EF_SEARCH=200
```

### Categories

Every document belongs to a category, and **a category is a column, not a
database**: one `rag_documents` / `rag_chunks` pair in `DATABASE_URL`, one row
per chunk, and scoping a search is a `WHERE` clause. The Fit/Gap and Rollout run
stores sit beside them in the same database.

Each category had a database of its own for one release. It was merged back
because `rag_documents.source` is declared `UNIQUE` and could only be unique
*per* database, so the same file could be indexed twice and one delete removed
both. `migration_plan.md` has the reasoning, the measurements and the migration;
`consolidate.py` is the migration itself.

A document's category is decided in this order:

1. an explicit choice — `--category` on the command line, the `category` field
   on the upload and embed endpoints;
2. the file's own YAML front matter, `category: DR`;
3. the folder it sits in — `solvay-spark/<code>/markdown` names its category,
   so `solvay-spark/pkg/markdown` is `PKG`;
4. `UNFILED`.

**The UI does not offer the category.** Every page reads the whole corpus, and
nothing uploaded through the browser is asked where to file it — the folder and
the front matter decide, which means `UNFILED` for anything dropped on Convert,
Batch Convert or Add to Knowledge Base. The category is still recorded, still
shown on a retrieved chunk and on an agent's source chips, and still honoured by
the API and the CLI; it is a label on the data rather than a control.

**Adding a category takes no code change.** Put the Markdown in
`solvay-spark/<code>/markdown` and index it: the folder names the category and
the row records it. `rag.py categories` lists what each one holds.

```bash
.venv/bin/python rag.py index solvay-spark/dr/markdown   # files everything as DR
.venv/bin/python rag.py categories                       # what each one holds
.venv/bin/python rag.py ask "..." --category DR          # search one category
.venv/bin/python rag.py ask "..."                        # search all of them
.venv/bin/python rag.py retag path/to/file.md PKG        # re-file, no re-embedding
```

Edit `CATEGORIES` in `rag.py` only to give a category a label and description
for the UI. `rag_categories` is the registry of the ones that exist.

The category is **metadata, never embedded text**. A code like `PKG` means
nothing to BGE-M3, and adding it to every chunk would move a whole category by
the same constant vector without making any chunk in it easier to tell apart —
so re-filing a document is one `UPDATE`, not 50 embedding calls. The chunks
follow the document through a foreign key on `(document_id, category)` with
`ON UPDATE CASCADE`, so they cannot be left disagreeing with it. The category is
passed to Claude on each excerpt, so an answer can say which kind of document it
rests on.

Searching with no category covers all of them, which is what every page now
does; `--category` on the CLI and `categories` on the API still narrow it. The BM25 corpus statistics are
computed over whatever is in scope, so a chunk scores the same wherever it is
filed — without that, a category holding a handful of chunks would have
near-zero keyword scores and never surface beside a large one.

One index over every category is a bigger HNSW graph than one index per category
was, so `RAG_HNSW_EF_SEARCH` defaults to **800** rather than 200. Measured
against an exact scan over ten questions, searching every category: 0.85 recall
at 200, 0.98 at 600 and above. It costs about 0.7 ms on a search that takes
180.

### Documents attached to an agent session

InsightLens and the Fit-Gap Copilot both take uploads of their own — a
draft specification, a set of minutes, a country's As-Is SOP — and read them
*beside* the corpus without them joining it. Drop a PDF, Word, Excel,
PowerPoint, HTML, XML, `.csv` or plain `.txt` file into either page and it is
converted, chunked, embedded and given a knowledge graph of its own.

`.txt` takes a path of its own rather than going through Docling. Docling
accepts a text file but parses it *as Markdown*, which rewrites the characters
in it: `->` becomes `-&gt;`, `5_000` becomes `5\_000`, and a line of `=====`
promotes the line above it to a heading. The agents quote their evidence
verbatim and the verifier checks every quote character-for-character against
the chunk it came from, so an escaped copy turns a correctly quoted threshold
— "Above INR 5,00,000 -> credit committee" — into evidence that cannot be
verified and is dropped. A `.txt` file is already text, so it is passed
through with only a title added.

`.csv` does go through Docling, whose CSV backend reads it as a table rather
than as text — it sniffs the delimiter (comma, the semicolon a European Excel
writes, or tab) and emits one Markdown table with the header intact, leaving
the cells verbatim. Two things are done around it. Docling requires UTF-8 and
refuses anything else outright, so a CSV exported from Excel on Windows —
cp1252, the common case — would simply fail to convert; the file is decoded
first (UTF-8, BOM, then cp1252) and handed to Docling as UTF-8. And the title
is added as a heading, so the rows are chunked under one like every other
source. The document's size is reported in rows.

It is kept out of the corpus in the strongest way the storage allows:

* a database of its own, `docling_session`, beside the corpus database;
* one Postgres **schema** per session inside it, `u_<id>`, holding the same
  `rag_documents` / `rag_chunks` tables the corpus uses;
* `UPLOAD` is a reserved code, so nothing can be filed under the category the
  chunks carry either.

The isolation is the database boundary, not a filter: a corpus search runs
against the corpus database and these rows are not in it, so there is no `WHERE`
clause that could be got wrong. This is the one thing the consolidation did not
touch, and deliberately so.

A schema rather than a database per session because the isolation is the same
and the cost is not: a session holds tens of chunks, and `CREATE DATABASE` plus
an extension and an index for each buys nothing. `SET search_path` is what makes
it work — the tables resolve inside the session's schema, so `rag.index_file`
and `rag.search` run against it unchanged, with no second copy of the chunking,
embedding or retrieval code to keep in step.

An agent reaches an attachment through tools of its own, never through
`search_corpus`: `search_uploads` (`read_sources` in the Fit-Gap Copilot, which
filters by role) for its text, and `upload_entities` for the
systems, BPML codes and tickets it mentions, each marked according to whether
the corpus already knows it. That marking is the point — a shared entity tells
the agent exactly what to search the corpus for, and one only the attachment
has is worth reporting as new. InsightLens is told to report a disagreement
between an attachment and the corpus rather than pick a winner.

Everything expires. A session unused for `FITGAP_UPLOAD_TTL_HOURS` (12) is
swept: the schema is dropped, the rows go with it, and the extracted Markdown
is deleted. The sweep also drops any schema left behind by a crash between the
two statements. The run record keeps the document names, because by the time a
register is reopened the attachment itself is long gone.

```bash
# Optional overrides (defaults shown):
FITGAP_UPLOAD_TTL_HOURS=12     # how long an unused attachment is kept
FITGAP_UPLOAD_MAX_FILES=12     # documents per session
# The session store is docling_session, derived from DATABASE_URL; it is the
# only database beside the corpus one.
```

### The Fit-Gap Copilot

A second agent, on its own tab, does SAP Activate **Fit-to-Standard analysis
for a country rollout**. An analyst attaches the country's As-Is process
documentation — an SOP, a work instruction, a workshop transcript — and the
agent compares it against the Global Template in the corpus and, where a source
for it is attached, against SAP Best Practice.

Attachments carry a **role**: `Country As-Is`, `Global Template`, `SAP Best
Practice`, `Localization source` or `Reference`. That is what makes it a
three-way comparison rather than a two-document diff — without the role the
agent cannot tell a country SOP from a template extract. Roles are metadata, so
re-tagging a document costs nothing.

#### What the run analyses

A run reads one document set as its **subject** and compares it against the
Global Template. There are two:

| Subject | Requires | Asks |
|---|---|---|
| `Country As-Is` (default) | a `Country As-Is` document | How far is the country's current process from the template? |
| `SAP Best Practice` | a `SAP Best Practice` document | How far has the template drifted from SAP's delivered standard? |

The second exists because "our template has diverged from SAP standard" is a
real finding with an owner — §19 of the specification maps it to *template
improvement / design review* — and it was previously only reachable by tagging
a Best Practice document `Country As-Is`, which made the agent report SAP's
process as a country's own.

Two things follow from the subject rather than from anything the agent
decides, so they are enforced rather than left to the prompt:

* **Localization does not apply** to a Best Practice run. There is no country
  in it, so a statutory-localization claim would be a legal assertion about
  nobody. Any the model produces are reset to *Not localization-related* and
  the localization register is dropped, with both reported as quality-gate
  findings.
* **Score B is not reported.** It rates the subject against SAP Best Practice,
  and here the Best Practice content *is* the subject. Score C
  (localization-adjusted) is `null` rather than equal to Score A — a number
  that happens to match reads as a second measurement agreeing with the first.

Each subject has its own prompt hash, because a run recorded against a hash
that does not describe its instructions cannot be reproduced from the record.

Naming the Global Template process is **optional**. Give it a BPML code and
the comparison is anchored there; leave it empty and the agent works out which
template process corresponds to the As-Is and records what it settled on. A
code that is typed but does not resolve is still an error — a typo must not
quietly become "no scope", or the run analyses against a different process
than the one that was asked for. A run that names none and identifies none is
reported as having no stated baseline, so the scores are never shown as if the
question had not arisen.

It runs in two passes, because §21 of the specification puts "understand the
As-Is before comparing it" first: a model given the comparison tools while it
is still reading starts diffing paragraphs.

1. **Read** — only the attachments are visible. The agent produces a normalised
   process model: atomic steps with trigger, actor, action, system, business
   rule, decision, control, output, exception and integration, plus what it
   normalised and what the documents never said.
2. **Compare** — the As-Is model is handed back as text, now with the corpus,
   the knowledge graph and the BPML hierarchy. Out comes a deviation register
   on the 16-code taxonomy, a localization advisory, dimension ratings, a
   workshop agenda and backlog candidates.

**The scores are computed, not generated.** The agent rates seven dimensions
0–4 and gives each deviation a harmonization potential; `rollout/scoring.py`
does the arithmetic. A score a model writes can be argued into a better number;
a score derived from a rated register cannot move without changing a finding a
reviewer can see. The localization-adjusted score publishes its own formula,
and only a *confirmed* statutory or SAP-delivered localization lifts it — a
suspicion does not, because that is the assumption the guardrails forbid.

**Quality gates** (`rollout/gates.py`) run before anything is shown, and they
repair rather than merely report:

| Gate | What it enforces |
|---|---|
| QG1 | Every As-Is step is mapped, or named as unmapped |
| QG2 | Every quote is verbatim, in a chunk this run actually retrieved |
| QG4 | "Confirmed statutory" without an explicit source is demoted to "suspected" |
| QG5 | An extension proposed without recording the standard options considered becomes a decision; an SAP Best Practice rating with no SAP source is removed |
| QG6 | A Must Discuss item without a decision question is flagged |
| QG7 | A backlog candidate that names no gap is dropped; a run that named no template process must say which one it used |

QG3 (semantic accuracy) is deliberately absent and says so: whether the agent
compared meaning rather than wording is a human judgement, and a gate that
always passes would only make the report look better than it is.

One invariant is enforced at submission rather than afterwards: a dimension
rated 2 or below ("moderate deviation" or worse) must name at least one
deviation on that dimension. Without it a run can produce a measured-looking
alignment score over a register saying the process matched — which is exactly
what the first real run did before the check existed.

```bash
.venv/bin/python rollout/test_rollout.py   # the scoring and the gates
```

Runs are kept beside the corpus in `DATABASE_URL`, and the workshop pack
exports as Markdown or JSON from the page.

**Upgrading an index that still has a database per category:**

```bash
.venv/bin/python consolidate.py baseline    # record what the split system does
.venv/bin/python consolidate.py run         # merge into one database
.venv/bin/python consolidate.py verify      # hold the result to the baseline
```

Nothing is re-embedded — the vectors are carried across as they are, which takes
about three seconds where re-embedding would take eighteen minutes. `run` is
additive: it reads the old databases and never writes to them, so they stay
exactly where they are as the rollback.

**In the browser:** `./run.sh`, then open <http://localhost:8000/ask> (or the
**Ask** tab in the header). Type a question and the page shows each step as it
runs: embedding the question with Ollama, vector search, keyword search, merging the
rankings (with timings and what each step found), then Claude's answer as it
is written, with citations that jump to their source. The **Sources** section
at the bottom lists the excerpts Claude received, with the matched words
highlighted and three scores for each: combined (the order used), semantic
similarity and keyword score; the buttons re-sort by any of them, highest first.

**Adding documents to the knowledge base:**
- **From the Convert page:** After converting, click **Add to knowledge base** to chunk and embed that Markdown into PostgreSQL `pgvector`.
- **From the Batch Convert page:** Click **Insert into Knowledge Base** to queue and embed all converted documents in one go with real-time SSE progress.
- Files are stored in `knowledge_base/<name>_<ext>.md`.

**From the command line:**

```bash
createdb docling                                           # once
.venv/bin/python rag.py index solvay-spark/pkg/markdown    # chunk + embed with bge-m3 + store
.venv/bin/python rag.py search "Who owns 7.1.12.3 Production Declaration?"
.venv/bin/python rag.py ask "Who owns 7.1.12.3 Production Declaration?"
.venv/bin/python rag.py categories                         # what each category holds
.venv/bin/python rag.py retag knowledge_base/x.md DR       # re-file, no re-embedding
.venv/bin/python rag.py chunks "solvay-spark/pkg/markdown/deck_pptx.md"  # preview chunking, no API calls
```

### The Evidence Agent

One question, both engines, and an answer that is a set of claims rather than a
paragraph — each claim carrying the passages that support it and the arithmetic
behind its score. Every quote is checked character-for-character against the
chunk it names; one that is not found is discarded rather than shown.

**Investigations are kept.** Each run is written to `evidence_runs` as it
happens — the question and its settings, every tool call in order, and the
verified answer — so the history strip on the page reopens a past investigation
with its working intact. Nothing is re-run and nothing is re-billed when you
open one.

Written *as it happens* rather than at the end, which is what makes an
interrupted run useful: close the tab mid-investigation and the row keeps the
calls it had made. Such a run reads `abandoned` after 30 minutes rather than
sitting at `running` for ever, and the row is not rewritten — it still records
that it was interrupted rather than finished. A failed run is kept too; what
the agent managed to read before it failed is usually the reason to look again.

```
GET    /api/evidence/runs          past investigations, newest first
GET    /api/evidence/runs/{id}     one in full: question, calls, answer
DELETE /api/evidence/runs/{id}     remove one
```

If the history cannot be written — no database, no table — the investigation
still runs and still answers; the page says it is not being recorded rather
than refusing the question.

### Removing or Resetting Data in pgvector

If you want to clear old records or switch embedding models:

1. **Reset schema for BGE-M3 (1024d) — Recommended:**
   Drops existing tables and recreates clean tables matching `vector(1024)`:
   ```bash
   .venv/bin/python rag.py reset               # drops and recreates the tables
   ```

2. **Clear all documents and chunks (keep schema):**
   Truncates all stored documents and chunks:
   ```bash
   .venv/bin/python rag.py clear               # every category
   .venv/bin/python rag.py clear --category DR # just one
   ```

3. **Wipe and immediately re-index a folder:**
   Recreates the schema and re-embeds all files in one step:
   ```bash
   .venv/bin/python rag.py index knowledge_base --rebuild
   ```

4. **Via direct SQL / `psql`:**
   ```sql
   -- Option A: Empty all records
   TRUNCATE TABLE rag_documents CASCADE;

   -- Option B: Completely drop tables
   DROP TABLE IF EXISTS rag_chunks, rag_documents CASCADE;
   ```

**Retrieval is hybrid.** Each question is looked up two ways, and the two
rankings are merged with reciprocal rank fusion (each chunk scores
`1 / (60 + rank)` in each list):

| Search | Finds | Misses |
|---|---|---|
| Vector (pgvector, cosine) | Chunks with the same meaning in other words ("who is responsible" → `Role = Quality Planner`) | Exact identifiers: embeddings treat `7.1.12.3` as noise |
| Keyword (Postgres full text, BM25) | Chunks containing the question's words, rare words such as a code weighted highest | Paraphrases |

Codes like `M-090-030-010` are also indexed as one word with their parents
(`m090030`, `m090030010`), because Postgres would otherwise split them at the
hyphens and match every `M-090-…` step. `--mode vector` or `--mode keyword` on
`search`/`ask` uses one method alone.

On 14 questions with checked answers (5 naming a code, 9 in plain words):

| Mode | Right chunk in top 8 | Ranked first | MRR |
|---|---|---|---|
| vector | 13/14 | 10/14 | 0.78 |
| keyword | 14/14 | 10/14 | 0.84 |
| **hybrid** (default) | **14/14** | **11/14** | **0.88** |

Hybrid matched vector on the plain-word questions and fixed the code ones:
"Who owns 7.1.12.3 Production Declaration?" had the answering row at #8 with
vector search and #2 with hybrid. The set is small and written by us, so treat
it as a sanity check rather than a benchmark.

Re-running `index` embeds only files whose content changed, and drops files
that were deleted from the folder. `--force` re-embeds everything; `--rebuild`
drops the tables first (needed after changing `RAG_EMBED_DIMENSION`).

**Chunking** (`md_chunker.py`) follows the Markdown the converter writes rather
than cutting every N characters:

| Step | What happens |
|---|---|
| Parse | Headings, paragraphs, tables and ```` ```mermaid ```` blocks become units; the `<!-- OCR of ... -->` provenance comments are dropped |
| Sections | Each heading starts a chunk: one slide, one sheet, one numbered chapter. A section under ~120 tokens (a slide title, `Role = ...`) is joined to the one after it, so a title never sits apart from its content |
| Size | Chunks are filled to ~500 tokens, never above 1000, and don't end on a heading (except a closing "Thank you" slide) |
| Big tables | Cut between rows into even pieces, the header row repeated on every piece; empty spreadsheet columns (`col10`, …) removed |
| Big flowcharts / paragraphs | Cut between lines / sentences, flowcharts staying inside a mermaid fence |
| Context | The document title and heading path are put in front of each chunk before embedding, so a bare table row is still found by a question about its sheet |

On `solvay-spark/markdown` that gives 438 chunks (median ~200 tokens for slide
decks, ~450 for spreadsheets). Token counts are estimated as characters / 4.

| Setting | Default |
|---|---|
| `RAG_EMBED_MODEL` | `embed-v4.0` |
| `RAG_EMBED_DIMENSION` | `1536` (also 256, 512, 1024) |
| `RAG_ANSWER_MODEL` | `claude-opus-5` |

**Data leaves the machine:** chunk text is sent to Cohere when indexing, and the
question plus the retrieved chunks are sent to Anthropic when asking.

## How it works

Two independent paths run off one uploaded file:

- **Preview (left)** — LibreOffice → PDF → per-page PNG. Two hops because
  `--convert-to png` only exports the first slide of a presentation.
- **Extraction (right)** — Docling reads native text out of the OOXML, then each
  embedded raster image is OCR'd with Tesseract and spliced back in at its
  placeholder. Spreadsheets bypass Docling entirely (see below). Scanned PDFs
  have no embedded media to pull out, so their pages are rendered to images and
  read the same way. An uploaded PNG or JPEG skips Docling too and is read
  exactly like an image found inside a slide -- OCR, table and flow detection,
  and with the AI toggle on, the vision model. It is straightened (EXIF rotation) and
  flattened onto white first, so phone photos and transparent screenshots read
  correctly.

Preview failure doesn't block extraction — you can still convert a document that
won't render.

| File | Role |
|---|---|
| `app.py` | FastAPI: upload, convert, preview/media, download; `/ask` page and its streaming `/api/ask` endpoint; serves the built UI |
| `preview.py` | LibreOffice + pdftoppm rendering |
| `converter.py` | Conversion core, shared by the CLI and the web UI |
| `pptx_ocr.py` | Tesseract layer (upscale + sparse-text mode) |
| `xlsx_tables.py` | Spreadsheet tables (Docling splits sheets on blank rows) |
| `pptx_flow.py` | Rebuilds flowcharts from PowerPoint connector shapes |
| `table_cv.py` | Ruled tables in images: border lines + per-cell Tesseract |
| `flow_cv.py` | Flowcharts in images: shapes, connector lines and arrowheads |
| `vlm_ocr.py` | Local vision model: table structure, and arrows in flattened diagrams |
| `vlm_api.py` | GPT / Claude through Docling's VLM pipeline: table structure |
| `pptx_to_md.py` | CLI wrapper |
| `folder_to_md.py` | CLI: convert every supported file in a folder |
| `rag.py` | CLI: index the Markdown in pgvector (BGE-M3 Ollama embeddings) and answer questions with Claude |
| `md_chunker.py` | Splits the Markdown into heading-aware chunks for `rag.py` |
| `frontend/` | Web UI source (React + MUI + Lucide + Framer Motion): `src/pages/ExtractPage.tsx`, `src/pages/AskPage.tsx` |
| `static/dist/` | The built web UI that `app.py` serves (`npm run build`) |

## Which path each file takes

### The engines

| Engine | What it is | Used for |
|---|---|---|
| Docling Office backends | XML parsers, no ML model | Native text, headings, lists and tables in PPTX and DOCX |
| Docling PDF pipeline | `docling-layout-heron` layout model, TableFormer (accurate mode), auto-selected OCR engine | Text, layout and tables in PDFs |
| `xlsx_tables.py` | openpyxl, no ML model | Every sheet of an XLSX, as Markdown tables |
| `pptx_flow.py` | Reads PowerPoint connector shapes, no ML model | Exact flowcharts from slides whose arrows are real connectors |
| Tesseract (`pptx_ocr.py`) | Classic OCR, 3× upscale, sparse-text mode | Text inside images. Always on |
| `table_cv.py` | OpenCV border detection + Tesseract per cell, no ML model | Ruled tables in images (SAP GUI grids, Excel ranges) as Markdown tables. Always on |
| `flow_cv.py` | OpenCV shape, connector and arrowhead detection + Tesseract per shape, no ML model | Flowcharts pasted as pictures, as DRAFT Mermaid. Always on |
| Qwen3-VL-8B (`vlm_ocr.py`) | Local vision-language model via MLX, 4-bit | Tables and screenshots as Markdown, and flattened diagrams as draft Mermaid. **Only with `--vlm` or the AI toggle** |
| GPT / Claude (`vlm_api.py`) | Cloud vision model called through Docling's VLM pipeline | Tables and screenshots as Markdown. **Only with `--vlm-provider openai`/`claude` or the drop-down; images leave the machine** |

### By scenario

| Scenario | Path | Engines involved |
|---|---|---|
| PPTX, text only | Docling reads the slide XML. Nothing is OCR'd. | Docling |
| PPTX with native tables | The table is read from the XML as a real table. | Docling |
| PPTX with embedded images | Docling marks each picture, the image is pulled out of the package, matched to its slide, read, and its text spliced in where the picture sat. See [Images](#images). | Docling → Tesseract → (Qwen3-VL) → flow / table detection |
| PPTX with a flowchart drawn as shapes and connectors | Arrows rebuilt exactly and appended as Mermaid under "Process flows". Images on that slide are never traced as diagrams, but can still be read as tables. `--no-flows` turns this off. | `pptx_flow.py` |
| PPTX with a flowchart pasted as a picture | No connector data survives. The arrows are traced from the pixels into a Mermaid block marked DRAFT, with Tesseract's box labels below it; with `--vlm` the vision model is tried first. | Tesseract → (Qwen3-VL) → `flow_cv.py` |
| Any image holding a ruled table or SAP screen | Border lines give rows, columns and merged cells; each cell is OCR'd on its own. Text outside the tables follows as plain lines. | Tesseract → (Qwen3-VL) → `table_cv.py` |
| DOCX, text only | Docling reads the document XML. | Docling |
| DOCX with native tables | Read from the XML as real tables. | Docling |
| DOCX with embedded images | As for PPTX, but pictures are matched to images by order in the package (DOCX has no per-slide mapping). No connector flows. | Docling → Tesseract → (Qwen3-VL) → flow / table detection |
| XLSX | Bypasses Docling. Each sheet becomes one table, using cached values for formula cells. Images and charts in the workbook are **not** read. | `xlsx_tables.py` |
| PNG / JPEG | Bypasses Docling. Rotated upright, flattened onto white, then read as one image. | Tesseract → (Qwen3-VL) → flow / table detection |
| PDF with a text layer, no pictures | Layout, reading order and tables from Docling. | Docling PDF pipeline |
| PDF, scanned or with pictures | Docling's own pass runs, and each page holding a picture is also rendered at 150 DPI and read as an image, spliced in at the first picture on that page. Page text can therefore appear twice. | Docling PDF pipeline → Tesseract → (Qwen3-VL) → flow / table detection |
| PPT, DOC, XLS (web UI only) | Left to Docling. These are not zip packages, so images are not extracted, OCR'd or traced, and there are no connector flows. `folder_to_md.py` skips them. | Docling |

Steps in brackets run only with `--vlm` / `--vlm-provider` (or the AI toggle),
and only when the chosen model is usable: `mlx_vlm` installed for Qwen3-VL, the
API key set for GPT or Claude.

### Images

Every image, whatever file it came from, goes through the same decision:

| Step | Check | Outcome |
|---|---|---|
| 1 | Tesseract reads it | Always happens |
| 2 | Mean confidence below 70 | Photo, icon or gradient: left out, marked `<!-- no readable text -->`. Stops here. |
| 3 | `--vlm` on, at least 20 words and 200×150 px | The vision model gets the first try: steps 3a and 3b. If neither is kept, carry on at step 4. |
| 3a | Provider is `qwen`, and it looks like a diagram (≥ 5 scattered text blocks, not a grid), and its slide has no connector flow | Qwen3-VL is asked whether it *is* a diagram. If yes, it traces it into DRAFT Mermaid (at least 3 arrows, or it is discarded). Tesseract's labels are kept below. |
| 3b | Otherwise | The chosen model (Qwen3-VL, GPT or Claude) re-reads it as Markdown. Kept if it recovered a table, or read at least as much text as Tesseract without looping. |
| 4 | `flow_cv.py` finds a flowchart: at least 3 arrows with a visible arrowhead (40% of all arrows), and 60% of steps with a real word as label | DRAFT Mermaid, with Tesseract's labels below. If the slide already has connector flows, the image falls through to plain text instead. Stops here. |
| 5 | `table_cv.py` finds ruled tables with a mean cell confidence of at least 75 | Markdown tables, preceded by the text found outside them. Stops here. |
| 6 | Otherwise | Tesseract text. |

Each block in the Markdown starts with a comment saying which engine produced
it: `<!-- OCR of … via tesseract -->`, `<!-- tables in … read by image
processing + tesseract -->`, `<!-- … read by Qwen3-VL -->` / `<!-- … read by Claude (Anthropic API), model … -->`, or a DRAFT flow
caveat naming image processing or the vision model.

### How well the image-processing steps work

Measured on this corpus, with no ML model involved:

| What | Test set | Result |
|---|---|---|
| Tables (`table_cv.py`) | 6 hand-transcribed tables: SAP GUI grids, Excel ranges with merged cells | 94% of cells reproduced exactly |
| Flows (`flow_cv.py`) | 75 slides of *P2P- L4_L5 Processes* rendered to images, scored against the connector graph PowerPoint stores, shapes matched by position | 79% of shapes found; 60% of arrows recovered, 82% of drawn arrows correct |
| Flow vs not-flow | 104 images embedded in the decks | 20 of 24 flowcharts traced, no SAP screen mistaken for one |

For comparison, Qwen3-VL-8B scored 48% arrow recall and 63% precision on 12
slides of the same deck.

Known limits:

- **Dashed connectors are missed.** Each dash is a separate stroke, and joining
  them also joins text to lines, which cost more arrows than it recovered.
- **Crossing connectors** merge into one piece, so arrows can pair up wrongly.
- **Tables without drawn borders** (Fiori lists, whitespace-aligned text) are
  not detected and stay as plain OCR text.
- **Swimlane diagrams can be read as tables** when the flowchart itself is not
  recognised: the lanes are ruled like a grid.
- Cells in SAP's fixed-width font sometimes read `0` as `9` (`9020` for
  `0020`). Values in a table deserve a glance before they are relied on.

## Solvay SPARK Knowledge Graph & Query Engine

Docling Studio includes an interactive enterprise Knowledge Graph (354 nodes, 560 edges) constructed from Solvay SPARK project specifications, business streams, core systems, and BPML process taxonomies.

Users can explore the ontology visually via an interactive D3 force-directed canvas and ask natural language questions (e.g. *"What specs are linked to Salesforce?"*, *"How does eCommerce connect to S/4HANA?"*, *"What is BPML process O-020-090?"*).

### How Our Graph Algorithm Works Compared to Neo4j

When you ask a question in the Knowledge Graph tab, **no SQL query is written or executed**. 

Instead, the system relies on deterministic in-memory graph traversal algorithms. Here is how our architecture compares to **Neo4j** and traditional **Relational SQL**:

| Dimension | Our In-Memory Engine (`knowledge_graph.py`) | Neo4j Graph Database | Traditional Relational SQL (PostgreSQL) |
|---|---|---|---|
| **Query Engine** | BFS Pathfinding & 2-Hop Bridge Traversal in Python | Cypher Engine (`MATCH (a)-[:REL]->(b) RETURN b`) | Relational Planner (`JOIN`, `GROUP BY`, `INDEX SCAN`) |
| **Data Structure** | In-Memory Adjacency List (`dict[str, list[tuple]]`) | Native Graph Storage (Disk + PageCache) | 2D Relational Tables with B-Tree Indexes |
| **Memory Pointers** | Direct in-memory Python references | Native Index-Free Adjacency (disk/RAM pointers) | Foreign Key lookup via Index Trees ($O(\log N)$) |
| **Pathfinding Cost** | $O(V + E)$ queue-based Breadth-First Search | $O(V + E)$ bidirectional BFS / Dijkstra | Exponential cost via recursive joins (`WITH RECURSIVE`) |
| **Multi-Hop Traversal** | **< 2 ms** for arbitrary hops | **< 2 ms** for arbitrary hops | High latency as join depth increases |
| **Setup & Footprint** | **Zero external dependencies** (built into Python) | Requires JVM daemon, Bolt protocol, network port | Requires running SQL server & table migrations |
| **Primary Use Case** | Local interactive workbench, deterministic ontology exploration, GraphQA | Enterprise-scale graphs (billions of nodes/edges), transactional ACID writes | Tabular, accounting, transactional records |

### The Algorithm Under the Hood

When a user submits a query via the Knowledge Graph query bar or clicks an entity in the UI:

1. **Natural Language Question & Intent Parsing**:
   - The engine analyzes the question structure to determine intent:
     - **Path Queries**: Patterns like `"How does X connect to Y"`, `"path from X to Y"`, or `"difference between X and Y"` trigger targeted pathfinding.
     - **Neighborhood Queries**: Patterns like `"What specs are linked to X"` or `"processes in L2C"` trigger typed neighborhood exploration.
   - User-supplied terms are resolved to canonical entity node IDs using exact and fuzzy substring matching across labels, codes, and tickets.

2. **Breadth-First Search (BFS) Shortest Path**:
   - When searching for connections between two systems (e.g. `Solvay@eCommerce` and `SAP S/4HANA`), the engine executes a queue-based BFS traversal over the adjacency list:
     ```
     [System: eCommerce] ➔ (runs_on) ➔ [Doc: Interface Spec] ➔ (runs_on) ➔ [System: SAP S/4HANA]
     ```
   - Returns the exact hop count, ordered sequence of nodes, and edge relationship labels.

3. **2-Hop Bridge Expansion**:
   - In enterprise ontologies, high-level platforms (like `Salesforce`) are often separated from specific technical tickets (`SPARK-22877`) by intermediate document or interface nodes.
   - A naive 1-hop search would only find the document; our engine automatically expands **2 hops through intermediate bridges** to retrieve all concrete SPARK tickets, while pruning unrelated nodes to keep the result focused and readable.

4. **GraphQA Answer Synthesis**:
   - Instead of generic vector chunk retrieval (which lacks relational awareness), the engine synthesizes a structured, factual answer grounded in the graph:
     - **Direct Answer**: Plain-language executive summary answering the question directly.
     - **Core Systems & Streams**: Roles and technical descriptions of every platform involved.
     - **SPARK Specifications & JIRA Tickets**: Exact ticket codes resolved to their human-readable functional titles.
     - **Step-by-Step Integration Flow**: Visual pipeline mapping how data and processes flow across boundaries.
     - **Source Document Citations**: Cites the exact Markdown files with character lengths.

5. **D3 Canvas Subgraph Isolation**:
   - The matched nodes and edges are highlighted with glowing auras and visible relation labels on the D3 canvas.
   - All unrelated nodes and edges are dimmed (`opacity: 0.12`).
   - The camera automatically calculates the bounding box of the matched subgraph and executes a smooth pan/zoom transition to frame the answer.

## Tracing the agents (Langfuse)

Off unless configured. The four things that call a model -- the Fit-Gap Copilot,
InsightLens, the Evidence Agent and `/ask` -- each record one
[Langfuse](https://langfuse.com) trace per run: the retrieval it did, every
tool call with what it returned, every model turn with its prompt and token
usage, and the run's result. Without `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` nothing is sent, nothing is imported beyond
`tracing.py`, and the engines behave exactly as they do now.

Add to `.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or eu/us/self-hosted
# Optional:
LANGFUSE_TRACING_ENVIRONMENT=development       # default; tags every trace
LANGFUSE_RELEASE=                              # a version string, if you keep one
```

Keys come from the Langfuse project under Settings -> API Keys. `./run.sh`
prints one line at start-up saying whether tracing is on, and says so plainly
if the credentials are refused -- a wrong key is a line in the log rather than
a run that quietly produces nothing.

What a trace looks like, using a Rollout run as the example:

```
rollout-analysis                     agent      the whole run
  read-as-is                         agent      pass one
    anthropic.chat                   generation one model turn (prompt, tokens, cost)
    read_sources                     retriever  what it read, and what came back
    ...
  compare-to-template                agent      pass two
    search_corpus                    retriever
    get_scope                        retriever
    ...
  quality-gates                      evaluator  what the gates rejected or repaired
```

Two things worth knowing:

- **The session is the upload session.** Attaching documents and then running
  the Fit-Gap Copilot and InsightLens over them gives three traces in one
  Langfuse session, which is how they read as one piece of work. There is no
  `user_id`: this application has no accounts.
- **What is masked.** API keys, database passwords, JWTs and email addresses
  are redacted on the way out. Document text is not -- it is the reason the
  trace is worth keeping. Point this at a Langfuse project you would be
  willing to show the corpus to.

## Notes

- **Localhost only.** No auth, no upload limit, no sandboxing of the parsers.
  Add all three before putting this on a network.
- Each upload leaves its renders in `.workdir/` (~20 MB for a 144-slide deck).
  `DELETE /api/docs/{id}` clears one; the UI doesn't call it, so clear the
  directory manually when it grows.
- **Process flows.** PowerPoint records which two shapes each arrow joins, so a
  deck's flowcharts are rebuilt *exactly* rather than guessed from pixels, and
  appended as Mermaid diagrams under a "Process flows" heading. Disable with
  `--no-flows`. Not available for PDFs, or for a diagram pasted into a slide as
  a picture -- in both cases the connector data was destroyed when the file was
  flattened. For those, see the vision model below.
- **Reading images with AI** (the header toggle, or `--vlm` on the CLI) sends
  dense images to `Qwen3-VL-8B` running locally through MLX. Nothing leaves the
  machine. It does two jobs, and is off by default. First use downloads ~5.4GB
  of weights to `~/.cache/huggingface`.
  - **Tables and SAP screenshots** are re-read as Markdown, recovering row and
    column structure Tesseract scrambles.
  - **Flattened process diagrams** are traced into a draft Mermaid graph. This
    is the only way to get *arrows* out of a picture, and the result is a draft:
    benchmarked against the connector ground truth in these decks it finds about
    half the arrows and about a third of the arrows it draws are wrong. Every
    such block is labelled `DRAFT` in the output. Where real connectors exist
    they always win -- a slide already covered by `pptx_flow.py` is never
    second-guessed.
- Asked for a flowchart, the model will draw one out of anything: shown a SAP
  table it chains the cells into a process that does not exist, and nothing
  downstream can tell that apart from a real answer. So each candidate image is
  first asked, in one word, whether it *is* a diagram, and only then traced.
- The vision model is used only when its answer actually beats Tesseract's: a
  recovered table always wins, anything else must read at least as much text and
  must not be a repetition loop.
- OCR groups words into the blocks they sit in rather than into full-width
  lines, so a diagram's boxes come out one label per line instead of three
  unrelated boxes interleaved word by word. Labels only -- Tesseract reads
  glyphs, never structure. The arrows come from `pptx_flow.py` where the source
  PowerPoint survives, and from `flow_cv.py` (or the vision model, with `--vlm`)
  where it does not.
- Images are OCR'd only when Tesseract is confident the content is text
  (mean confidence >= 70). Photos, icons and gradients otherwise yield pages of
  plausible-looking gibberish; those are left out and marked
  `<!-- no readable text -->` instead.
- The Markdown carries only what was read from each image, never the image
  itself. Embedded images are extracted solely so they can be read.
- Only `eng` language data ships by default. `brew install tesseract-lang` for
  the rest, then pass `--lang`.
- XLSX previews get arbitrary page breaks across wide sheets, so a 7-column
  sheet may show 2 columns per page. That is a LibreOffice PDF-export limit
  affecting the preview only; the extracted Markdown keeps every column.
- Spreadsheets are extracted by `xlsx_tables.py`, not Docling. Docling splits a
  sheet wherever it finds a blank row, which orphans the header from its data
  and promotes a data row to a header in every fragment.
