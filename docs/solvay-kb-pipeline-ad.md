# Solvay Knowledge Base Pipeline

How a project document becomes something you can ask questions about, from start
to finish. The diagram for this walkthrough is
[`system-workflow-simple.png`](system-workflow-simple.png). The full step-by-step
sequence is in [`system-workflow.png`](system-workflow.png).

The pipeline has three stages:

1. **Upload and convert:** turn the document into plain text (Markdown).
2. **Chunk, embed, store:** cut the text into small pieces and save them in a
   searchable database.
3. **Ask:** find the pieces that match a question and have an AI write the answer
   from them.

---

## Stage 1: Upload and convert

### Step 1: The user uploads a document

The user opens the web app and drops a file onto the **Extract** page, for example a
workshop slide deck called `Workshop.pptx`. The server saves the file in its own
folder and creates page-by-page preview images, so the user can see the original
next to the result.

**Technologies:** React web app (MUI components) · FastAPI (Python web server) ·
LibreOffice and pdftoppm (page previews)

**Accepted file types:** PowerPoint (`.pptx`), Word (`.docx`), Excel (`.xlsx`), PDF,
and images (`.png`, `.jpg`)

### Step 2: The document is converted to Markdown

The user clicks **Convert**. The converter reads the document and writes its content
out as Markdown, a simple text format that keeps headings, lists and tables.

- **Text, headings and tables** are read straight from the file.
- **Pictures inside the document** (screenshots, scanned tables, diagrams) have no
  readable text, so each one is read with OCR and put back where the picture was.
- **With the AI option on**, dense pictures such as flowcharts, tables and
  screenshots are sent to Claude, which writes them out as Markdown. For example, a
  process flow picture becomes a list of its steps.
- **Flowcharts drawn with PowerPoint shapes and arrows** are still rebuilt as Mermaid
  diagrams, with or without the AI option.
- **Spreadsheets** skip the main converter and become Markdown tables, one per sheet.

The result is saved as `output.md` and shown on screen.

**Technologies:** Docling (document conversion) · Tesseract (OCR) · OpenCV (spotting
tables and flowcharts in pictures that Claude doesn't read) · Anthropic Claude
(`claude-opus-5`) for reading dense pictures when the AI option is on (OpenAI GPT or
local Qwen3-VL can be picked instead)

---

## Stage 2: Chunk, embed, store

### Step 3: The Markdown is split into chunks

The user clicks **Embed**. The Markdown is copied into the knowledge base folder and
cut into **chunks**, small sections of about 500 tokens (roughly 350 words, never
more than 1,000 tokens).

The cuts follow the document's structure rather than a fixed length:

- A new heading starts a new chunk, so a chunk is usually one slide, one sheet or
  one section.
- Sections that are too small (like a slide title on its own) are joined to the next
  one.
- Large tables are split between rows, and each piece repeats the header row.
- Every chunk remembers the document title and the headings it sits under, so a
  lone table row still makes sense out of context.

If the same file was already stored with the same settings, the rest of this stage
is skipped.

**Technologies:** Python (`md_chunker.py`, the project's own chunking logic)

### Step 4: Each chunk is turned into a vector (embedding)

Each chunk, with its title and headings in front, is sent to an embedding model.
The model returns a **vector**: a list of 1,536 numbers that represents what the
chunk means. Chunks with similar meaning get similar vectors, which is what makes
search by meaning possible later.

**Technologies:** Cohere Embed (`embed-v4.0` model, over the internet with an API key)

### Step 5: Chunks and vectors are stored in the database

Each chunk's text, headings and vector are saved to PostgreSQL. Each chunk is
indexed two ways:

- a **vector index**, to find chunks close in *meaning* to a question, and
- a **full-text (keyword) index**, to find chunks containing the *exact words* of a
  question.

The document is now part of the knowledge base.

**Technologies:** PostgreSQL · pgvector extension (HNSW index for fast similarity
search) · PostgreSQL full-text search (GIN index)

---

## Stage 3: Ask

### Step 6: The user asks a question

On the **Ask** page the user types a question, for example *"Who validated
7.1.12.3?"*. The browser keeps a connection open so the answer can appear word by
word as it is written.

**Technologies:** React web app · FastAPI · Server-Sent Events (live streaming to
the browser)

### Step 7: The question is turned into a vector

The question is sent to the same embedding model used for the chunks, so the
question and the chunks can be compared.

**Technologies:** Cohere Embed (`embed-v4.0`)

### Step 8: The database finds the most relevant chunks

Two searches run against the same table:

- **Vector search** returns the 40 chunks closest in meaning to the question.
- **Keyword search** returns the 40 chunks that best match the question's words,
  scored with BM25. This catches exact codes like `7.1.12.3` or `M-090-030`, which a
  meaning-based search tends to miss.

The two result lists are merged into one ranking with **reciprocal rank fusion**,
which favours chunks both searches agree on. The best **8 chunks** (the "top-k")
are kept.

**Technologies:** PostgreSQL + pgvector (cosine similarity) · PostgreSQL full-text
search with BM25 scoring · reciprocal rank fusion (Python, `rag.py`)

### Step 9: The AI writes an answer from those chunks

The 8 chunks are sent to Claude as numbered excerpts, together with the question.
Claude is told to:

- answer **only** from the excerpts,
- cite the excerpts it used, like `[2]` or `[1][4]`,
- say plainly when the excerpts don't contain the answer, instead of guessing, and
- mention when an answer relies on text read by OCR, which can contain mistakes.

Claude never searches the database itself. It only sees the 8 chunks it was given.

**Technologies:** Anthropic Claude (`claude-opus-5`, over the internet with an API key)

### Step 10: The answer streams back to the user

Claude's answer is sent to the browser piece by piece as it is written. The user
sees the answer with its `[n]` citations and a **sources** panel listing each chunk
it came from: the document, the section, and how each search ranked it.

**Technologies:** FastAPI · Server-Sent Events · React web app

---

## Summary

| Step | What happens | Technologies |
|---|---|---|
| 1 | Upload the document | React, FastAPI, LibreOffice, pdftoppm |
| 2 | Convert it to Markdown | Docling, Tesseract, OpenCV, Claude for dense pictures (optional; GPT or Qwen3-VL also available) |
| 3 | Split the Markdown into chunks | Python (`md_chunker.py`) |
| 4 | Turn each chunk into a vector | Cohere Embed `embed-v4.0` |
| 5 | Store chunks and vectors | PostgreSQL, pgvector, full-text search |
| 6 | User asks a question | React, FastAPI, Server-Sent Events |
| 7 | Turn the question into a vector | Cohere Embed `embed-v4.0` |
| 8 | Find the top 8 chunks | pgvector, BM25 keyword search, reciprocal rank fusion |
| 9 | Write the answer from those chunks | Anthropic Claude `claude-opus-5` |
| 10 | Stream the answer back with sources | FastAPI, Server-Sent Events, React |

**What leaves the machine:** the chunk text (when embedding) and the question go to
Cohere, and the question plus the 8 chunks go to Anthropic. If a cloud vision model
is used in Step 2, pictures from the document go to Anthropic (or OpenAI) too.
Everything else, including the database, runs locally.
