# System Architecture Diagram

This diagram shows Docling Studio's internal components, the direction data flows
between them, and how it reaches its most important external dependencies:
**Cohere Embed** (vectors) and **Anthropic Claude** (answers), with **PostgreSQL + pgvector**
holding the index in between. For the step-by-step processing detail see
[`pipeline.md`](pipeline.md).

## How a question reaches Claude

Claude never searches the database. `rag.py` does the retrieval itself: it embeds the
question with Cohere, runs **two** searches against the same `rag_chunks` table in
Postgres — cosine nearest-neighbour over the pgvector HNSW index, and BM25 over a
`tsvector` full-text index (so exact codes like `M-090-030` still match) — fuses the
two rankings with reciprocal rank fusion, and sends only the top-k chunks to Claude as
numbered excerpts. The answer streams back to the browser as server-sent events.
Cohere is called twice in the life of a document: once per chunk at embed time
(`search_document`) and once per question (`search_query`).

## Diagram

```mermaid
flowchart TD
    User(["User / Browser"])

    subgraph Frontend["Web UI (React SPA)"]
        Extract["Extract page<br/>upload · convert · embed"]
        Ask["Ask page<br/>question · streamed answer"]
    end

    subgraph Backend["FastAPI app.py · :8000"]
        API["API routes<br/>/api/upload · convert · embed · ask"]
        Preview["preview.py<br/>LibreOffice + pdftoppm"]
        Converter["converter.py<br/>Docling → Markdown"]
        Readers["Image readers<br/>Tesseract · table_cv · flow_cv"]
        Qwen["Qwen3-VL (local)<br/>MLX, optional"]
        Chunker["md_chunker.py<br/>heading-aware chunks"]
        RAG["rag.py<br/>index · hybrid search · answer"]
    end

    Files[("Workdir + knowledge_base/<br/>source · output.md")]
    PG[("PostgreSQL + pgvector<br/>rag_documents · rag_chunks")]

    Cohere[["Cohere Embed<br/>embed-v4.0 · 1536-d"]]
    Claude[["Anthropic Claude<br/>claude-opus-5"]]
    VLM[["GPT / Claude vision<br/>optional, via Docling VLM"]]

    User -->|HTTPS| Extract
    User -->|HTTPS| Ask
    Extract -->|"REST/JSON"| API
    Ask -->|"POST /api/ask"| API
    API -.->|"SSE stream"| Ask

    API -->|render| Preview
    API -->|convert| Converter
    Converter -->|pictures| Readers
    Readers -->|"dense images"| Qwen
    Readers -->|"HTTPS, API key"| VLM
    API -->|"write .md"| Files

    API -->|"embed_doc"| RAG
    RAG -->|"read .md"| Files
    RAG -->|chunk| Chunker
    RAG -->|"HTTPS, API key"| Cohere
    RAG -->|"SQL (psycopg)"| PG
    RAG -->|"HTTPS stream, API key"| Claude

    classDef external fill:#333,stroke:#999,color:#fff;
    class Cohere,Claude,VLM external;
```

**Reading the diagram:**

- Solid arrows = request/command direction; dashed = streamed response (SSE).
- Dark boxes = external systems this app depends on but doesn't control.
- Cylinders = local state: files on disk and the Postgres index.
