# System Architecture Diagram

This diagram shows Docling Studio's internal components, the direction data flows
between them, and how it reaches its external dependencies. **PostgreSQL + pgvector**
holds the retrieval index, **Ollama** embeds locally, and **Anthropic Claude** writes
the answers. For the step-by-step processing detail see [`pipeline.md`](pipeline.md).

## Two engines over one corpus

The converted Markdown in `solvay-spark/pkg/markdown/` and `knowledge_base/` is the
substrate both answering engines read, and that is the single most important thing to
understand about this architecture:

- **`rag.py`** chunks and embeds the files into Postgres, then answers a question by
  retrieving from that index and handing the top chunks to Claude.
- **`knowledge_graph.py`** reads the *same files* with regex and an ontology, builds a
  720-node / 842-edge graph, and answers by **traversing it** — BFS shortest path and
  2-hop bridge expansion. **No LLM and no database are involved in this path**; its
  answers are templated from the graph itself.

They are independent: nothing is shared but the files on disk.

Claude never searches anything. `rag.py` does the retrieval itself: it embeds the
question with **Ollama `bge-m3` on localhost** (1024-d — this replaced Cohere
`embed-v4.0`, so chunk text no longer leaves the machine to be embedded), runs **two**
searches against the same `rag_chunks` table — cosine nearest-neighbour over the
pgvector HNSW index, and BM25 over a `tsvector` full-text index, so exact codes like
`M-090-030` still match — fuses the two rankings with reciprocal rank fusion, and sends
only the top-k chunks to Claude as numbered excerpts. The answer streams back to the
browser as server-sent events.

## Diagram

```mermaid
flowchart TD
    User(["User / Browser"])

    subgraph Frontend["Web UI (React SPA)"]
        Extract["Extract page<br/>upload · convert · embed"]
        Ask["Ask page<br/>question · streamed answer"]
        GraphUI["Graph page<br/>D3 force canvas"]
    end

    subgraph Backend["FastAPI app.py · :8000"]
        API["API routes<br/>/api/upload · convert · embed<br/>/api/ask · /api/graph/*"]
        Preview["preview.py<br/>LibreOffice + pdftoppm"]
        Converter["converter.py<br/>Docling → Markdown"]
        Readers["Image readers<br/>Tesseract · table_cv · flow_cv"]
        Qwen["Qwen3-VL (local)<br/>MLX, optional"]
        Chunker["md_chunker.py<br/>heading-aware chunks"]
        RAG["rag.py<br/>index · hybrid search · answer"]
        KG["knowledge_graph.py<br/>extract · BFS · 2-hop"]
    end

    Files[("Markdown corpus<br/>pkg/markdown · knowledge_base")]
    PG[("PostgreSQL + pgvector<br/>rag_documents · rag_chunks")]
    KGCache[("knowledge_graph.json<br/>720 nodes · 842 edges")]

    Ollama["Ollama bge-m3<br/>local daemon · :11434 · 1024-d"]

    Claude[["Anthropic Claude<br/>claude-opus-5"]]
    VLM[["GPT / Claude vision<br/>optional, via Docling VLM"]]

    User -->|HTTPS| Extract
    User -->|HTTPS| Ask
    User -->|HTTPS| GraphUI
    Extract -->|"REST/JSON"| API
    Ask -->|"POST /api/ask"| API
    API -.->|"SSE stream"| Ask
    GraphUI -->|"POST /api/graph/query"| API

    API -->|render| Preview
    API -->|convert| Converter
    Converter -->|pictures| Readers
    Readers -->|"dense images"| Qwen
    Readers -->|"HTTPS, API key"| VLM
    API -->|"write .md"| Files

    API -->|"embed_doc · ask_events"| RAG
    RAG -->|"read .md"| Files
    RAG -->|chunk| Chunker
    RAG -->|"HTTP, localhost"| Ollama
    RAG -->|"SQL (psycopg)"| PG
    RAG -->|"HTTPS stream, API key"| Claude

    API -->|"query_graph"| KG
    KG -->|"read .md, regex"| Files
    KG -->|"cache · load"| KGCache

    classDef external fill:#333,stroke:#999,color:#fff;
    class Claude,VLM external;
```

**Reading the diagram:**

- Solid arrows = request/command direction; dashed = streamed response (SSE).
- Dark boxes = external systems this app depends on but doesn't control. They are also
  the only things data leaves the machine for. **Ollama is deliberately not one of
  them** — embedding moved on-machine when Cohere was replaced by `bge-m3`.
- Cylinders = local state: the Markdown corpus, the Postgres index, and the cached graph.
- `rag.py` and `knowledge_graph.py` never call each other. They meet only at `Files`.
