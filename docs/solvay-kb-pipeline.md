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
meaning.
*Tech: Cohere Embed*

**Step 5: Ingest.** The chunks and their vectors are ingested into the PostgreSQL
pgvector database, indexed for both meaning and exact keywords.
*Tech: PostgreSQL + pgvector*

## Part 3: Ask RAG a question

**Step 6: Ask.** You type a question, for example *"Who validated 7.1.12.3?"*

**Step 7: Search.** The question is embedded the same way, and two searches run:
- **by meaning** (vector search)
- **by exact words** (keyword search), which catches codes like `7.1.12.3`

The results are merged, and the best 8 chunks are kept
*Tech: Cohere Embed, pgvector, PostgreSQL full-text search*

**Step 8: Answer.** Claude is given only those 8 chunks and the question. It is told
to answer only from them, cite its sources like `[2]`, and say so if the answer
isn't there.
*Tech: Anthropic Claude*

**Step 9: Stream back.** The answer appears word by word, with the source chunks
listed underneath.
*Tech: FastAPI, Server-Sent Events, React*

## The one thing to remember

Claude doesn't search the documents. The pipeline finds the most relevant chunks
first, and Claude is instructed to answer only from those, with citations you can
check.
