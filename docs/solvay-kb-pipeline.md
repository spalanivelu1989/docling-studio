# Solvay Knowledge Base Pipeline: Walkthrough

## Part 1: Upload the document and convert it to markdown format

**Step 1: Upload.** You drop a document (PowerPoint, Word, Excel, PDF or image) into the web app.
*Tech: React, FastAPI*

**Step 2: Convert to Markdown.** The document is turned into Markdown, mostly by Docling
(Excel sheets and standalone images take their own path). Text in pictures is read
with OCR. With the AI option on, dense pictures such as flowcharts, tables and
screenshots are sent to Claude, which writes them out as Markdown (for example, a
process flow becomes a list of its steps).
*Tech: Docling, Tesseract, Claude AI, GPT*

## Part 2: RAG Ingestion

The Markdown file from Part 1 is embedded and ingested into the pgvector database.

**Step 3: Chunk.** The Markdown is cut into small sections of about 500 tokens along its
headings, so each chunk is roughly one slide, sheet or section.
*Tech: Python*

**Step 4: Embed.** Each chunk becomes a vector, a list of numbers that captures its
meaning. This runs on your own machine, so the text never leaves it.
*Tech: Ollama running the bge-m3 model (1,024 numbers per chunk)*

**Step 5: Ingest.** The chunks and their vectors are ingested into the PostgreSQL
pgvector database, indexed for both meaning and exact keywords.
*Tech: PostgreSQL + pgvector*

## Part 3: Ask RAG a question

**Step 6: Ask.** You type a question, for example *"Who validated 7.1.12.3?"*

**Step 7: Search.** The question is embedded the same way, and two searches run:
- **by meaning** (vector search)
- **by exact words** (keyword search), which catches codes like `7.1.12.3`

The results are merged, and the best 8 chunks are kept
*Tech: Ollama bge-m3, pgvector, PostgreSQL full-text search*

**Step 8: Answer.** Claude is given only those 8 chunks and the question. It is told
to answer only from them, cite its sources like `[2]`, and say so if the answer
isn't there.
*Tech: Anthropic Claude*

**Step 9: Stream back.** The answer appears word by word, with the source chunks
listed underneath.
*Tech: FastAPI, Server-Sent Events, React*

## Part 4: Ask the knowledge graph instead

Some questions aren't about what a document *says* but about how things *connect* —
*"How does eCommerce reach S/4HANA?"*, *"Which specs touch Salesforce?"*. Those are
answered by a second, completely separate engine reading the **same** Markdown files.

**Step 10: Build the graph.** The same `.md` files are scanned with pattern matching for
the four business streams (L2C, I2D, R2R, P2P), the six core systems (S/4HANA, ECC,
Salesforce, SOVOS, Fiori, eCommerce), every BPML process code and every SPARK ticket.
That produces a graph of **720 entities joined by 842 relationships**, saved to a file
so it doesn't have to be rebuilt each time.
*Tech: Python regular expressions, no AI and no database*

**Step 11: Traverse it.** Your question is matched to entities in the graph, and the
engine walks it: shortest path between two systems, or a two-step expansion out to the
specs and processes attached to them.
*Tech: breadth-first search over an in-memory graph*

**Step 12: Show the answer.** The result is written up from the graph itself — the path
hop by hop, the systems involved, the tickets and the source documents — and the matching
part of the graph lights up on screen while everything else fades.
*Tech: Python, D3 force-directed canvas*

## The two things to remember

1. **Claude doesn't search the documents.** The pipeline finds the most relevant chunks
   first, and Claude is instructed to answer only from those, with citations you can
   check.
2. **The graph doesn't use AI at all.** Its answers are assembled from the graph
   structure, so they are always traceable back to a document — but they are also only
   as good as the patterns used to build it.
