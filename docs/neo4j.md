# Querying the knowledge graph with Cypher (Neo4j)

The knowledge graph is built into `knowledge_graph.json` by `knowledge_graph.py`.
That file stays the source of truth. A local Neo4j holds a copy of it, so the
graph can be queried with Cypher: from the **Cypher** view on the Knowledge Graph
page, from Neo4j Browser, or from any Neo4j driver.

## Start it

`./scripts/run.sh` starts the Neo4j container along with the app, when Docker or Podman is
running and `NEO4J_PASSWORD` is set in `.env`. The app then loads the graph into
Neo4j in the background. To do it by hand:

```bash
docker compose -f compose.neo4j.yml up -d        # or: podman compose ...
.venv/bin/python -m backend.graph.kg_neo4j_load                # load (skipped if already current)
.venv/bin/python -m backend.graph.kg_neo4j_load --force        # reload regardless
.venv/bin/python -m backend.graph.kg_neo4j_load --status
```

`.env` needs:

```
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<a password of your choosing>
```

The compose file reads `NEO4J_PASSWORD` from `.env` and sets it as the database's
password on first start. The ports are bound to `127.0.0.1` only. Neo4j Browser is
at <http://localhost:7474>; sign in as `neo4j` with that password.

## Keeping the copy current

A load deletes everything in the database and writes the current graph. It never
merges, so a node removed from the graph cannot linger. A `(:_GraphMeta)` node
records which build was loaded (the graph's `stats.sources` fingerprint), which is
how the Cypher view knows whether the copy is current. The copy is refreshed:

- when the app starts, if Neo4j holds an older build;
- after **Rescan** / `POST /api/graph/rebuild`, in the background;
- on demand: **Reload into Neo4j** in the Cypher view, `POST /api/graph/neo4j/sync?force=true`,
  or `kg_neo4j_load.py --force`.

A load of the full graph (11,257 nodes, 20,893 relationships) takes about 3 seconds.

## The model

```
(:Document)-[:BELONGS_TO]->(:Stream)
(:Document)-[:MENTIONS_SYSTEM]->(:System)
(:Document)-[:SPECIFIES_PROCESS]->(:Process)
(:Document)-[:IMPLEMENTS_TICKET|REFERENCES_TICKET]->(:Spec)
(:Process)-[:SUBPROCESS_OF]->(:Process)
(:Document)-[:HAS_CHUNK]->(:Chunk)
(:Chunk)-[:MENTIONS {count}]->(:System|:Process|:Stream|:Spec)
```

- Every node keeps the graph's own `id` (`system:SOVOS`, `chunk:PKG:10003882`), so a
  result can be matched to the canvas, the agents' tool calls and the Traceability tab.
- Uniqueness constraints: `id` on every label, plus `code` (Stream, System, Process),
  `filename` (Document), `ticket` (Spec) and `chunk_key` (Chunk).
- Relationships out of a document carry `method`, `mentions`, `chunk_count` and
  `chunks`; `MENTIONS` carries `count`.
- `System.kind` is `sap`, `legacy_erp`, `crm`, `middleware`, `sap_ui`, `portal` or
  `third_party`.
- Degree is not stored. Ask Neo4j: `RETURN COUNT { (n)--() }`.

See [knowledge-graph-entity-relationships.md](knowledge-graph-entity-relationships.md)
for how each relationship is extracted.

## Examples

```cypher
// Documents naming SOVOS and SAP CPI, and the passages naming SOVOS
MATCH (d:Document)-[:MENTIONS_SYSTEM]->(:System {code: 'SOVOS'}),
      (d)-[:MENTIONS_SYSTEM]->(:System {code: 'CPI'}),
      (d)-[:HAS_CHUNK]->(c:Chunk)-[:MENTIONS]->(:System {code: 'SOVOS'})
RETURN d.filename AS document, collect(c.chunk_key) AS chunks
```

```cypher
// A process step up to its value chain
MATCH p = (:Process {code: '4.10.2.2'})-[:SUBPROCESS_OF*]->(top:Process)
WHERE NOT (top)-[:SUBPROCESS_OF]->()
RETURN [n IN nodes(p) | n.code + ' ' + n.description] AS chain
```

The Cypher view lists nine examples. `test_neo4j.py` runs each one against the
loaded graph, so none can silently stop returning rows after a model change.

## Asking in plain English

The Cypher view has a box for a question in English. **Claude Opus 5** writes the
query (`kg_nl2cypher.py`, `POST /api/graph/cypher/generate`). The query lands in the
editor with a one-line explanation and any assumptions made, and runs when **Run it
when ready** is on. The generated query is never hidden: what runs is what is in the
editor.

- **Grounded.** The prompt carries the graph's real schema and the values a query filters
  on (system codes, categories, relationship methods), built from the same batches Neo4j
  was loaded from, plus the nine example queries. It is cached, so after the first
  question it is served from Claude's prompt cache.
- **Checked before it runs.** Neo4j plans the query with `EXPLAIN` in a READ transaction.
  A syntax error, or a plan that would write, goes back to the model with the database's
  own message, and it corrects the query. It makes at most three attempts, and an attempt
  that still fails is shown with the reason rather than run.
- **Honest about the graph.** The graph holds which documents and passages mention what,
  not the text itself. A question about what a document *says* gets the passages to read
  (chunk keys), and the explanation says why. A question the graph cannot answer at all
  gets an explanation and no query.
- **Model and settings.** Structured output, adaptive thinking at `medium` effort, and
  server-side refusal fallbacks (`fallbacks: "default"`). Change them with `CYPHER_MODEL`
  and `CYPHER_EFFORT` in `.env`. Each generation is traced in Langfuse as
  `graph-nl-to-cypher` when tracing is on. A typical question takes 5–10 s.

The tests for it replace Claude with a stub, so they make no model calls, and use the
real Neo4j check.

## Safety

Queries from the app (`POST /api/graph/cypher`) are read-only, and **Neo4j enforces
that**, not a keyword filter. Each query runs in a READ transaction, where `CREATE`,
`SET`, `DELETE` and `MERGE` are refused with `Neo.ClientError.Statement.AccessMode`.
At most 1,000 rows are returned, and a query is cancelled after 20 seconds.
Parameters (`$name`) are supported; pass them rather than formatting values into
the query.

Neo4j Browser signs in as the admin user and is not read-only. It is for exploring a
local copy that the next load replaces entirely.

## Tests

```bash
.venv/bin/python backend/tests/test_neo4j.py
```

The first four tests check the write batches and need nothing running. The rest
query the live database: the counts match the graph, ids survive, writes are
refused, rows are capped, every example returns rows, and the endpoint's errors
are reported. They are **skipped**, with the reason printed, when Neo4j is not
running or holds an older build. None of them writes to Neo4j.
