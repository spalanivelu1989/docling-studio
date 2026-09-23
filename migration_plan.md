# One database for the corpus

Consolidating `docling_pkg` and `docling_dr` into a single `docling` database with a
`category` column, and what has to change in every part of the system that reads or
writes documents.

**Status: done.** Written as a plan on 22 September 2026, approved, and carried out the
same day. §15 records what the rehearsal and the live run changed about it — one
measurement in §1 turned out to be incomplete and cost a settings change, and the
citation rewrite in §8 turned out to have a shape nobody had looked for.

`consolidate.py` is the migration. `backup/baseline.json` is what the split system
did, recorded before anything moved; `consolidate.py verify` holds the merged one to
it. `docling_pkg` and `docling_dr` were never written to and are still there.

Everything measured below was measured against the live corpus and a scratch copy of
it (`merge_rehearsal`), which was dropped afterwards.

---

## 1. Recommendation, and the two places the earlier note was wrong

Do it. One `rag_documents` / `rag_chunks` pair in one database, with the `category`
column that both tables already carry, and one HNSW index over all of it.

But do it for the right reason. The earlier note (`db_migration.txt`) argued the case
on performance and on partial indexes. Both claims fail when measured.

**The split is not costing query time.** Fan-out is not the expensive part; the rows
are. Searching PKG and DR together costs the same whether they are in two databases or
one, because the same 7,450 chunks have to be ranked either way:

| scope | two databases (today) | one database | top-8 agreement |
|---|---|---|---|
| PKG only | 102 ms | 117 ms | 9/10 identical, 78/80 chunks shared |
| DR only | 73 ms | 76 ms | 10/10 identical, 80/80 |
| PKG + DR | 182 ms | 180 ms | 9/10 identical, 79/80 |
| every category | 184 ms | 183 ms | 9/10 identical, 79/80 |

Median of five runs per question, ten real questions from the eval set, hybrid mode,
same embeddings, same `ef_search`. A single-category search actually gets *slightly
slower*, because the HNSW walk now covers a graph of 7,450 vectors instead of 4,255
before the category filter is applied. The remaining top-8 differences are HNSW
approximation noise, not a change of design — re-running the same query against the
same database produces the same kind of jitter.

So: **no performance argument in either direction.** Anyone who approves this
expecting the Ask page to get faster will be disappointed.

> **Corrected after the rehearsal.** This is true of *one* search, and the table below
> compares the wrong pair. Searching two categories across two databases collects 40
> candidates from each and keeps the best 40; one database at the same `ef_search`
> collects 40 in total from a graph nearly twice the size, and finds fewer of the true
> nearest neighbours — 0.85 recall against 0.98. `ef_search` buys it back for 0.7 ms.
> See §15.1. The conclusion stands and is if anything stronger: there is no
> performance argument in either direction, and the merge has to be paid for with a
> setting.

**Partial indexes per category are a trap.** The earlier note proposed
`CREATE INDEX ... WHERE category = 'PKG'` to preserve per-category index quality. They
do not preserve it reliably. Recall against the exact nearest neighbours, same data,
same queries, different builds of the same index:

| index | recall@40 |
|---|---|
| today's dedicated index in `docling_pkg` | 1.00 |
| one global index + `WHERE category = 'PKG'` | 0.96 – 0.98, stable across rebuilds |
| partial index `WHERE category = 'PKG'` | 0.05, then 0.79, then 0.96, then 1.00 |

Four builds of the same partial index over the same 4,255 vectors, and one of them
returned **two of the true top forty**. The query planner used the partial index in
every case — `Index Scan using rag_chunks_embedding_pkg` — so this is not a planning
problem; the graph itself came out degenerate, and nothing in the query or the logs
said so. A global index did not do this in any build.

The concern that motivated partial indexes — the one written into `_tune`'s docstring,
that HNSW walks before it filters, so a category filter quietly returns a handful of
rows — is already solved. pgvector 0.8.2 is installed and `hnsw.iterative_scan =
relaxed_order` is already set on every connection. Measured: a global index with a PKG
filter returns 0.96 recall, the same as with no filter at all. The lever is already
pulled.

**The real reasons to merge, all of which hold:**

1. `rag_documents.source` is declared `UNIQUE` and is not. It is unique *per database*,
   so the same path can be indexed twice under two categories, and one `DELETE` by name
   removed both — the bug hit on 22 September. In one database that state cannot be
   written down.
2. Changing a document's category is an `UPDATE` instead of a cross-database copy and
   delete that is not atomic and can leave a document in two places or none.
   `move_category` (48 lines) exists only to do this by hand.
3. Roughly 200 lines of `rag.py` are fan-out plumbing — shard discovery, per-shard
   connection caching, IDF reconstruction across shards — and they go away along with
   the class of bug they generate.
4. The evidence-duplication check (`evidence/independence.py`) *cannot* see two copies
   of the same document filed under different categories, and says so in a comment. In
   one database it can.
5. Creating a category from the UI — deferred twice now — becomes an `INSERT` into
   `rag_categories` instead of `CREATE DATABASE`.

**Cost:** one afternoon, and the loss of three capabilities listed in §12 that nobody
is currently using.

---

## 2. What is actually there today

Measured, not assumed:

```
docling_pkg      78 MB    81 documents   4,255 chunks   ids 1–82 / 1–4,256
docling_dr       59 MB   132 documents   3,195 chunks   ids 1–140 / 1–3,236
docling_fitgap  8.5 MB   11 runs, 25 entries, 2 reviews
docling_rollout 8.6 MB   10 runs, 0 decisions
docling_session 8.9 MB   0 sessions, 0 files (schema-per-session; empty right now)
docling         does not exist
```

`DATABASE_URL` points at `docling`, which has never been created. `base_url()` is a
naming root, nothing more. That is convenient: the merge target is a free name.

Preconditions for a clean merge, all checked and all passing today:

- No `source` path appears in both databases. → `UNIQUE(source)` can be enforced globally.
- No file name appears in both databases. → nothing in the UI collapses on the way in.
- No title appears in both databases.
- No duplicate names *within* either database.
- All 213 documents live under three folders: `solvay-spark/pkg/markdown` (81),
  `solvay-spark/dr/markdown` (131), `knowledge_base` (1, filed DR).

Document and chunk ids **do** collide across the two databases (both start at 1). That
is the one thing the migration has to deal with, and §8 deals with it.

---

## 3. The shape of the change

```
                        before                                   after

  DATABASE_URL ──► docling            (empty, naming root)  ──► docling
                    ├── docling_pkg   rag_documents/chunks       ├── rag_documents   (category column)
                    ├── docling_dr    rag_documents/chunks       ├── rag_chunks      (category column)
                    ├── docling_<new> created on first write     ├── rag_categories  (the registry)
                    ├── docling_fitgap  fitgap_*                 ├── fitgap_*
                    ├── docling_rollout rollout_*                └── rollout_*
                    └── docling_session upload_*  + u_<sid>  ──► docling_session     (UNCHANGED)
                                                                  upload_*  + u_<sid>
```

Three decisions are folded into that picture, and each can be taken separately:

**(a) The corpus merges.** This is the whole point. Not optional.

**(b) The run stores merge too.** `fitgap_*` and `rollout_*` move into `docling`. They
are five small tables and 21 rows of runs. Doing this is what lets `database_url()`,
`ensure_database()` and the whole `RAG_DATABASE_URL_*` mechanism be deleted rather than
kept alive for three reserved codes. If you would rather not touch the run stores,
say so — the corpus merge works either way, but then `rag.py` keeps a reduced
`database_url()` for `FITGAP`/`ROLLOUT`/`SESSION` and the cleanup in §7 is smaller.

**(c) The session store does not merge, ever.** `docling_session` stays a separate
database with a schema per upload session. That separation is the guarantee the Copilot
and the Rollout Agent make to an analyst who drops a draft in: an uploaded document
cannot be reached by a corpus search, because it is not in the corpus database at all.
Merging it would turn a structural guarantee into a `WHERE` clause. Don't.

A consequence worth stating: today, `RESERVED_CODES` exists to stop `docling_session`
being swept up as a category by database-name discovery. After the merge there is no
name discovery, so `SESSION` and `UPLOAD` can never be document categories by
construction. The guarantee gets stronger and the test that asserts it (
`test_the_session_store_can_never_be_a_document_category`) gets rewritten to assert the
stronger thing.

---

## 4. Target schema

```sql
CREATE TABLE rag_documents (
    id          bigserial PRIMARY KEY,
    source      text NOT NULL UNIQUE,        -- now genuinely unique
    title       text NOT NULL,
    fingerprint text NOT NULL,
    indexed_at  timestamptz NOT NULL DEFAULT now(),
    category    text NOT NULL DEFAULT 'UNFILED'
);
CREATE INDEX rag_documents_category_idx ON rag_documents (category);

CREATE TABLE rag_chunks (
    id           bigserial PRIMARY KEY,
    document_id  bigint NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index  int NOT NULL,
    heading_path text NOT NULL,
    content      text NOT NULL,
    tokens       int NOT NULL,
    embedding    vector(1024) NOT NULL,
    category     text NOT NULL DEFAULT 'UNFILED',
    tsv          tsvector,
    UNIQUE (document_id, chunk_index)
);
CREATE INDEX rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX rag_chunks_tsv_idx       ON rag_chunks USING gin (tsv);
CREATE INDEX rag_chunks_category_idx  ON rag_chunks (category);

CREATE TABLE rag_categories (            -- unchanged, but now there is one of it
    code        text PRIMARY KEY,
    label       text NOT NULL,
    description text NOT NULL DEFAULT '',
    folder      text NOT NULL DEFAULT ''
);
```

Identical to what each shard has now, minus the duplication. **One HNSW index, no
partial indexes** (§1). `category` stays denormalised onto `rag_chunks` for the same
reason as today: both rankings query `rag_chunks` alone, and joining `rag_documents` to
reach the category would give the planner a reason to stop using the HNSW index.

One integrity addition worth taking while the table is being rebuilt. Nothing today
stops `rag_chunks.category` drifting from its document's — `_backfill_categories` repairs
the drift on every schema check, which is an admission that it happens. A composite
foreign key makes it unrepresentable:

```sql
ALTER TABLE rag_documents ADD CONSTRAINT rag_documents_id_category_key
  UNIQUE (id, category);
ALTER TABLE rag_chunks ADD CONSTRAINT rag_chunks_document_fk
  FOREIGN KEY (document_id, category) REFERENCES rag_documents (id, category)
  ON DELETE CASCADE ON UPDATE CASCADE;
```

`ON UPDATE CASCADE` is what makes re-tagging a single `UPDATE rag_documents SET category
= ...`: the chunks follow automatically. The plain `document_id` foreign key is then
redundant and comes out. Recommended, but separable from the merge — decide at review
(§14.3).

`rag_chunk_id_map` — the audit table from §8 — is the one genuinely new table.

---

## 5. What each part of the system does today, and what it does after

### Ask (RAG) — `/api/ask`, `AskPage.tsx`

*Today:* `rag.ask_events` → `shards(scope)` → one connection per database → both
rankings per database → `merge_stats` reconstructs global IDF → results merged by score.
The category chips on the page come from `/api/rag/status`, which reports one row per
category with the database it lives in and whether that database `exists`.

*After:* one connection, one vector query, one BM25 query, no `merge_stats`. The
`WHERE category = ANY(...)` filter that already exists carries the scope. The "searched
N databases" line in the trace becomes "searched N categories".

*User-visible:* the chip `PKG: 81 in docling_pkg` becomes `PKG: 81 documents`. The
`empty · docling_x` state for a category with no database becomes `empty` — after the
merge a category with nothing in it is a row in `rag_categories` with a count of zero,
which is a better thing to show than a database that was never created.

*Behavioural change to watch:* BM25 scores stop being reconstructed and start being
computed directly. They should come out the same — `merge_stats` was written to make
them the same — and the ten-question comparison in §1 confirms it, but this is the
single most likely place for a silent ranking change, so it is the first thing §10
verifies.

### Evidence Agent — `/api/evidence/ask`, `evidence/agent.py`, `EvidencePage.tsx`

*Today:* retrieval through `ftools` → `rag.search`, same shard path as Ask. Graph tools
read the in-memory graph, scoped by `ftools._graph(session)`. `evidence/independence.py`
runs its near-duplicate detection **once per database** and merges by title, and cannot
see a document duplicated across categories.

*After:* retrieval as above. `independence.load()` becomes a single pass over one
`rag_chunks` table, and cross-category duplicates become detectable for the first time.
The comment admitting the blind spot gets deleted rather than reworded.

*Source labelling:* `describe_sources` reports `{database: hits}` per call; the Evidence
page renders it as `docling_pkg: 11, docling_dr: 4`. That becomes `PKG: 11, DR: 4`,
which is what the reader wanted in the first place. The `kind: "postgres"` /
`"session"` / `"session-graph"` / `"graph"` / `"sheet"` distinction is unaffected and
still carries the thing that matters: retrieval hit Postgres, the graph did not.

### Fit-Gap Copilot — `/api/fitgap/*`, `fitgap/`

*Today:* `Session.categories` scopes `search_corpus`; `store.corpus_fingerprint`
hashes every document the run could read by walking `rag.shards(categories)`;
`store.connect()` opens `docling_fitgap`. Uploaded documents are in `docling_session`
under `u_<sid>`, reached by a different tool (`search_uploads`) with its own chunk-id
prefix (`UPLOAD:`).

*After:* `corpus_fingerprint` becomes one query with a category filter. It hashes
`fingerprint` values sorted by `source` and never touches a row id, so the id offset in
§8 cannot move it — the hash changes only if the *set of documents in scope* changes.
That is a guarantee by construction, but it is load-bearing (a changed fingerprint
silently breaks the Copilot's reproducibility claim), so §10.9 still measures it rather
than trusting the argument.

`store.connect()` points at `docling` instead of `docling_fitgap` (decision (b)).
Everything about uploads is untouched.

### Rollout Agent — `/api/rollout/*`, `rollout/`

*Today:* the same two-sided arrangement — corpus retrieval through `ftools`, attached
documents through `uploads`, `_fingerprint(categories)` over the shards,
`compare_entities` passing `categories` into `uploads.compare` so the corpus side of
the comparison is scoped to the run.

*After:* identical, minus the fan-out. `uploads.compare(..., categories=...)` already
filters the in-memory graph rather than the database, so it does not change at all.

*The thing to check:* 10 stored runs hold 155 `DR:` and 58 `PKG:` chunk citations in
their `sources` and `analysis` JSON. §8 covers what happens to them.

### Convert — `/api/docs/{id}/embed`, `ExtractPage.tsx`

*Today:* the destination picker sends `?category=PKG`; `rag.index_path` calls
`category_for(path)` then `ensure_database(code)` — **the database is created by the
first write**. The tooltip tells the user which database the file will land in.

*After:* `index_path` resolves the category and writes to the one table. No database is
created. The destination picker keeps working unchanged; only its help text changes,
from "Each category is its own database" to something about scope.

*New failure mode, and the mitigation:* today a typo'd category code creates a stray
`docling_typo` database — ugly, but visible in `rag.py categories` and in any database
listing. After the merge it creates a stray row in `rag_categories` and a document
filed nowhere useful. `check_category` already validates the *shape* of a code; the
merge should add a check that the code is either in `rag_categories` or explicitly being
created, and the UI should stop accepting free text for a destination. Small, but it is
a real regression if skipped.

### Batch Convert — `/api/batch/{id}/embed`, `BatchConvertPage.tsx`

Same as Convert, and the same picker, added in this session. One extra detail: the
endpoint streams per-file progress and reports `rag.counts()` at the end; `counts()`
currently sums `totals()` across shards. It becomes one `GROUP BY category`.

### Add to Knowledge Base — `/api/kb/*`, `AddToKnowledgeBasePage.tsx`

This is where the split has done the most damage, so it is worth being precise about
what the merge does and does not fix.

*Fixed by the merge:*
- `delete_kb_file` can stop asking "which database?". The 409 that returns
  `{matches: [{category, database}]}` when a name is ambiguous, `rag.documents_named`
  (18 lines of fan-out), and the `?category=` disambiguation parameter all exist because
  a name can identify two rows in two databases. With `UNIQUE(source)` global, a
  *path* is an identity again.
- `rag.duplicate_sources` stops walking every database.
- The count in the header stops depending on a fan-out that can partially fail.

*Not fixed by the merge, and it must not be sold as if it were:* two different files
with the same *name* at different *paths* — `knowledge_base/Commissions_pptx.md` and
`solvay-spark/pkg/markdown/Commissions_pptx.md` — remain two legitimate documents, and
`/api/kb/files` still keys its result dictionary by file name (`items[name] = ...`), so
it still collapses them into one row and still reports a count that disagrees with the
database. That is the 215-vs-214 bug, and it is a frontend/endpoint bug, not a database
one. **Fix it in the same change** by keying on `source` and showing the folder when two
rows share a name. Listed as a task in §7.

### Knowledge graph — `knowledge_graph.py`, `/api/graph/*`

**No change at all.** The graph is built from the Markdown files on disk
(`collect_files` walks `solvay-spark/<code>/markdown` and `knowledge_base`), not from
Postgres. It has never read the corpus database. `filter_by_categories` keeps doing
exactly what it does, and all three agents keep scoping their graph tools through it.

This is also the answer to the second half of the original question: **do not split the
graph.** A DR design record linking to a spec that a PKG package document defines is the
thing a graph is for; splitting it destroys the only edges worth having. Scoping a view
of one graph is the right model, and it is already built.

### Tracing — `tracing.py`, Langfuse

`ask_events` records `metadata={"databases": [...]}` on the `search-corpus` span. That
key becomes `categories`. Old traces keep the old key; nothing reads it programmatically.

---

## 6. Code inventory — every call site

Verified by grep across the repository; this is the complete list of everything outside
`rag.py` that touches the shard API.

| File | Line | Call | After |
|---|---|---|---|
| `evidence/independence.py` | 135 | `[rag.shard_connection(url) for url, _ in rag.shards()]` | one connection; drop the per-pass title resolution and the blind-spot comment |
| `fitgap/store.py` | 32 | `rag.database_url(FITGAP_DATABASE)` | `rag.base_url()` (decision (b)) |
| `fitgap/store.py` | 44 | `rag.shard_connection(rag.ensure_database(FITGAP_DATABASE))` | `rag.connection()` |
| `fitgap/store.py` | 133–134 | `for url, cats in rag.shards(categories)` in `corpus_fingerprint` | one query, `WHERE category = ANY(%s)` |
| `fitgap/tools.py` | 106 | `rag.close_shards()` | `rag.close()` |
| `fitgap/tools.py` | 701 | `rag.database_name(uploads.database_url())` | unchanged (session database) |
| `fitgap/tools.py` | 729 | `rag.database_name(rag.database_url(code))` in `describe_sources` | report the category code |
| `fitgap/tools.py` | 732 | `rag.shards(...)` to list what was searched | the requested categories, or every known one |
| `rollout/store.py` | 30, 36 | `database_url(ROLLOUT_DATABASE)`, `ensure_database` | as `fitgap/store.py` |
| `rollout/tools.py` | 352 | `rag.database_name(uploads.database_url())` | unchanged (session database) |
| `rollout/orchestrator.py` | 329 | `rag.close_shards()` | `rag.close()` |
| `rollout/orchestrator.py` | 379–380 | `for url, cats in rag.shards(...)` in `_fingerprint` | one query |
| `uploads.py` | 115–116, 126, 151 | `rag.database_url(SESSION_DATABASE)`, `database_live`, `ensure_database` | keep, backed by a small `sibling_database(name)` helper that survives the cleanup |
| `app.py` | 1210, 1736 | `rag.database_name(fg_uploads.database_url())` | unchanged (session database) |
| `app.py` | 500–570 | `delete_kb_file` ambiguity handling | simplify: `source` is an identity |
| `app.py` | 1056–1090 | `categories` / `ingest_categories` in `/api/rag/status` | drop `exists`/`database`, read the registry |
| `fitgap/test_fitgap.py` | 269–275 | `RESERVED_CODES` / `known_categories` test | rewrite to the stronger guarantee (§3c) |

`rag.py` itself: twelve functions stop existing — `shards`, `shard_connection`,
`close_shards`, `_scan_databases`, `_databases_by_convention`, `_base_holds_documents`,
`ensure_database`, `create_database`, `move_category`, `migrate`, `merge_stats`,
`_rank_shards` — and the fan-out loops inside `totals`, `documents`, `find_document`,
`documents_named`, `duplicate_sources`, `delete_document`, `clear_index`,
`reset_schema`, `chunk` and `index` each collapse to a single query. About 200 of 1,670
lines.

`database_url`, `database_exists` and `database_live` shrink to a session-database
helper. `corpus_stats` and `_scope_sql` stay — BM25 still needs corpus statistics, it
just stops needing to be told them.

CLI: `rag.py createdb`, `rag.py move` and `rag.py migrate` are removed; `rag.py retag`
loses the "then move the rows" half and becomes one `UPDATE`; `rag.py categories` stops
printing a `DATABASE` column and a "run migrate" hint.

---

## 7. Frontend and documentation

The split is asserted in UI copy and comments in thirteen files. All of it becomes wrong on the day
the migration runs, and a user reading "each category is its own database" next to a
single-database system is a support ticket.

| File | What it says |
|---|---|
| `api.ts` :41 | `CategoryInfo` doc comment — "Each one is isolated in its own Postgres database" |
| `api.ts` :50 | `configured` — "True when `RAG_DATABASE_URL_<CODE>` puts it off the naming convention" → field removed |
| `api.ts` :67, :131, :1326 | comments about "what exists to be searched" and name-uniqueness across databases |
| `AskPage.tsx` :215, :316 | `PKG: 81 in docling_pkg`, `empty · docling_x` |
| `ExtractPage.tsx` :350 | destination tooltip naming the database |
| `BatchConvertPage.tsx` :606, :646 | the comment and tooltip added this session |
| `AddToKnowledgeBasePage.tsx` :643 | destination chip showing `database` |
| `EvidencePage.tsx` :84, :401 | per-database hit counts, "separate databases" comment |
| `RolloutPage.tsx` :1380 | "databases and the attachment is in a schema of its own" — keep the second half, it is still true |
| `FitGapPage.tsx` :185, :1075 | `docling_session.u_<sid>` (keep), and a comment about the combined corpora |
| `evalQuestions.ts` :7, :20, :500 | the cross-database framing of the eval set — the questions stay valid, the rationale text changes |
| `README.md` | the categories section, `RAG_DATABASE_URL_*`, the "a category can have a database of its own" sentence |
| `rag.py` module docstring, the `--- categories ---` comment block | the design note that explains the split |
| `docs/ARCHITECTURE-CONTEXT.md`, `docs/system-diagram*` | the diagrams show per-category databases |

Also in this change, not caused by it but exposed by it: `/api/kb/files` keys by file
name (`app.py` :420) and must key by `source` (§5, Add to Knowledge Base).

The `CategoryInfo` type loses `database`, `exists` and `configured`, and keeps `code`,
`label`, `description`, `folder`, `documents`, `chunks`. `ingest_categories` and
`categories` can stay separate — the distinction becomes "registered" versus "has
something in it", which is still worth drawing.

---

## 8. Chunk ids, and what happens to 21 stored runs

Document and chunk ids collide across the two databases, so one side has to move. The
stored runs cite chunks by `CATEGORY:id`:

```
docling_fitgap.fitgap_entries    DR 29   PKG  2   UPLOAD   1
docling_fitgap.fitgap_runs       DR  6
docling_rollout.rollout_runs     DR 155  PKG 58   UPLOAD 405
                                 ───────────────
                                 DR 190  PKG 60   UPLOAD 406
```

`UPLOAD:` keys point into `docling_session`, which is not moving — 406 of the 656
mentions are unaffected. Of the rest, **moving PKG is cheaper than moving DR**: 60
mentions to deal with instead of 190.

So: **DR keeps its ids. PKG ids are offset by 10,000,000.**

`Hit.key` stays `CATEGORY:id` and stays unique, because ids are now unique across the
whole table. No format change, no frontend change, no parser change. `rag.chunk(key)`
stops deriving a database from the prefix and just looks up the id; the prefix becomes
a consistency check rather than a routing decision.

For the 60 stale PKG keys in stored runs, two options:

> **Corrected after the rehearsal.** 60 was counted by looking for chunk keys in
> `chunk_id` fields and `sources.chunks` map keys. Nine more are written into the
> model's own prose — `"Credit segment configuration (PKG:531)"` — and a structural
> rewrite walks straight past them. All three shapes are rewritten now, and text the
> run quoted from a document never is. See §15.2.

**Recommended — remap and keep the receipt.** Rewrite the 60 mentions in place inside
one transaction, and keep a permanent audit table:

```sql
CREATE TABLE rag_chunk_id_map (
    old_database text NOT NULL,
    old_id       bigint NOT NULL,
    new_id       bigint NOT NULL,
    category     text NOT NULL,
    migrated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (old_database, old_id)
);
```

so that any key from an exported run, a Langfuse trace or a screenshot taken before the
migration can still be resolved. Traces and exports are outside the database and cannot
be rewritten, which is precisely why the map has to be permanent.

**Alternative — rewrite nothing.** Leave the run records exactly as they were written,
on the principle that a run record is an audit artefact and editing it is editing
history, and resolve old keys through the map at read time. This is more honest and
slightly more code. If the Copilot's reproducibility claim is going to be shown to
anyone outside the team, take this option.

Either way the map is created and populated. The decision is only whether the 60 stored
strings are rewritten.

`rag_documents.id` is not cited anywhere outside the database (checked), so document ids
can be renumbered freely; they are offset the same way for consistency.

---

## 9. The migration itself

### 9.1 Preflight — refuse to run if any of these fails

```
1. No source path appears in more than one database.          (passes today)
2. No (document_id, chunk_index) pair is duplicated within a database.
3. Every chunk's category equals its document's category.
4. Every document has at least one chunk, or is reported.
5. Chunk counts per category match `rag.totals()`.
6. `docling` does not already contain rag_documents/rag_chunks.
7. The embedding dimension is 1024 in both databases.
8. No application process is connected (check `pg_stat_activity`).
```

Check 1 is the one that can actually fail, and it is the reason the whole plan exists.
If it ever fails, the fix is to decide which copy is canonical and delete the other
*before* migrating — not to invent a disambiguating key.

### 9.2 Back up

```bash
pg_dump -Fc -d docling_pkg     -f backup/docling_pkg.dump
pg_dump -Fc -d docling_dr      -f backup/docling_dr.dump
pg_dump -Fc -d docling_fitgap  -f backup/docling_fitgap.dump
pg_dump -Fc -d docling_rollout -f backup/docling_rollout.dump
```

~150 MB. Keep until the verification in §10 has passed and a week has gone by.

### 9.3 Copy

Nothing is re-embedded. The vectors are carried across as data, exactly as
`move_category` does today, because the model and the dimension do not change.
Re-embedding would cost about **18 minutes** at the measured 144 ms per chunk; carrying
them costs **under a second**.

The rehearsal, measured end to end on the real corpus:

```
copy 213 documents and 7,450 chunks     0.9 s
build the HNSW index                    0.6 s
build the GIN index                     0.1 s
build the category index               <0.1 s
                                      ────────
total                                   2.5 s     124 MB (vs 137 MB across two databases)
```

The script:

```python
#!/usr/bin/env python
"""Merge the category databases into one. Carries the embeddings; re-embeds nothing.

    python consolidate.py --dry-run     preflight only
    python consolidate.py               do it
"""
OFFSET = {"docling_dr": 0, "docling_pkg": 10_000_000}   # DR keeps its ids (§8)

# 1. preflight (§9.1) -- abort on any failure
# 2. CREATE DATABASE docling; CREATE EXTENSION vector
# 3. create rag_documents, rag_chunks, rag_categories, rag_chunk_id_map (§4, §8)
#    WITHOUT the HNSW/GIN indexes -- building them after the copy is much faster
# 4. for each source database, in one transaction:
#       INSERT INTO rag_documents (id, source, title, fingerprint, indexed_at, category)
#           SELECT id + offset, ... -- explicit ids
#       INSERT INTO rag_chunks (id, document_id, chunk_index, heading_path, content,
#                               tokens, embedding, category, tsv)
#           SELECT id + offset, document_id + offset, ... -- tsv carried, not recomputed
#       INSERT INTO rag_chunk_id_map SELECT ...
#    Read with a server-side cursor (itersize 500) and write with executemany;
#    embedding and tsv move as text and cast back, which round-trips exactly --
#    verified: md5 of all 4,255 PKG vectors is identical before and after.
# 5. SELECT setval on both sequences, above the highest id
# 6. copy rag_categories from both, ON CONFLICT DO NOTHING
# 7. SET maintenance_work_mem = '512MB'; build the three indexes; ANALYZE
# 8. run the verification in §10 and print the report
# 9. move fitgap_* and rollout_* (decision (b)) -- pg_dump | psql is enough,
#    these have no vectors and no id collisions
```

The full working version of this ran against a scratch copy on 22 September; the
numbers above are from that run.

### 9.4 Switch over

The code change and the data migration must land together — a `rag.py` that knows about
shards pointed at a merged `docling` will find the corpus twice (once by the base, once
by discovery) and a merged `rag.py` pointed at un-merged databases will find nothing.
So:

```
1. stop the server
2. run consolidate.py
3. deploy the merged rag.py + app.py + frontend bundle
4. start the server
5. run the verification (§10)
```

Downtime is however long step 3 takes; the data step is three seconds.

### 9.5 Do not drop the old databases

Leave `docling_pkg` and `docling_dr` in place, untouched and unreferenced, for one
release. They cost 137 MB and they are the fastest rollback there is. Drop them only
after §10 has passed and the system has been used for a week.

---

## 10. Verification — what must be true afterwards

This is the acceptance criteria, not a suggestion. Each of these is a script that
prints pass or fail.

**Data**
1. `count(*)` per category matches the pre-migration `rag.totals()` exactly:
   PKG 81 / 4,255, DR 132 / 3,195.
2. The md5 of all embeddings ordered by (category, chunk_index) is unchanged per
   category. (The rehearsal confirmed the text round-trip is exact.)
3. Every `rag_chunks.category` equals its document's.
4. `UNIQUE(source)` holds — it will, or the insert would have failed.
5. Sequence values are above the highest id in each table; index one new document and
   confirm it does not collide.

**Retrieval — the important one**
6. Run the ten eval questions in each of the four scopes (PKG, DR, PKG+DR, all) against
   the old databases and the new one, and compare the top-8 by
   (title, heading path, content hash). Expect ≥ 78/80 agreement per scope; investigate
   anything below. The baseline measured before the migration is in §1 — a *worse*
   result than that table is a failure, an equal one is a pass.
7. Recall@40 of the HNSW index against an exact sequential scan, per scope, ≥ 0.95.
   **Rebuild the index and re-measure if it is not** — §1 shows builds vary, and a
   degenerate graph is silent.
8. BM25: for one question, `corpus_stats` on the merged database returns the same
   `(n, avgdl, df)` as `merge_stats` did across the shards. This is what guarantees the
   keyword half of the ranking did not move.

**Reproducibility**
9. `fitgap.store.corpus_fingerprint(categories=...)` returns a byte-identical hash to
   the pre-migration value for each of the scopes the 11 stored runs used. Capture
   these *before* migrating. (It hashes `(source, fingerprint)` and never an id, so this
   should hold by construction — a failure means a document was lost or gained.)
10. `rollout.orchestrator._fingerprint(categories)` likewise for the 10 rollout runs.
11. Every stored run still opens in the UI, and its evidence chips render.

**Isolation**
12. A Copilot session with an attachment still cannot retrieve that attachment through
    `search_corpus`, and `get_chunk("UPLOAD:1")` on a session with no attachment still
    errors. (Existing tests; they must keep passing unchanged.)
13. A run scoped to PKG retrieves nothing filed DR — both through retrieval and through
    the graph tools.

**Per feature, by hand**
14. Ask: a question in each scope, and the source chips show the right categories.
15. Convert: upload one file to PKG and one to DR; both land, counts move by one.
16. Batch Convert: a two-file batch into DR.
17. Add to Knowledge Base: the count matches `SELECT count(*) FROM rag_documents`;
    delete one document and watch the count fall by exactly one.
18. Fit-Gap Copilot: one short run with an attachment.
19. Rollout Agent: one run, and the score tiles populate.
20. Evidence Agent: one question, and `describe_sources` names categories not databases.
21. Knowledge graph: unchanged (it never read the database) — confirm the node count is
    identical.

---

## 11. Tests

Existing suites: `test_converter.py` 22, `test_tracing.py` 7, `rollout/test_rollout.py`
48, `fitgap/test_fitgap.py` 41, `evidence/test_evidence.py` 36,
`knowledge_graph_test.py` 28 — **182**, all passing today. None of them touch a database,
which is why they will mostly survive untouched.

To change:
- `fitgap/test_fitgap.py::test_the_session_store_can_never_be_a_document_category` —
  rewrite against the registry rather than `RESERVED_CODES` and name discovery.
- Anything asserting `RAG_DATABASE_URL_*` behaviour.

To add, and these are the ones worth writing:
- `UNIQUE(source)` is enforced: indexing the same path under two categories raises.
- Re-tagging a document moves its chunks with it, in one transaction, and is visible to
  a scoped search immediately.
- A category filter on a search never returns a chunk from another category — cheap now
  that it is one table.
- `documents_named` returns one row per path, not per database.
- A deleted document takes its chunks with it and the count agrees.

---

## 12. What is given up

Three things get harder, and the plan is only honest if it says so.

1. **Dropping or rebuilding one category** is `DELETE FROM rag_documents WHERE category
   = 'DR'` over 3,195 chunks instead of `DROP DATABASE`. Slower, and it leaves dead
   tuples until a vacuum. At this size, irrelevant. At 10× this size, a partitioned
   table would give it back.
2. **`RAG_DATABASE_URL_<CODE>` can no longer put a category on another server.** Nobody
   uses it — it is commented out in `.env`. If PKG and DR will ever live in different
   places, or on hardware with different retention rules, stop here and keep the split.
3. **Database-level access control per category disappears.** If someone is ever to be
   granted DR and denied PKG, that becomes a row-level security policy on one table
   rather than a `GRANT` on a database. RLS on `rag_chunks` is perfectly workable, but
   it is not free and it is not written.

If any of those three is a real requirement rather than a hypothetical, the answer to
the original question changes and today's cost is the price of it. As far as this
repository shows, none of them is.

---

## 13. Sequence and effort

| # | Step | Depends on |
|---|---|---|
| 1 | Write `consolidate.py` with the preflight and the verification report | — |
| 2 | Capture the baselines: `totals()`, the 21 run fingerprints, the ten-question top-8 per scope, recall@40 | — |
| 3 | Rehearse against a scratch copy; require §10.1–§10.8 to pass | 1, 2 |
| 4 | Merge `rag.py`: delete the twelve functions, collapse the fan-out loops | — |
| 5 | Update the six consumers in §6 | 4 |
| 6 | Update the endpoints and the `CategoryInfo` contract | 4 |
| 7 | Update the frontend copy and the `/api/kb/files` keying bug | 6 |
| 8 | Update README, `rag.py` docstring, architecture docs and diagrams | 4 |
| 9 | Tests (§11) | 4, 5 |
| 10 | Run it: stop, migrate, deploy, start, verify (§9.4, §10) | all |
| 11 | A week later: drop `docling_pkg`, `docling_dr`, and the `RAG_DATABASE_URL_*` fallback | 10 |

Steps 1–3 are half a day. Steps 4–9 are the bulk — most of it is deletion, but §5's
per-feature detail is where the surprises live, and the frontend copy is spread across
eleven files. Call it a day and a half, with step 10 taking minutes.

---

## 14. Open decisions for review

1. **Do `fitgap_*` and `rollout_*` move into `docling` too?** (§3b) Recommended yes — it
   is what makes the cleanup complete. Say no and the plan still works, smaller.
2. **Rewrite the 60 stale PKG chunk keys, or resolve them through the map?** (§8)
   Recommended: rewrite, keep the map. Choose "resolve" if run records are audit
   artefacts that must not be edited.
3. **Take the composite `(id, category)` foreign key** that makes chunk/document
   category drift unrepresentable? (§4) Recommended yes, but it is separable.
4. **Row-level security for per-category access**, now or never? (§12.3)
5. **Keep `RAG_DATABASE_URL_*` working for one release, or delete it on the day?** The
   earlier note suggested keeping it. With the old databases left in place as the
   rollback (§9.5), there is no need for both — recommended: delete it, keep the
   databases.

---

## 15. What actually happened

The plan was approved on 22 September 2026 with all four §14 recommendations taken —
the run stores moved, the stale citations rewritten with the map kept, the composite
foreign key taken — plus the two defaults in §12.3 and §14.5: no row-level security,
and `RAG_DATABASE_URL_*` deleted on the day rather than kept for a release.

Two things in the plan were wrong, and both were caught by the rehearsal rather than
by review. One was caught by `verify` failing on a live migration it had already
passed on a scratch copy, which is the whole reason §10 exists.

### 15.1 `ef_search` had to go up, and §1 measured the wrong pair

The first rehearsal passed every check except two:

```
FAIL  §10.6 retrieval agrees, scope PKG,DR   70/80 chunks (floor 76)
FAIL  §10.7 hnsw recall@40, scope PKG,DR     0.85 (was 0.99 split)
```

§1 concluded there was no performance difference, and on wall-clock there is not. But
it compared latency, not recall, and only measured recall for a single category. For a
search spanning both, the split system had an advantage nobody had noticed and nothing
had written down:

> Two databases means two HNSW walks. Each collects `ef_search` candidates from its own
> graph and returns 40, so the merge sees **80** candidates and keeps the best 40. One
> database does one walk over a graph nearly twice the size and returns 40 in total.

Measured on the merged corpus, scope PKG+DR, against an exact scan:

| `ef_search` | recall@40 | ms/query |
|---|---|---|
| 200 (the old default) | 0.85 | 0.9 |
| 300 | 0.88 | 0.9 |
| 400 | 0.88 | 1.0 |
| **600** | **0.98** | 1.3 |
| 800 | 0.98 | 1.6 |
| 1000 (pgvector's ceiling) | 0.98 | 1.9 |

The split system measures 0.98, so 600 restores parity. `RAG_HNSW_EF_SEARCH` now
defaults to **800**, for headroom as the corpus grows — 0.7 ms on a search that takes
180. With it, the merged system beats what it replaced: **1.00 recall in every scope**,
against 0.98–1.00 split.

The filter is not the cause. The same walk with no `WHERE` clause at all recalls 0.85
at `ef_search` 200 and 0.98 at 800, so this is the graph's size against the walk's
budget and nothing to do with categories.

**What to take from this:** a migration that moves rows between indexes has to measure
recall, not latency. Latency was flat and would have signed this off.

### 15.2 Chunk ids are also written into prose

§8 counted 60 stale PKG citations by looking where a chunk id is *stored* — the value
of a `chunk_id` field, and the keys of the `sources.chunks` map. A structural rewrite
over those two shapes left nine behind:

```
"standard_options_considered": [
  "Credit Limit Utilization Reports step already in the template (PKG:3870)",
  "Credit master data utilisation display (PKG:1795)"
]
```

The model cites chunks in its own sentences too, and those are references a reader
follows. They are rewritten now. Text the run quoted *from a document* never is:
`quote`, `content`, `text`, `full_text`, `excerpt`, `snippet` and `markdown` are
excluded, because the point of a quote is that it is what the document says and the
verifier checks it character for character.

Only a token naming a chunk that actually moved is touched, so an id-shaped string
that is not one is left alone. Final tally: **2 citations in `fitgap_entries`, 58 in
`rollout_runs`** (9 of them in prose), all repointed; DR's 190 and the attachments' 406
untouched.

### 15.3 Seven citations were already dangling

`DR:856`, `857`, `858`, `861`, `862`, `869` and `870`, all in one rollout run, resolve
to nothing. They resolve to nothing in `docling_dr` too — those chunks were re-indexed
away before the migration was thought of. 67 of 74 corpus citations across all 21 runs
resolve; these seven are the difference, and they are not this migration's doing.

Worth knowing because it is the shape of a real problem: a re-index renumbers chunks,
and a stored run that cites them by id goes stale silently. `rag_chunk_id_map` only
covers the migration. Nothing covers a re-index.

### 15.4 A scope report that overstated itself

Not a migration bug, but the merge exposed it. The Evidence Agent's source chip reports
what a retrieval call was *allowed* to cover, so a narrow result is distinguishable
from a narrow scope. Its fallback was `rag.shards(...)`, which skipped databases that
did not exist — and `docling_unfiled` never existed, so `UNFILED` never appeared.

With one database there is nothing to skip, and a run scoped to PKG and DR started
reporting `searched: DR, PKG, UNFILED`. The fallback now takes the call's own filter,
then the run's scope, then the categories that actually hold documents.

### 15.5 What the live run did

```
preflight        213 documents, 7,450 chunks, every precondition holds
copy             132 + 81 documents, 3,195 + 4,255 chunks        0.9 s
indexes          foreign key, hnsw, gin, two btrees              1.0 s
run stores       fitgap 11/25/2, rollout 10/10
citations        60 repointed
                                                          total  2.4 s
```

126 MB in one database against 137 MB across two. All 27 checks in §10 passed. The
per-feature walkthrough: Ask answered a scoped question with six PKG sources in 8.4 s;
the knowledge graph returned 805 nodes and 1,646 edges, identical to before, and 241
under PKG scope; a document was inserted, found under DR, *not* found under PKG,
re-tagged to PKG with its chunk following, deleted by source, and the count returned to
exactly 213/7,450; every stored run opens; the Evidence Agent ran 14 tool calls and
labelled its sources `DR 8 · PKG 4`.

192 tests pass — the 182 that existed plus ten new ones in `test_rag.py`, each shown to
fail when the thing it guards is broken.

### 15.6 Still open

- **`docling_pkg` and `docling_dr` are still there**, untouched, 137 MB, as the
  rollback. Drop them after a week of use, along with `backup/*.dump`.
- **A re-index still invalidates stored citations** (§15.3). Out of scope here, but it
  is the same failure the id map was built for.
- **Creating a category from the UI** is now an `INSERT` into `rag_categories` rather
  than a `CREATE DATABASE`. Still not built, but no longer expensive.

---

## 16. Follow-up: the category left the UI

Asked for on 23 September 2026, the day after the merge, and done the same day.
The consolidation kept every category control exactly as it was — correctly, since
a category is still a real scope — but with one corpus behind them the choice was
not one anyone wanted to keep making. All of them came out:

| Page | What went |
|---|---|
| Ask | the multi-select, the scope line on the count chip, the "nothing indexed in X" warning |
| Knowledge Graph | the multi-select, the refetch-on-scope-change, the remembered category set |
| Evidence | the multi-select |
| Fit-Gap Copilot | the "Corpus" select and its note about a narrowed run |
| Rollout Agent | the "Template corpus" select (the reviewer field beside it stayed) |
| Convert | the destination picker and its default-picking fetch |
| Batch Convert | the destination picker and `?category=` on the embed call |
| Add to Knowledge Base | the "File under" picker |

**Nothing was removed from the backend.** `rag.search(categories=...)`,
`Session.categories`, `filter_by_categories`, `?category=` on the embed endpoints
and `--category` on the CLI all still work and are all still tested. The pages
send an empty list, which has always meant "everything". Reinstating any one
control is a UI change and nothing more.

**What this changes in practice.** A document uploaded through the browser lands
in `knowledge_base/`, which is the folder `UNFILED` claims, so new uploads are
filed `UNFILED` while the existing 213 keep PKG and DR. That was a real problem
before — an `UNFILED` document was invisible to a run scoped to a category, which
is how documents used to go quietly missing from runs — and it is not one now,
because no run is scoped. Verified: a document inserted with no category came back
`UNFILED` and was the top hit for an unscoped question.

**What stayed.** The category still appears on a retrieved chunk, on the Evidence
Agent's source chips (`DR 8 · PKG 4`), on a selected graph node, and in the run
history, where a run made while the scope could be narrowed still shows what it was
pointed at. Those are records of what happened, not controls.

Checked after: every page returns 200 on the new bundle, none of the control
strings survive in it, the graph still returns 805 nodes and 1,646 edges, an
upload round-tripped and the corpus returned to exactly 213 documents / 7,450
chunks, and all 192 tests pass.
