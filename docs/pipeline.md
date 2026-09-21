# Processing pipeline

From an uploaded document to a cited answer: convert to Markdown, chunk and
embed it into pgvector, then answer questions from the top-k retrieved chunks.
The same Markdown is also read by a second, independent engine that answers by
**graph traversal** instead of retrieval — see [Knowledge graph](#knowledge-graph) below.

```mermaid
flowchart TD
    User([User])

    subgraph S1["1 · Upload — POST /api/upload"]
        Upload["Save to workdir/&lt;doc_id&gt;/source.&lt;ext&gt;<br/>+ name.txt"]
        Preview["preview.py<br/>LibreOffice → PDF → pdftoppm PNGs"]
        Upload -.-> Preview
    end

    subgraph S2["2 · Convert to Markdown — POST /api/convert/#123;doc_id#125; (converter.py)"]
        Route{File type?}
        XLSX["xlsx_tables.py<br/>workbook → Markdown tables"]
        IMG["Standalone PNG / JPEG<br/>normalise → read as one image"]
        Docling["Docling DocumentConverter<br/>export_to_markdown()"]
        Flows["pptx_flow.py<br/>connector shapes → Mermaid<br/>(PPTX only)"]
        Media["Extract embedded media<br/>(PDF: render pages at 150 DPI)"]
        Reader["_ImageReader per picture<br/>Tesseract OCR · table_cv · flow_cv<br/>optional VLM: Qwen3-VL / GPT / Claude"]
        Splice["Splice text into &lt;!-- image --&gt;<br/>placeholders + append Process flows"]
        MD[("output.md")]

        Route -- ".xlsx / .xlsm" --> XLSX
        Route -- ".png / .jpg" --> IMG
        Route -- ".pptx / .docx / .pdf" --> Docling
        Docling --> Flows
        Docling --> Media --> Reader --> Splice
        Flows --> Splice
        IMG --> Reader
        XLSX --> MD
        Splice --> MD
    end

    subgraph S3["3 · Embed &amp; store — POST /api/docs/#123;doc_id#125;/embed"]
        KB["Copy to knowledge_base/&lt;name&gt;_&lt;ext&gt;.md"]
        FP{"SHA-256 fingerprint<br/>(text + chunk/embed settings)<br/>unchanged?"}
        Skip["Skip — no embedding call"]
        Chunk["md_chunker.py<br/>parse blocks → sections by heading<br/>join &lt;120 tok · pack to ~500 tok (max 1000)<br/>split tables by row, repeat header"]
        Ctx["Prefix title + heading path<br/>(embedding_text)"]
        EmbedDoc["Ollama bge-m3 (local, :11434)<br/>POST /api/embed<br/>1024-d, batches of 32"]
        Store["store(): replace document rows<br/>INSERT chunk · embedding · tsvector"]

        KB --> FP
        FP -- yes --> Skip
        FP -- no --> Chunk --> Ctx --> EmbedDoc --> Store
    end

    subgraph PG["PostgreSQL + pgvector"]
        Docs[("rag_documents<br/>source · title · fingerprint")]
        Chunks[("rag_chunks<br/>heading_path · content · tokens<br/>embedding vector(1024) — HNSW cosine<br/>tsv tsvector — GIN")]
        Docs --- Chunks
    end

    subgraph S4["4 · Ask — POST /api/ask (SSE stream, rag.ask_events)"]
        Q["Question + k (default 8)<br/>mode: hybrid / vector / keyword"]
        EmbedQ["Ollama bge-m3<br/>same local model as the chunks"]
        Vec["Vector search<br/>ORDER BY embedding &lt;=&gt; q<br/>top 40 by cosine"]
        KW["Keyword search<br/>BM25 over tsvector<br/>top 40 (codes like M-090-030 kept whole)"]
        Fuse["Reciprocal rank fusion<br/>score = Σ 1 / (60 + rank)<br/>keep top k"]
        Prompt["build_prompt()<br/>numbered &lt;excerpt&gt; blocks<br/>+ system: answer only from excerpts, cite [n]"]
        LLM["Claude (claude-opus-5)<br/>messages.stream"]
        Answer(["Streamed answer with [n] citations<br/>+ sources panel"])

        Q --> EmbedQ --> Vec
        Q --> KW
        Vec --> Fuse
        KW --> Fuse
        Fuse --> Prompt --> LLM --> Answer
    end

    subgraph S5["5 · Graph — POST /api/graph/query (knowledge_graph.py)"]
        GQ["Question, e.g.<br/>'How does eCommerce connect to S/4HANA?'"]
        Extract["extract_graph()<br/>regex + ontology over the SAME .md files<br/>streams · systems · BPML codes · SPARK tickets"]
        Cache[("knowledge_graph.json<br/>720 nodes · 842 edges")]
        Intent{"Intent?"}
        BFS["find_shortest_path()<br/>queue-based BFS over<br/>an undirected adjacency list"]
        Hop2["Neighbourhood + 2-hop bridge<br/>anchor → doc/system → target type"]
        Synth["generate_graph_answer()<br/>templated Markdown — no LLM call"]
        Canvas(["D3 canvas: matched subgraph glows,<br/>everything else dims to 0.12"])

        GQ --> Intent
        Extract --> Cache
        Cache --> Intent
        Intent -- "'path between X and Y'" --> BFS
        Intent -- "'specs linked to X'" --> Hop2
        BFS --> Synth
        Hop2 --> Synth
        Synth --> Canvas
    end

    User -- "upload file" --> Upload
    Upload --> Route
    MD --> KB
    Store --> Docs
    Store --> Chunks
    User -- "ask question" --> Q
    Vec <-.-> Chunks
    KW <-.-> Chunks
    Fuse -. "load_hits: content + title" .-> Chunks
    Answer --> User
    User -- "ask the graph" --> GQ
    MD -. "same corpus" .-> Extract
    KB -. "same corpus" .-> Extract
    Canvas --> User
```

## Knowledge graph

Stage 5 is not a variant of stages 3–4; it is a separate engine that happens to read
the same input. Three things are worth holding onto:

- **No embedding, no database, no model.** `knowledge_graph.py` builds its graph with
  regular expressions and a hand-written ontology (4 business streams, 6 core systems),
  caches it as JSON, and answers by walking it in memory. `generate_graph_answer()` is
  string formatting, not generation.
- **The hierarchy comes from the codes themselves.** A BPML code like `M-090-030-010`
  yields its own node plus a `subprocess_of` edge to the synthesised parent `M-090-030`.
- **Over-linking is the trade-off.** Edges are created on literal keyword presence
  (`"ECC" in content`), so any mention produces a relationship. `references_ticket`
  alone accounts for 548 of the 842 edges.

## What leaves the machine

Only two things, and only when they are switched on:

| Stage | Goes out | To |
|---|---|---|
| 2 (optional) | pictures from the document | OpenAI or Anthropic, **only** with the cloud VLM option |
| 4 | the question + the top-k excerpts | Anthropic (`claude-opus-5`) |

Embedding used to be a third: Cohere `embed-v4.0` received every chunk and every
question. Replacing it with **Ollama `bge-m3` on localhost** (1024-d instead of 1536-d)
removed that entirely. Stages 1, 3 and 5 now run without any network call.
