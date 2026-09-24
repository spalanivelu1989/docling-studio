"""Local web UI for the Docling extraction pipeline.

Split-screen: the original document rendered page-by-page on the left, the
extracted Markdown on the right. Intended to run on localhost for a single
user, so there is no auth, no upload cap and no sandboxing of the parsers --
do not expose this to a network without adding them.

    uvicorn app:app --reload --port 8000

Two pages: `/` converts documents to Markdown, `/ask` answers questions from
the indexed Markdown (rag.py).
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import queue
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, HTTPException, Query, UploadFile
from fastapi.responses import (FileResponse, HTMLResponse, Response,
                               StreamingResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import ask_store
import knowledge_graph
import preview
import rag
import tracing
import vlm_api
from converter import VLM_PROVIDERS, convert

BASE = Path(__file__).parent
WORKDIR = BASE / ".workdir"
STATIC = BASE / "static"
# The React front end (frontend/), built by `npm run build`.
DIST = STATIC / "dist"
# Markdown added to the vector index from this UI. Kept outside .workdir so the
# index still points at a real file after an upload is cleared, and so
# `rag.py index knowledge_base` can rebuild it.
KNOWLEDGE_BASE = BASE / "knowledge_base"
# Docling handles more than these, but these are the formats this pipeline has
# actually been exercised against.
# What the pipeline will take in. Both halves have to agree: the preview pane
# renders it through LibreOffice (see preview._readable for the two that need a
# stand-in first) and converter.py turns it into Markdown. Adding a suffix here
# without a converter for it produces a document that previews and then fails
# to convert, which is worse than refusing it.
#
# .xlsm was the reverse of that -- converter.py has read macro-enabled
# workbooks since spreadsheets were special-cased, but they were turned away
# here before they ever reached it.
ACCEPTED = {".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xlsm", ".xls", ".pdf",
            ".html", ".htm", ".xml", ".txt", ".csv", ".json", ".msg",
            ".eml"} | preview.IMAGE_FORMATS

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start and stop Langfuse tracing with the server.

    Eager rather than lazy so that bad credentials are a line in this log
    instead of a run that produces no trace and says nothing about why; a
    checkout with no Langfuse keys logs that tracing is off and carries on."""
    print(tracing.start())
    yield
    tracing.shutdown()
    try:
        from fitgap import memory as agent_memory

        agent_memory.close()
    except Exception:
        pass


app = FastAPI(title="Docling Extraction UI", lifespan=lifespan)

# Every heavy endpoint below is declared `def`, not `async def`, so FastAPI runs
# it in the threadpool. Conversion and LibreOffice are CPU-bound and blocking;
# under `async def` they would stall the event loop and freeze the whole UI.


def _job_dir(doc_id: str) -> Path:
    """Resolve a job directory, rejecting ids that try to escape the workdir."""
    job = (WORKDIR / doc_id).resolve()
    if not job.is_dir() or WORKDIR.resolve() not in job.parents:
        raise HTTPException(404, "Document not found")
    return job


def _source(job: Path) -> Path:
    files = [p for p in job.glob("source.*") if p.is_file()]
    if not files:
        raise HTTPException(404, "Source file missing")
    return files[0]


def _spa() -> HTMLResponse:
    page = DIST / "index.html"
    if not page.exists():
        return HTMLResponse(
            "<p>The web UI has not been built. Run <code>cd frontend &amp;&amp; npm install"
            " &amp;&amp; npm run build</code>, then reload.</p>",
            status_code=503,
        )
    # The bundle file names are content-hashed, so the browser may keep them
    # for ever -- but only if it re-reads this page, which is the one file that
    # names them. Served with no freshness information at all, a browser is
    # free to hold its own copy and keep loading the bundle that page referred
    # to, so a rebuilt front end silently does not arrive.
    return HTMLResponse(page.read_text(), headers={"Cache-Control": "no-cache"})


# One page app for both screens; it reads the path to pick Extract or Ask.
@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return _spa()


@app.get("/api/health")
def health() -> dict:
    soffice = preview.find_soffice()
    return {
        "ok": True,
        "preview_available": preview.available(),
        "soffice": soffice,
        "pdftoppm": preview.find_pdftoppm(),
    }


@app.post("/api/upload")
def upload(file: UploadFile) -> dict:
    name = Path(file.filename or "document").name
    suffix = Path(name).suffix.lower()
    if suffix not in ACCEPTED:
        raise HTTPException(
            400, f"Unsupported format '{suffix}'. Expected one of {sorted(ACCEPTED)}."
        )

    doc_id = uuid.uuid4().hex[:12]
    job = WORKDIR / doc_id
    job.mkdir(parents=True, exist_ok=True)
    src = job / f"source{suffix}"
    with open(src, "wb") as out:
        shutil.copyfileobj(file.file, out)

    (job / "name.txt").write_text(name)

    # A failed preview should not block extraction -- the Markdown side is the
    # point, and the user can still convert a document we cannot render.
    pages, warning = 0, None
    try:
        pages = preview.render(src, job / "preview")
    except Exception as exc:
        warning = str(exc)

    return {
        "id": doc_id,
        "filename": name,
        "format": suffix.lstrip("."),
        "size": src.stat().st_size,
        "pages": pages,
        "warning": warning,
    }


@app.post("/api/convert/{doc_id}")
def convert_doc(doc_id: str, vlm: bool = False, provider: str = "qwen") -> dict:
    if provider not in VLM_PROVIDERS:
        raise HTTPException(400, f"Unknown vision provider '{provider}'.")
    job = _job_dir(doc_id)
    src = _source(job)
    try:
        result = convert(
            src,
            media_dir=job / "media",
            use_vlm=vlm,
            vlm_provider=provider,
            # The stored file is source.<ext>; use the name the user uploaded.
            title=Path((job / "name.txt").read_text()).stem,
        )
    except Exception as exc:
        raise HTTPException(500, f"Conversion failed: {exc}") from exc

    (job / "output.md").write_text(result.markdown)
    notice = None
    if vlm and provider != "qwen" and not vlm_api.available(provider):
        notice = f"{vlm_api.PROVIDERS[provider].key_env} is not set on the server, so images were read without the vision model"
    return {
        "markdown": result.markdown,
        "vlm_notice": notice,
        "pages": result.pages,
        "unit": result.unit,
        "pictures": result.pictures,
        "skipped_images": result.skipped_images,
        "vlm_images": result.vlm_images,
        "flows": result.flows,
        "flow_images": result.flow_images,
        "table_images": result.table_images,
        "cv_flow_images": result.cv_flow_images,
        "elapsed": round(result.elapsed, 2),
        "ocr": [
            {
                "page": b.page,
                "image": b.image,
                "confidence": round(b.confidence, 1),
                "chars": b.chars,
            }
            for b in result.ocr_blocks
        ],
    }


def _display_path(path: str) -> str:
    try:
        return str(Path(path).relative_to(BASE))
    except ValueError:
        return path


@app.post("/api/docs/{doc_id}/embed")
def embed_doc(doc_id: str, category: str | None = None) -> dict:
    """Add the converted Markdown to the vector index used by the Ask page.

    The file is copied to knowledge_base/<name>_<ext>.md (the same naming as
    folder_to_md.py), so embedding the same upload again replaces its chunks,
    and an unchanged file costs no embedding call."""
    job = _job_dir(doc_id)
    md = job / "output.md"
    if not md.exists():
        raise HTTPException(409, "Convert the document first")
    name = Path((job / "name.txt").read_text())
    KNOWLEDGE_BASE.mkdir(exist_ok=True)
    dest = KNOWLEDGE_BASE / f"{name.stem}{name.suffix.lower().replace('.', '_')}.md"
    text = md.read_text()
    # A category chosen here is a decision, and it has to survive on disk. The
    # graph builds from Markdown and never reads the database, and `rag.py
    # index` re-derives the category from the file -- so a choice kept only on
    # the row shows up as a disagreement and is silently reset by the next
    # index. Front matter is stripped before chunking and sits outside the
    # fingerprint, so recording it costs nothing.
    if category:
        text = rag.declare_category(text, category)
    dest.write_text(text)

    started = time.perf_counter()
    try:
        # index_path picks the database the file's category belongs to.
        result = rag.index_path(dest, category=category)
        # The same document indexed from somewhere else (e.g. by
        # `rag.py index solvay-spark/pkg/markdown`) would be retrieved twice.
        result["duplicates"] = [
            _display_path(src) for src in rag.duplicate_sources(result["title"], str(dest.resolve()))
        ]
        result["documents"], result["total_chunks"] = rag.counts()
    except SystemExit as exc:  # rag.py exits with a message when a setting is missing
        raise HTTPException(400, str(exc)) from None
    except Exception as exc:
        raise HTTPException(500, f"Embedding failed: {exc}") from exc
    result["seconds"] = round(time.perf_counter() - started, 1)
    result["file"] = str(dest.relative_to(BASE))
    return result


@app.get("/api/docs/{doc_id}/preview/{number}")
def preview_page(doc_id: str, number: int) -> FileResponse:
    path = preview.page_path(_job_dir(doc_id) / "preview", number)
    if not path.exists():
        raise HTTPException(404, "Page not found")
    return FileResponse(path, media_type="image/png")


@app.get("/api/docs/{doc_id}/media/{name}")
def media(doc_id: str, name: str) -> FileResponse:
    path = (_job_dir(doc_id) / "media" / Path(name).name).resolve()
    if not path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


@app.get("/api/docs/{doc_id}/download")
def download(doc_id: str) -> FileResponse:
    job = _job_dir(doc_id)
    md = job / "output.md"
    if not md.exists():
        raise HTTPException(404, "Convert the document first")
    stem = Path((job / "name.txt").read_text()).stem
    return FileResponse(md, media_type="text/markdown", filename=f"{stem}.md")


@app.delete("/api/docs/{doc_id}")
def cleanup(doc_id: str) -> dict:
    shutil.rmtree(_job_dir(doc_id), ignore_errors=True)
    return {"ok": True}


# --- question answering (rag.py) ------------------------------------------------


@app.get("/convert", response_class=HTMLResponse)
@app.get("/extract", response_class=HTMLResponse)
def convert_page() -> HTMLResponse:
    return _spa()


@app.get("/ask", response_class=HTMLResponse)
def ask_page() -> HTMLResponse:
    return _spa()


@app.get("/md-viewer", response_class=HTMLResponse)
@app.get("/viewer", response_class=HTMLResponse)
def md_viewer_page() -> HTMLResponse:
    return _spa()


@app.get("/batch", response_class=HTMLResponse)
def batch_page() -> HTMLResponse:
    return _spa()


@app.get("/coverage", response_class=HTMLResponse)
def coverage_page() -> HTMLResponse:
    return _spa()


@app.get("/review", response_class=HTMLResponse)
@app.get("/doc-md-viewer", response_class=HTMLResponse)
def review_page() -> HTMLResponse:
    return _spa()


@app.get("/about", response_class=HTMLResponse)
@app.get("/landing", response_class=HTMLResponse)
def about_page() -> HTMLResponse:
    return _spa()


@app.get("/add-kb", response_class=HTMLResponse)
@app.get("/add-to-knowledge-base", response_class=HTMLResponse)
def add_kb_page() -> HTMLResponse:
    return _spa()


@app.get("/graph", response_class=HTMLResponse)
@app.get("/knowledge-graph", response_class=HTMLResponse)
def graph_page() -> HTMLResponse:
    return _spa()


@app.get("/api/graph/data")
def get_graph_data(categories: list[str] | None = Query(default=None)) -> dict:
    """The knowledge graph, optionally narrowed to some categories.

    No categories means the whole graph, which is also what naming every
    category gives."""
    return knowledge_graph.filter_by_categories(
        knowledge_graph.extract_graph(force=False), categories
    )


@app.post("/api/graph/rebuild")
def rebuild_graph(categories: list[str] | None = Query(default=None)) -> dict:
    return knowledge_graph.filter_by_categories(
        knowledge_graph.extract_graph(force=True), categories
    )


@app.get("/api/graph/model")
def get_graph_model(categories: list[str] | None = Query(default=None)) -> dict:
    """The graph's own schema as a Neo4j Data Importer model.

    Generated from knowledge_graph.json by kg_data_importer_model.py, so the
    labels, relationship types, properties and constraints all describe what
    the extractor actually builds.

    `categories` does not change the schema -- the shape of the graph is the
    same whichever documents are in view -- but it does narrow the counts and
    the sample instances, so the numbers here agree with the graph on screen
    instead of quietly reporting the whole corpus.
    """
    import graph_model

    try:
        graph = knowledge_graph.filter_by_categories(
            knowledge_graph.extract_graph(force=False), categories
        )
        return graph_model.load_model(graph)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class GraphQueryRequest(BaseModel):
    query: str = ""
    source_id: str | None = None
    target_id: str | None = None


@app.post("/api/graph/query")
def query_graph_endpoint(req: GraphQueryRequest) -> dict:
    return knowledge_graph.query_graph(
        query=req.query,
        source_id=req.source_id,
        target_id=req.target_id,
    )


def _original_name(markdown: Path) -> str | None:
    """The file name a Markdown document was converted from.

    The converter writes <stem>_<ext>.md, so "Pricing_xlsx.md" came from
    "Pricing.xlsx". Nothing records this in the database -- rag_documents stores
    the Markdown path, because the Markdown is what was chunked and embedded --
    so the name is all there is to go on."""
    stem, _, suffix = markdown.stem.rpartition("_")
    if not stem or not suffix:
        return None
    return f"{stem}.{suffix}"


def _accepted(path: Path | None) -> Path | None:
    """`path`, but only if it is a file in a format the preview pane can open."""
    if path is not None and path.is_file() and path.suffix.lower() in ACCEPTED:
        return path
    return None


def _original_folders(markdown: Path) -> list[Path]:
    """Where an original may sit, nearest convention first.

    A bulk conversion leaves the source beside the markdown/ folder it wrote
    into: "solvay-spark/pkg/markdown/Pricing_xlsx.md" came from
    "solvay-spark/pkg/Pricing.xlsx". But knowledge_base/ is flat -- the
    Markdown sits directly in it, with no markdown/ subfolder to be above -- so
    there "the folder above" is the repo root, and nobody keeps a source
    workbook next to app.py. For a flat folder the original belongs in the same
    folder as its Markdown, so look in both.

    Costs nothing in the nested layout: a markdown/ folder holds .md files, and
    .md is not a format the preview pane is offered.
    """
    return [markdown.parent.parent, markdown.parent]


def _beside_markdown(markdown: Path) -> Path | None:
    """An original on disk near the Markdown, under either name.

    Two names are tried, and the name matters more than the folder. First the
    converter's: it writes <stem>_<ext>.md, so "Pricing_xlsx.md" came from
    "Pricing.xlsx" -- the only candidate that names its own extension. Failing
    that, the Markdown's whole stem, matched against whatever accepted
    extension is actually there.

    The second name exists because Markdown written by anything other than this
    converter keeps the original's name intact. "BKP1_CRM.md" came from
    "BKP1_CRM.pdf", and reading that trailing "_CRM" as an extension sends the
    lookup after a "BKP1.CRM" that never existed -- which is why three
    hand-converted SAP decks reported no original with their PDFs sitting in
    the folder directly above them.
    """
    folders = _original_folders(markdown)
    name = _original_name(markdown)
    if name:
        for folder in folders:
            hit = _accepted(folder / name)
            if hit is not None:
                return hit
    for folder in folders:
        if not folder.is_dir():
            continue
        # escape(): a stem may legitimately contain [ ] or ?, which glob would
        # otherwise read as a pattern and quietly match the wrong file, or
        # nothing.
        for candidate in sorted(folder.glob(f"{glob.escape(markdown.stem)}.*")):
            if candidate == markdown:
                continue
            hit = _accepted(candidate)
            if hit is not None:
                return hit
    return None


def _upload_job_holding(markdown: Path) -> Path | None:
    """An upload job still holding this document's original, if one is left.

    A document that came in through the web UI has no original beside its
    Markdown: knowledge_base/ holds the Markdown and nothing else. But the
    upload it came from is not necessarily gone -- .workdir/<id>/ keeps the
    file it was given until that upload is cleared, with its pages already
    rendered. So the second place to look for an original is the job that
    produced it, which is how a PDF added from the browser can still be
    reviewed against its own Markdown.

    Matched on the same two names _beside_markdown tries. A job whose file is
    in a format the preview pane cannot open does not end the search, because
    another job may hold the same document in one that it can.

    Best effort by design: clearing the upload really does remove the only copy
    of the original, and saying so is better than pretending otherwise.
    """
    if not WORKDIR.is_dir():
        return None
    name = (_original_name(markdown) or "").lower()
    stem = markdown.stem.lower()
    for job in sorted(WORKDIR.iterdir()):
        label = job / "name.txt"
        if not label.is_file():
            continue
        try:
            held = label.read_text().strip().lower()
        except OSError:
            continue
        if not held or (held != name and Path(held).stem != stem):
            continue
        source = _accepted(next((p for p in job.glob("source.*") if p.is_file()), None))
        if source is not None:
            return source
    return None


def _original_of(markdown: Path) -> Path | None:
    """The file a Markdown document was converted FROM, if it is still there.

    Two places, in order: beside the markdown/ folder it was indexed from --
    "solvay-spark/pkg/markdown/Pricing_xlsx.md" came from
    "solvay-spark/pkg/Pricing.xlsx" -- and failing that, the upload job that
    produced it. See _beside_markdown for the names tried, and
    _upload_job_holding for the second place.
    """
    return _beside_markdown(markdown) or _upload_job_holding(markdown)


@app.post("/api/kb/files/open")
def open_kb_original(source: str) -> dict:
    """Open an indexed document's ORIGINAL file for side-by-side review.

    The Markdown half of the review page has always come from the corpus; the
    document half had to be uploaded by hand, which meant finding the file on
    disk to compare it against its own indexed Markdown. This loads it from the
    same list, so a reviewer picks a document rather than hunting for it.

    Rendering is the expensive part -- a hundred-page PDF is not quick -- so the
    job id is derived from the path and a second open of the same document
    reuses the pages already rendered.
    """
    path = Path(source)
    if not path.is_absolute():
        path = BASE / source
    path = path.resolve()
    # The list this is called from is built from the corpus, but the parameter
    # is still a path from the browser: keep it inside the project.
    if BASE.resolve() not in path.parents:
        raise HTTPException(400, "That path is outside the project.")
    if not path.is_file():
        raise HTTPException(404, f"No such document: {source}")

    original = _original_of(path)
    if original is None:
        name = _original_name(path) or path.name
        raise HTTPException(
            404,
            {"message": f"No original found for '{name}'. It is not beside "
                        f"{path.parent.name}/, and no upload still holds it -- so either it "
                        f"was added as Markdown only, or the upload it came from was cleared."},
        )

    # When the original IS an upload job's source file, that job is already a
    # valid document id with its pages rendered -- reuse it rather than copying
    # the file next door and rendering it a second time.
    if original.parent.parent == WORKDIR and original.name.startswith("source."):
        job = original.parent
        doc_id = job.name
        pages, warning = 0, None
        try:
            pages = len(list((job / "preview").glob("page-*.png"))) or preview.render(
                original, job / "preview")
        except Exception as exc:
            warning = str(exc)
        return {
            "id": doc_id,
            "filename": (job / "name.txt").read_text().strip() or original.name,
            "format": original.suffix.lstrip(".").lower(),
            "size": original.stat().st_size,
            "pages": pages,
            "warning": warning,
            "markdown_source": str(path.relative_to(BASE.resolve()))
                               if BASE.resolve() in path.parents else str(path),
            "from_upload": True,
        }

    doc_id = "kb" + hashlib.sha256(str(original).encode()).hexdigest()[:10]
    job = WORKDIR / doc_id
    job.mkdir(parents=True, exist_ok=True)
    src = job / f"source{original.suffix.lower()}"
    if not src.exists() or src.stat().st_mtime < original.stat().st_mtime:
        shutil.copyfile(original, src)
        shutil.rmtree(job / "preview", ignore_errors=True)
    (job / "name.txt").write_text(original.name)

    pages, warning = 0, None
    try:
        rendered = preview.page_path(job / "preview", 1)
        if rendered.exists():
            pages = len(list((job / "preview").glob("page-*.png")))
        else:
            pages = preview.render(src, job / "preview")
    except Exception as exc:
        warning = str(exc)

    return {
        "id": doc_id,
        "filename": original.name,
        "format": original.suffix.lstrip(".").lower(),
        "size": original.stat().st_size,
        "pages": pages,
        "warning": warning,
        "markdown_source": str(path.relative_to(BASE.resolve())) if BASE.resolve() in path.parents else str(path),
    }


@app.get("/api/coverage")
def coverage_report(documents: bool = True) -> dict:
    """Where the file system, the corpus and the graph disagree.

    Read-only on purpose. Every gap it reports has a fix that is a decision
    rather than a repair: indexing a file changes what the agents can retrieve,
    and re-tagging one changes what a scoped run is allowed to read. So this
    says what is true and leaves the choosing to a person.
    """
    import coverage as coverage_mod

    return coverage_mod.collect(include_documents=documents)


@app.get("/api/kb/files")
def list_kb_files() -> list[dict]:
    """Every document in the knowledge base: the ones indexed in pgvector,
    whatever folder they were indexed from, plus any Markdown sitting in
    knowledge_base/ or solvay-spark/pkg/markdown/ that is not indexed yet.

    Keyed by source path, not by file name. Two documents can share a name --
    knowledge_base/X.md and solvay-spark/pkg/markdown/X.md are different files
    -- and keying by name collapsed them into one row, so the count above the
    list disagreed with the database and a delete had nothing to aim at."""
    items: dict[str, dict] = {}

    def add(key: str, item: dict) -> None:
        items.setdefault(key, item)

    # 1. The source of truth: what is indexed.
    try:
        for doc in rag.documents():
            p = Path(doc["source"])
            name = p.name
            size = 0
            for candidate in (p, KNOWLEDGE_BASE / name):
                if candidate.is_file():
                    try:
                        size = candidate.stat().st_size
                    except Exception:
                        pass
                    break

            try:
                rel_source = str(p.relative_to(BASE))
            except Exception:
                rel_source = str(p)

            indexed_at = doc["indexed_at"]
            add(str(p), {
                "name": name,
                "title": doc["title"] or p.stem,
                "source": rel_source,
                "full_path": str(p),
                "size": size,
                "category": doc["category"],
                "chunks": doc["chunks"],
                "tokens": doc["tokens"],
                "is_indexed": True,
                "indexed_at": indexed_at.isoformat() if hasattr(indexed_at, "isoformat") else str(indexed_at),
            })
    except Exception:
        pass

    # 2. Markdown on disk that nothing has indexed. A file already indexed from
    #    this exact path is already in the list; one indexed from somewhere else
    #    is a different document and gets a row of its own.
    for folder in (KNOWLEDGE_BASE, BASE / "solvay-spark" / "pkg" / "markdown"):
        if not folder.is_dir():
            continue
        for f in sorted(folder.glob("*.md")):
            if f.name.startswith((".", "~$")):
                continue
            full = str(f.resolve())
            if full in items:
                continue
            try:
                rel = str(f.resolve().relative_to(BASE))
            except Exception:
                rel = str(f)
            add(full, {
                "name": f.name,
                "title": f.stem,
                "source": rel,
                "full_path": full,
                "size": f.stat().st_size,
                "category": rag.category_for(f),
                "chunks": 0,
                "tokens": 0,
                "is_indexed": False,
                "indexed_at": None,
            })

    return sorted(items.values(), key=lambda x: (not x["is_indexed"], x["title"].lower()))


@app.get("/api/kb/files/{filename}")
def get_kb_file(filename: str, source: str | None = None) -> FileResponse:
    # 0. Check explicit source path if provided
    if source:
        try:
            cand = Path(source).resolve()
            if cand.is_file() and BASE.resolve() in cand.parents:
                return FileResponse(cand, media_type="text/markdown")
            cand_rel = (BASE / source).resolve()
            if cand_rel.is_file() and BASE.resolve() in cand_rel.parents:
                return FileResponse(cand_rel, media_type="text/markdown")
        except Exception:
            pass

    fname = Path(filename).name

    # 1. Check knowledge_base/
    target = (KNOWLEDGE_BASE / fname).resolve()
    if target.is_file() and KNOWLEDGE_BASE.resolve() in target.parents:
        return FileResponse(target, media_type="text/markdown")

    # 2. Check all registered category folders
    for meta in rag.CATEGORIES.values():
        folder = meta.get("folder")
        if folder:
            cand = (BASE / folder / fname).resolve()
            if cand.is_file() and BASE.resolve() in cand.parents:
                return FileResponse(cand, media_type="text/markdown")

    # 3. Check solvay-spark common markdown paths
    for sub in ("pkg", "dr"):
        cand = (BASE / "solvay-spark" / sub / "markdown" / fname).resolve()
        if cand.is_file() and BASE.resolve() in cand.parents:
            return FileResponse(cand, media_type="text/markdown")

    # 4. Check the indexed source path in database
    try:
        found = rag.find_document(fname)
        if not found and not fname.endswith(".md"):
            found = rag.find_document(f"{fname}.md")
        if found:
            db_path = Path(found).resolve()
            if db_path.is_file() and BASE.resolve() in db_path.parents:
                return FileResponse(db_path, media_type="text/markdown")
    except Exception:
        pass

    raise HTTPException(404, f"File '{filename}' not found")


@app.delete("/api/kb/files/{filename}")
def delete_kb_file(filename: str, category: str | None = None,
                   source: str | None = None) -> dict:
    """Remove one indexed document and the chunks that belong to it.

    A file name is not an identity: knowledge_base/X.md and
    solvay-spark/pkg/markdown/X.md are two documents. `source` says which one
    and is what the list sends; `category` narrows it when only that is known.
    Without either, an ambiguous name is refused rather than guessed at --
    deleting by name alone used to take both documents silently.

    A source path *is* an identity, which it could not be while each category
    had a database of its own and UNIQUE(source) only held inside each."""
    fname = Path(filename).name
    try:
        matches = rag.documents_named(fname)
    except Exception:
        matches = []

    if len(matches) > 1 and not category and not source:
        raise HTTPException(409, detail={
            "message": (f"{len(matches)} indexed documents are named '{fname}'. "
                        "Say which one: pass ?source=<path>."),
            "matches": [{"category": m["category"], "title": m["title"],
                         "source": m["source"]} for m in matches],
        })

    try:
        removed = rag.delete_document(fname, category=category, source=source)
    except ValueError as exc:            # an unknown category code
        raise HTTPException(400, str(exc)) from None
    except Exception as exc:
        # This used to be swallowed, and the caller was told "deleted" anyway:
        # the document stayed, the counts did not move, and the UI reported
        # success. A database that cannot be reached is a failure, and the
        # only useful thing to do with it is say so.
        raise HTTPException(500, f"Could not delete '{fname}': {exc}") from None
    deleted_db = removed > 0

    # Only once nothing indexed still points at the file. Deleting one document
    # of a name another also uses must not take the file out from under it --
    # the row would survive with no file behind it.
    target = (KNOWLEDGE_BASE / fname).resolve()
    try:
        remaining = rag.documents_named(fname)
    except Exception as exc:
        raise HTTPException(500, f"Could not delete '{fname}': {exc}") from None
    file_removed = False
    if (not remaining and target.is_file()
            and KNOWLEDGE_BASE.resolve() in target.parents):
        target.unlink(missing_ok=True)
        file_removed = True

    # Nothing was deleted anywhere. Saying "deleted" here is what made a
    # mis-addressed delete look like a stuck counter: the number was right,
    # the answer was wrong. If the name exists under a different category,
    # name them -- the list row was simply out of date.
    if not deleted_db and not file_removed:
        elsewhere = [m["category"] for m in remaining]
        if category and elsewhere:
            raise HTTPException(404, detail={
                "message": (f"No document named '{fname}' is filed under "
                            f"{category}. It is in {', '.join(sorted(set(elsewhere)))}. "
                            "Refresh the list and try again."),
                "matches": [{"category": m["category"], "title": m["title"],
                             "source": m["source"]} for m in remaining],
            })
        raise HTTPException(404, f"Nothing to delete: no document or file named '{fname}'.")

    return {"status": "deleted", "filename": filename, "deleted_from_db": deleted_db,
            "documents_deleted": removed, "category": category or "",
            "remaining": len(remaining), "file_removed": file_removed}


@app.post("/api/kb/batch-insert")
def kb_batch_insert(files: list[UploadFile], category: str | None = Form(default=None)) -> StreamingResponse:
    """Upload multiple .md files, save them to knowledge_base/, and embed them
    into the database their category belongs to.

    Uploads land in knowledge_base/ whatever they are, so the folder cannot say
    which category they belong to: without `category` they are UNFILED unless
    the file declares one in its own front matter."""
    if not files:
        raise HTTPException(400, "No files uploaded")
    if category:
        try:
            category = rag.check_category(category)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    missing = [
        name
        for name, present in (
            ("DATABASE_URL", os.environ.get("DATABASE_URL")),
        )
        if not present
    ]
    if missing:
        raise HTTPException(400, f"Cannot embed: missing {', '.join(missing)} in environment or .env")

    valid_files = []
    for f in files:
        name = Path(f.filename or "document.md").name
        if name.startswith((".", "~$")):
            continue
        suffix = Path(name).suffix.lower()
        if suffix in (".md", ".markdown", ".txt"):
            valid_files.append((name, f))

    if not valid_files:
        raise HTTPException(400, "No valid Markdown (.md, .markdown, .txt) files found in upload")

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    def events():
        started = time.perf_counter()
        KNOWLEDGE_BASE.mkdir(exist_ok=True)
        total = len(valid_files)
        succeeded = 0
        failed = 0
        total_chunks = 0
        total_tokens = 0

        try:
            for i, (name, upload_file) in enumerate(valid_files, 1):
                yield sse(
                    "progress",
                    {
                        "type": "start",
                        "index": i,
                        "total": total,
                        "filename": name,
                    },
                )

                try:
                    dest = KNOWLEDGE_BASE / name
                    content = upload_file.file.read()
                    if isinstance(content, bytes):
                        dest.write_bytes(content)
                    else:
                        dest.write_text(content, encoding="utf-8")

                    res = rag.index_path(dest, category=category)
                    succeeded += 1
                    chunks = res.get("chunks", 0)
                    tokens = res.get("tokens", 0)
                    total_chunks += chunks
                    total_tokens += tokens

                    duplicates = [
                        _display_path(src)
                        for src in rag.duplicate_sources(res["title"], str(dest.resolve()))
                    ]

                    yield sse(
                        "file_done",
                        {
                            "type": "done",
                            "index": i,
                            "total": total,
                            "filename": name,
                            "title": res["title"],
                            "status": res["status"],
                            "category": res["category"],
                            "chunks": chunks,
                            "tokens": tokens,
                            "duplicates": duplicates,
                        },
                    )
                except Exception as exc:
                    failed += 1
                    yield sse(
                        "file_error",
                        {
                            "type": "error",
                            "index": i,
                            "total": total,
                            "filename": name,
                            "error": str(exc),
                        },
                    )

            try:
                docs_count, chunks_count = rag.counts()
            except Exception:
                docs_count, chunks_count = (succeeded, total_chunks)

            yield sse(
                "complete",
                {
                    "total": total,
                    "succeeded": succeeded,
                    "failed": failed,
                    "total_chunks": total_chunks,
                    "total_tokens": total_tokens,
                    "total_documents_in_db": docs_count,
                    "total_chunks_in_db": chunks_count,
                    "seconds": round(time.perf_counter() - started, 2),
                },
            )
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream")


# --- batch conversion -----------------------------------------------------------


@app.post("/api/batch/upload")
def upload_batch(files: list[UploadFile]) -> dict:
    if not files:
        raise HTTPException(400, "No files uploaded")

    batch_id = uuid.uuid4().hex[:12]
    batch_dir = WORKDIR / "batches" / batch_id
    src_dir = batch_dir / "sources"
    src_dir.mkdir(parents=True, exist_ok=True)
    (batch_dir / "markdown").mkdir(parents=True, exist_ok=True)

    file_list = []
    for f in files:
        fname = Path(f.filename or "document").name
        if fname.startswith(("~$", ".")):
            continue
        suffix = Path(fname).suffix.lower()
        if suffix not in ACCEPTED:
            continue
        dest = src_dir / fname
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)
        file_list.append({
            "name": fname,
            "format": suffix.lstrip("."),
            "size": dest.stat().st_size,
        })

    if not file_list:
        raise HTTPException(400, f"No supported files found in upload. Supported: {sorted(ACCEPTED)}")

    return {
        "batch_id": batch_id,
        "total": len(file_list),
        "files": file_list,
    }


class BatchConvertRequest(BaseModel):
    vlm: bool = False
    provider: str = "claude"


@app.post("/api/batch/convert/{batch_id}")
def convert_batch(batch_id: str, body: BatchConvertRequest) -> StreamingResponse:
    batch_dir = (WORKDIR / "batches" / batch_id).resolve()
    if not batch_dir.is_dir() or WORKDIR.resolve() not in batch_dir.parents:
        raise HTTPException(404, "Batch not found")

    src_dir = batch_dir / "sources"
    md_dir = batch_dir / "markdown"
    md_dir.mkdir(parents=True, exist_ok=True)

    sources = sorted(
        [
            p
            for p in src_dir.iterdir()
            if p.is_file() and p.suffix.lower() in ACCEPTED and not p.name.startswith(("~$", "."))
        ]
    )
    if not sources:
        raise HTTPException(404, "No source files found in this batch")

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    def events():
        total = len(sources)
        converted_count = 0
        failed_count = 0

        for i, src in enumerate(sources, 1):
            yield sse(
                "progress",
                {
                    "type": "start",
                    "index": i,
                    "total": total,
                    "filename": src.name,
                },
            )

            suffix = src.suffix.lower()
            try:
                with tempfile.TemporaryDirectory() as media_temp:
                    result = convert(
                        src,
                        media_dir=Path(media_temp),
                        use_vlm=body.vlm,
                        vlm_provider=body.provider,
                        title=src.stem,
                    )

                if suffix in {".xlsx", ".xlsm", ".xls"}:
                    primary_engine = "openpyxl (xlsx_tables.py)"
                elif suffix == ".xml":
                    primary_engine = "xml.etree.ElementTree (xml_tables.py)"
                elif suffix in {".html", ".htm"}:
                    primary_engine = "Docling Native Engine (HTML)"
                elif suffix == ".pdf":
                    primary_engine = "Docling Native Engine (PDF)"
                elif suffix in {".docx", ".doc"}:
                    primary_engine = "Docling Native Engine (OOXML Word)"
                elif suffix in {".pptx", ".ppt"}:
                    primary_engine = "Docling Native Engine (OOXML PPT) + pptx_flow"
                else:
                    primary_engine = "PIL / Image Processor"

                tools_info = {
                    "primary_engine": primary_engine,
                    "format": suffix.lstrip("."),
                    "vlm_used": bool(body.vlm and result.vlm_images > 0),
                    "vlm_provider": body.provider if (body.vlm and result.vlm_images > 0) else None,
                    "claude_vlm_images": result.vlm_images if body.provider == "claude" else 0,
                    "vlm_images": result.vlm_images,
                    "tesseract_ocr_images": len(result.ocr_blocks),
                    "table_cv_tables": result.table_images,
                    "flowcharts": result.flows,
                    "skipped_images": result.skipped_images,
                    "total_pictures": result.pictures,
                    "pages_or_sheets": result.pages,
                    "unit": result.unit,
                    "elapsed": round(result.elapsed, 2),
                    "markdown_length": len(result.markdown),
                }

                dest = md_dir / f"{src.stem}{suffix.replace('.', '_')}.md"
                dest.write_text(result.markdown, encoding="utf-8")
                converted_count += 1

                yield sse(
                    "file_done",
                    {
                        "type": "done",
                        "index": i,
                        "total": total,
                        "filename": src.name,
                        "dest_name": dest.name,
                        "markdown": result.markdown,
                        "tools": tools_info,
                    },
                )
            except Exception as exc:
                failed_count += 1
                yield sse(
                    "file_error",
                    {
                        "type": "error",
                        "index": i,
                        "total": total,
                        "filename": src.name,
                        "error": str(exc),
                    },
                )

        yield sse(
            "batch_done",
            {
                "type": "batch_done",
                "total": total,
                "converted": converted_count,
                "failed": failed_count,
                "download_url": f"/api/batch/{batch_id}/download",
            },
        )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/batch/{batch_id}/download")
def download_batch_zip(batch_id: str) -> FileResponse:
    batch_dir = (WORKDIR / "batches" / batch_id).resolve()
    if not batch_dir.is_dir() or WORKDIR.resolve() not in batch_dir.parents:
        raise HTTPException(404, "Batch not found")

    md_dir = batch_dir / "markdown"
    if not md_dir.is_dir():
        raise HTTPException(404, "No converted files found for this batch")

    md_files = list(md_dir.glob("*.md"))
    if not md_files:
        raise HTTPException(404, "No markdown files found")

    zip_path = batch_dir / f"batch_{batch_id}_markdown.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in md_files:
            zf.write(f, arcname=f.name)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"converted_markdown_{batch_id}.zip",
    )


@app.post("/api/batch/{batch_id}/embed")
def embed_batch(batch_id: str, category: str | None = None) -> StreamingResponse:
    """Embed a converted batch. The files are copied into knowledge_base/, so
    `category` is how a batch is filed; without it they are UNFILED unless a
    file declares its own category in front matter."""
    batch_dir = (WORKDIR / "batches" / batch_id).resolve()
    if not batch_dir.is_dir() or WORKDIR.resolve() not in batch_dir.parents:
        raise HTTPException(404, "Batch not found")

    md_dir = batch_dir / "markdown"
    if not md_dir.is_dir():
        raise HTTPException(404, "No converted markdown found for this batch")

    md_files = sorted([p for p in md_dir.iterdir() if p.is_file() and p.suffix.lower() == ".md"])
    if not md_files:
        raise HTTPException(404, "No markdown files found to embed")

    missing = [
        name
        for name, present in (
            ("DATABASE_URL", os.environ.get("DATABASE_URL")),
        )
        if not present
    ]
    if missing:
        raise HTTPException(400, f"Cannot embed: missing {', '.join(missing)} in environment or .env")
    if category:
        try:
            category = rag.check_category(category)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    def events():
        started = time.perf_counter()
        KNOWLEDGE_BASE.mkdir(exist_ok=True)
        total = len(md_files)
        succeeded = 0
        failed = 0
        total_chunks = 0
        total_tokens = 0

        try:
            for i, md_file in enumerate(md_files, 1):
                yield sse(
                    "progress",
                    {
                        "type": "start",
                        "index": i,
                        "total": total,
                        "filename": md_file.name,
                    },
                )

                try:
                    dest = KNOWLEDGE_BASE / md_file.name
                    text = md_file.read_text(encoding="utf-8")
                    # Same reason as the single-document path: a category
                    # chosen for a batch has to be on disk, or the next index
                    # over knowledge_base/ files every one of them as UNFILED.
                    if category:
                        text = rag.declare_category(text, category)
                    dest.write_text(text, encoding="utf-8")

                    res = rag.index_path(dest, category=category)
                    succeeded += 1
                    chunks = res.get("chunks", 0)
                    tokens = res.get("tokens", 0)
                    total_chunks += chunks
                    total_tokens += tokens

                    duplicates = [
                        _display_path(src)
                        for src in rag.duplicate_sources(res["title"], str(dest.resolve()))
                    ]

                    yield sse(
                        "file_done",
                        {
                            "type": "done",
                            "index": i,
                            "total": total,
                            "filename": md_file.name,
                            "title": res["title"],
                            "status": res["status"],
                            "category": res["category"],
                            "chunks": chunks,
                            "tokens": tokens,
                            "duplicates": duplicates,
                        },
                    )
                except Exception as exc:
                    failed += 1
                    yield sse(
                        "file_error",
                        {
                            "type": "error",
                            "index": i,
                            "total": total,
                            "filename": md_file.name,
                            "error": str(exc),
                        },
                    )

            try:
                docs_count, chunks_count = rag.counts()
            except Exception:
                docs_count, chunks_count = (succeeded, total_chunks)

            yield sse(
                "batch_done",
                {
                    "type": "batch_done",
                    "total": total,
                    "succeeded": succeeded,
                    "failed": failed,
                    "total_chunks": total_chunks,
                    "total_tokens": total_tokens,
                    "db_documents": docs_count,
                    "db_chunks": chunks_count,
                    "seconds": round(time.perf_counter() - started, 2),
                },
            )
        except Exception as exc:
            yield sse("error", {"type": "error", "error": str(exc)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/rag/chunk/{chunk_id}")
def rag_chunk(chunk_id: str) -> dict:
    """One indexed chunk, in the shape the Ask page's sources already use.

    The Ask page never needs this: a question hands it whole Source objects.
    The Evidence Agent does -- a claim's source names a chunk and quotes a
    sentence of it, and nothing else. To open the document that sentence came
    from, the page has to turn `PKG:412` back into the passage, its heading
    and the file it was indexed from, which is exactly what this returns."""
    row = rag.chunk(chunk_id)
    if not row:
        raise HTTPException(404, f"No chunk {chunk_id}")
    return {
        "n": 0,
        "title": row["title"],
        "section": row["heading_path"],
        "content": row["content"],
        "category": row["category"],
        "score": 0,
        "similarity": None,
        "bm25": None,
        "vector_rank": None,
        "keyword_rank": None,
        "file": Path(row["source"]).name,
        "source_path": row["source"],
        "tokens": row["tokens"],
    }


@app.get("/api/rag/status")
def rag_status() -> dict:
    """What the Ask page needs to know before the first question."""
    missing = [
        name
        for name, present in (
            ("ANTHROPIC_API_KEY", os.environ.get("ANTHROPIC_API_KEY")),
            ("DATABASE_URL", os.environ.get("DATABASE_URL")),
        )
        if not present
    ]
    info = {
        "missing": missing,
        "embed_model": rag.EMBED_MODEL,
        "embed_provider": "ollama",
        "embed_dimension": rag.EMBED_DIMENSION,
        "answer_model": rag.ANSWER_MODEL,
        "default_k": rag.DEFAULT_K,
        "documents": 0,
        "chunks": 0,
        "categories": [],
        "ingest_categories": [],
        "error": None,
    }
    if "DATABASE_URL" not in missing:
        try:
            info["documents"], info["chunks"] = rag.counts()
            held = {code: (docs, chunks) for code, docs, chunks in rag.totals()}
            # What there is to search: a category with something in it. A
            # registered category holding nothing is not a place to search, and
            # listing it would offer a filter that can only return nothing.
            info["categories"] = [
                {**rag.describe(code), "documents": held[code][0], "chunks": held[code][1]}
                for code in sorted(held)
            ]
            # Where a document may be FILED, which is a different question from
            # where it may be searched. An empty category is a perfectly good
            # destination, and leaving it out is how every document added from
            # the UI ended up unfiled by default.
            info["ingest_categories"] = [
                {**rag.describe(code),
                 "documents": held.get(code, (0, 0))[0],
                 "chunks": held.get(code, (0, 0))[1]}
                for code in list(rag.CATEGORIES) + [c for c in sorted(held) if c not in rag.CATEGORIES]
            ]
        except Exception as exc:  # no tables yet, server down, bad credentials
            info["error"] = str(exc).splitlines()[0]
    return info


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=rag.DEFAULT_K, ge=1, le=20)
    mode: str = "hybrid"
    # Empty means every category, which is what the Ask page sends today.
    categories: list[str] = Field(default_factory=list)


class FitGapRun(BaseModel):
    mode: str = "A"
    scope_bpml: str = "4.0"
    country_profile: dict | None = None
    asis_dir: str | None = None
    holdout: bool = False
    max_steps: int = Field(default=6, ge=1, le=60)
    concurrency: int = Field(default=3, ge=1, le=8)
    question: str | None = None
    # Empty means every category, matching the Ask, Graph and Evidence pages.
    categories: list[str] = Field(default_factory=list)
    # The session holding documents the analyst attached to this run, if any.
    upload_session: str | None = None


class FitGapReview(BaseModel):
    reviewer: str = Field(min_length=1, max_length=120)
    verdict: str
    corrected_classification: str | None = None
    comment: str = ""


@app.post("/api/ask")
def ask(body: Question) -> StreamingResponse:
    """Run the pipeline and stream it as server-sent events: `stage` as each
    step starts and ends, `sources`, `token` while Claude writes, then `done`
    or `error`. A sync generator, so Starlette iterates it in the threadpool."""
    if body.mode not in rag.MODES:
        raise HTTPException(400, f"mode must be one of {rag.MODES}")
    try:
        categories = [rag.check_category(c) for c in body.categories]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None

    def sse(event: str, data) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    question = body.question.strip()
    run_id = f"ask_{uuid.uuid4().hex[:10]}"

    def events():
        # The history is written as the answer streams, not after it: a tab
        # closed mid-answer should still leave the question and the excerpts
        # behind. A failure to record must never cost the answer, so the
        # browser is told the run is unsaved and the pipeline runs anyway.
        conn = None
        try:
            conn = ask_store.connect()
            ask_store.create_schema(conn)
            ask_store.start_run(conn, {
                "id": run_id,
                "question": question,
                "mode": body.mode,
                "k": body.k,
                "categories": categories,
                "answer_model": rag.ANSWER_MODEL,
                "embed_model": rag.EMBED_MODEL,
                "corpus_fingerprint": _corpus_fingerprint(categories),
            })
            yield sse("run", {"id": run_id})
        except Exception as exc:
            conn = None
            yield sse("run", {"id": run_id, "not_saved": f"{type(exc).__name__}: {exc}"})

        written: list[str] = []
        terms: list[str] = []
        try:
            for event, data in rag.ask_events(question, body.k, body.mode, categories):
                if event == "stage" and data.get("terms"):
                    terms = data["terms"]
                elif event == "sources" and conn is not None:
                    _try(ask_store.save_sources, conn, run_id, data, terms)
                elif event == "token":
                    written.append(data)
                elif event == "done" and conn is not None:
                    _try(ask_store.finish_run, conn, run_id, "".join(written), data)
                yield sse(event, data)
        # rag.py exits with a message when a key or DATABASE_URL is missing.
        except SystemExit as exc:
            if conn is not None:
                _try(ask_store.fail_run, conn, run_id, str(exc), "".join(written))
            yield sse("error", {"message": str(exc)})
        except Exception as exc:
            message = f"{type(exc).__name__}: {exc}"
            if conn is not None:
                _try(ask_store.fail_run, conn, run_id, message, "".join(written))
            yield sse("error", {"message": message})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



# --- Fit-Gap Copilot (fitgap/) ------------------------------------------------
# A third component beside rag.py and knowledge_graph.py: it calls both through
# fitgap/tools.py and never merges them. Every entry it produces is "proposed"
# and waits for a named reviewer.


@app.get("/fit-gap", response_class=HTMLResponse)
@app.get("/fitgap", response_class=HTMLResponse)
def fitgap_page() -> HTMLResponse:
    return _spa()


@app.get("/api/fitgap/status")
def fitgap_status() -> dict:
    """What the Copilot can see right now: the BPML sheet, the index, the
    graph and the model. The page shows this before the first run so a missing
    prerequisite is visible rather than a failed run."""
    from fitgap import agent as fg_agent, bpml as fg_bpml, store as fg_store

    info: dict = {
        "bpml": fg_bpml.stats(),
        "model": fg_agent.MODEL,
        "prompt_hash": fg_agent.prompt_hash(),
        "max_tool_calls": fg_agent.MAX_TOOL_CALLS,
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "runs": 0,
        "entries": 0,
        "reviews": 0,
        "error": None,
    }
    try:
        conn = fg_store.connect()  # shared; not ours to close
        fg_store.create_schema(conn)
        info.update(fg_store.stats(conn))
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    try:
        # The runs and the corpus share a database, but not a table: these are
        # the documents a run may retrieve from, broken down the same way the
        # Ask page shows them.
        info["documents"], info["chunks"] = rag.counts()
        info["categories"] = [
            {"code": code, "documents": docs, "chunks": chunks}
            for code, docs, chunks in rag.totals()
        ]
    except Exception as exc:
        info["corpus_error"] = f"{type(exc).__name__}: {exc}"
    try:
        info["graph"] = knowledge_graph.extract_graph()["stats"]
    except Exception:
        info["graph"] = None
    fg_uploads = _uploads()
    info["uploads"] = {
        "ttl_hours": fg_uploads.TTL_HOURS,
        "max_files": fg_uploads.MAX_FILES,
        "accepted": sorted(ACCEPTED),
        "database": rag.database_name(fg_uploads.database_url()),
    }
    try:
        # Expired attachments are swept whenever the page that offers them is
        # opened. Only if the session database exists: an installation nobody
        # has uploaded to should not grow one to be told it is empty.
        if fg_uploads.live():
            fg_uploads.sweep()
    except Exception:
        pass
    return info


@app.get("/api/fitgap/scope")
def fitgap_scope(q: str = "", code: str = "") -> dict:
    """Resolve what the user typed to a place in the BPML hierarchy, or list a
    node's children for the tree picker."""
    from fitgap import bpml as fg_bpml

    if code:
        p = fg_bpml.get(code)
        if not p:
            raise HTTPException(404, f"{code} is not a BPML code")
        return {
            "process": p.full(),
            "ancestry": [a.brief() for a in _fg_ancestry(p)],
            "children": [c.full() for c in fg_bpml.children(p.code)],
            "steps": len(fg_bpml.steps_in_scope(p.code)),
        }
    if q.strip():
        hits = fg_bpml.search(q, limit=10)
        return {"query": q, "matches": [
            {**h.full(), "steps": len(fg_bpml.steps_in_scope(h.code))} for h in hits
        ]}
    return {"roots": [
        {**r.full(), "steps": len(fg_bpml.steps_in_scope(r.code))} for r in fg_bpml.roots()
    ]}


def _fg_ancestry(p):
    from fitgap import bpml as fg_bpml

    out, cur = [], p.parent
    while cur:
        q = fg_bpml.get(cur)
        if not q:
            break
        out.append(q)
        cur = q.parent
    return list(reversed(out))


@app.post("/api/fitgap/preview")
def fitgap_preview(req: "FitGapRun") -> dict:
    from fitgap.orchestrator import preview as fg_preview
    from fitgap.schemas import RunRequest

    try:
        categories = [rag.check_category(c) for c in req.categories]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    out = fg_preview(RunRequest(**{**req.model_dump(), "categories": categories}))
    if out.get("error"):
        raise HTTPException(400, out["error"])
    return out


@app.post("/api/fitgap/run")
def fitgap_run(req: "FitGapRun") -> StreamingResponse:
    """Stream one map-reduce over a BPML scope as server-sent events:
    `scope`, `step_start`, `tool_call`, `entry`, `verify_fail`, `synthesis`,
    `done`. A sync generator, so Starlette iterates it in the threadpool."""
    from fitgap.orchestrator import run as fg_run
    from fitgap.schemas import RunRequest

    try:
        categories = [rag.check_category(c) for c in req.categories]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    request = RunRequest(**{**req.model_dump(), "categories": categories})

    def sse(event: str, data) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    def events():
        try:
            for event, data in fg_run(request):
                yield sse(event, data)
        except SystemExit as exc:
            yield sse("error", {"message": str(exc)})
        except Exception as exc:
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- documents attached to one agent session ----------------------------------
#
# Shared by the Fit-Gap Copilot and the Rollout Agent, which is why these are
# /api/uploads rather than /api/fitgap/uploads. They never reach the corpus:
# each is converted, chunked and embedded into a Postgres schema of its own
# inside docling_session -- a different database from the one the corpus is in
# -- given a knowledge graph of its own, and swept once the session expires.
# See uploads.py for why a schema rather than a database per session.


def _uploads():
    import uploads as fg_uploads

    return fg_uploads


@app.post("/api/uploads")
def session_upload(
    files: list[UploadFile],
    session: str = Form(default=""),
    role: str = Form(default=""),
) -> StreamingResponse:
    """Convert, chunk, embed and graph one or more documents into a session.

    `role` says what the documents are in the analysis -- a country's As-Is,
    the Global Template, SAP Best Practice content -- which is what lets the
    Rollout Agent run a three-way comparison instead of a two-document one.

    Streamed, because converting a deck takes far longer than embedding it and
    a single spinner would hide which stage is slow."""
    fg_uploads = _uploads()
    try:
        role = fg_uploads.check_role(role or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if not files:
        raise HTTPException(400, "No files uploaded")
    accepted = []
    for f in files:
        name = Path(f.filename or "document").name
        if name.startswith((".", "~$")):
            continue
        if Path(name).suffix.lower() not in ACCEPTED:
            raise HTTPException(
                400, f"Unsupported format '{Path(name).suffix}'. Expected one of {sorted(ACCEPTED)}."
            )
        accepted.append((name, f))
    if not accepted:
        raise HTTPException(400, "No supported documents in the upload")

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    def events():
        try:
            fg_uploads.sweep()
            sid = session.strip()
            if sid and not fg_uploads.exists(sid):
                sid = ""  # expired while the page was open; start a fresh one
            if not sid:
                sid = fg_uploads.new_session()
            yield sse("session", {"session": sid})
        except Exception as exc:
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})
            return

        total = len(accepted)
        added = 0
        for i, (name, upload_file) in enumerate(accepted, 1):
            yield sse("start", {"index": i, "total": total, "filename": name})
            tmp = Path(tempfile.mkdtemp()) / name
            try:
                with open(tmp, "wb") as out:
                    shutil.copyfileobj(upload_file.file, out)
                # add_file runs on a worker so its stages can be forwarded as
                # they start rather than after the file is finished. Converting
                # a large deck is much the slowest stage and naming it is the
                # difference between a progress bar and a frozen one.
                stages: queue.Queue = queue.Queue()
                box: dict = {}

                def work(tmp=tmp, name=name, role=role, box=box, stages=stages):
                    try:
                        box["result"] = fg_uploads.add_file(
                            sid, tmp, name, role,
                            on_event=lambda stage, detail: stages.put(("stage", {"stage": stage, **detail})),
                        )
                    except Exception as exc:
                        box["error"] = f"{type(exc).__name__}: {exc}"
                    finally:
                        # The worker owns its own connections to the session
                        # database; nothing else will close them.
                        fg_uploads.close()
                        stages.put(("__end__", {}))

                threading.Thread(target=work, daemon=True).start()
                while True:
                    kind, payload = stages.get()
                    if kind == "__end__":
                        break
                    yield sse("stage", {"index": i, "total": total, "filename": name, **payload})
                if box.get("error"):
                    yield sse("file_error", {"index": i, "total": total, "filename": name,
                                             "message": box["error"]})
                else:
                    added += 1
                    yield sse("done_file", {"index": i, "total": total, **box["result"]})
            except Exception as exc:
                yield sse("file_error", {"index": i, "total": total, "filename": name,
                                         "message": f"{type(exc).__name__}: {exc}"})
            finally:
                shutil.rmtree(tmp.parent, ignore_errors=True)
        try:
            yield sse("done", {"added": added, "total": total, **fg_uploads.info(sid)})
        except Exception as exc:
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/uploads/{session}")
def session_upload_status(session: str) -> dict:
    fg_uploads = _uploads()
    try:
        fg_uploads.sweep()
        return fg_uploads.info(session)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/uploads/{session}/files/{name}/markdown")
def session_upload_markdown(session: str, name: str) -> Response:
    """The converted Markdown of one attached document, so a citation from an
    attachment opens the same way a citation from the corpus does."""
    fg_uploads = _uploads()
    try:
        text = fg_uploads.markdown(session, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if text is None:
        raise HTTPException(404, f"'{name}' is not in this session")
    return Response(text, media_type="text/markdown")


@app.get("/api/uploads/{session}/entities")
def session_upload_entities(session: str, roles: list[str] | None = Query(default=None)) -> dict:
    """What the attachment has in common with the corpus and what is only in
    it -- the same comparison the agent's upload_entities tool returns."""
    fg_uploads = _uploads()
    try:
        if not fg_uploads.exists(session):
            raise HTTPException(404, "This upload session has expired")
        return fg_uploads.compare(session, roles or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.delete("/api/uploads/{session}")
def session_upload_drop(session: str) -> dict:
    fg_uploads = _uploads()
    try:
        fg_uploads.drop(session)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {"dropped": True, "session": session}


@app.patch("/api/uploads/{session}/files/{name}")
def session_upload_retag(session: str, name: str, role: str = Query(...)) -> dict:
    """Change what a document is in the analysis. No re-conversion and no
    re-embedding: the role is metadata, the vectors do not depend on it."""
    fg_uploads = _uploads()
    try:
        out = fg_uploads.set_role(session, name, role)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if not out.get("updated"):
        raise HTTPException(404, f"'{name}' is not in this session")
    return {**out, **fg_uploads.info(session)}


@app.delete("/api/uploads/{session}/files/{name}")
def session_upload_remove(session: str, name: str) -> dict:
    fg_uploads = _uploads()
    try:
        out = fg_uploads.remove_file(session, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if not out.get("removed"):
        raise HTTPException(404, f"'{name}' is not in this session")
    return {**out, **fg_uploads.info(session)}


@app.get("/api/fitgap/runs")
def fitgap_runs(limit: int = 40) -> list[dict]:
    from fitgap import store as fg_store

    conn = fg_store.connect()  # shared; not ours to close
    fg_store.create_schema(conn)
    return fg_store.list_runs(conn, limit)


@app.get("/api/fitgap/runs/{run_id}")
def fitgap_get_run(run_id: str) -> dict:
    from fitgap import store as fg_store

    conn = fg_store.connect()  # shared; not ours to close
    run = fg_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, f"run {run_id} not found")
    return run


@app.get("/api/fitgap/runs/{run_id}/export")
def fitgap_export(run_id: str, format: str = "md"):
    """The register as a document. Markdown and JSON always; XLSX when
    openpyxl is installed, which it is because bpml.py needs it."""
    from fitgap import store as fg_store, synthesis as fg_synth

    if format not in ("md", "json", "xlsx"):
        raise HTTPException(400, "format must be md, json or xlsx")
    conn = fg_store.connect()  # shared; not ours to close
    run = fg_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, f"run {run_id} not found")

    results = fg_store.to_results(run["entries"])
    synth = run.get("synthesis") or fg_synth.synthesise(results)

    if format == "json":
        return StreamingResponse(
            iter([json.dumps({"run": {k: v for k, v in run.items() if k != "entries"},
                              "entries": run["entries"], "synthesis": synth},
                             indent=2, default=str)]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="fitgap_{run_id}.json"'},
        )
    if format == "md":
        text = fg_synth.to_markdown(run, results, synth)
        return StreamingResponse(
            iter([text]), media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="fitgap_{run_id}.md"'},
        )
    return _fitgap_xlsx(run, results, synth, run_id)


def _fitgap_xlsx(run: dict, results, synth: dict, run_id: str) -> StreamingResponse:
    import io

    import openpyxl
    from openpyxl.styles import Alignment, Font

    wb = openpyxl.Workbook()

    def sheet(name: str, headers: list[str], rows: list[list]):
        ws = wb.create_sheet(name[:31])
        ws.append(headers)
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in rows:
            ws.append(["\n".join(map(str, v)) if isinstance(v, list) else v for v in r])
        for n, h in enumerate(headers, 1):
            width = max(12, min(60, max([len(str(h))] + [len(str(r[n - 1])) for r in rows[:60]] or [12]) + 2))
            ws.column_dimensions[ws.cell(1, n).column_letter].width = width
        ws.freeze_panes = "A2"
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
        return ws

    wb.remove(wb.active)
    sheet("Register", ["BPML", "Step", "Class", "Confidence", "Materiality", "Status",
                       "Rationale", "Tickets", "SAP objects", "Evidence", "Docs", "Verified"],
          [[e.entry.bpml_code, e.entry.step_name, e.entry.classification, e.entry.confidence,
            e.entry.materiality, e.entry.status, e.entry.rationale,
            ", ".join(e.entry.linked_tickets), ", ".join(e.entry.sap_objects),
            len(e.entry.evidence), sorted({ev.doc for ev in e.entry.evidence}),
            "yes" if e.evidence_valid else "no"] for e in results])
    sheet("Reuse", ["Process", "Steps", "Fit", "Gap", "Unknown", "Reuse %", "Avg confidence"],
          [[p["label"], p["steps"], p["fit"], p["gap"], p["unknown"], p["reuse_pct"],
            p["avg_confidence"]] for p in synth["reuse"]["by_process"]])
    sheet("Gaps", ["BPML", "Step", "Class", "Confidence", "Materiality", "Tickets", "Rationale"],
          [[g["bpml_code"], g["step_name"], g["classification"], g["confidence"],
            g["materiality"], ", ".join(g["linked_tickets"]), g["rationale"]]
           for g in synth["gaps"]])
    sheet("Decisions", ["Process", "Question", "Options", "Consequence", "Raised by", "Weight"],
          [[d["process"], d["question"], d["options"], d["consequence_note"],
            ", ".join(s["bpml_code"] for s in d["steps"]), d["weight"]]
           for d in synth["decisions"]])
    sheet("Integrations", ["System", "Steps", "Impacts", "Interfaces"],
          [[i["system"], i["step_count"], ", ".join(f"{k}x{v}" for k, v in i["impacts"].items()),
            ", ".join(i["interfaces"])] for i in synth["integrations"]])
    sheet("Agenda", ["#", "Process", "Minutes", "Weight", "Steps", "Gaps", "Unresolved",
                     "Decisions", "Pre-read"],
          [[s["order"], s["process"], s["minutes"], s["weight"], s["steps"], s["gaps"],
            s["unresolved"], s["decisions"], s["pre_read"]] for s in synth["agenda"]])
    sheet("Review", ["Entry id", "BPML", "Step", "Proposed class", "Confidence",
                     "Reviewer", "Verdict (accept/reject/refine)", "Corrected class", "Comment"],
          [[row.get("id"), row["bpml_code"], row["step_name"], row["classification"],
            row["confidence"], "", "", "", ""] for row in run["entries"]])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="fitgap_{run_id}.xlsx"'},
    )


@app.post("/api/fitgap/entries/{entry_id}/review")
def fitgap_review(entry_id: int, body: "FitGapReview") -> dict:
    from fitgap import store as fg_store
    from fitgap.schemas import Review

    conn = fg_store.connect()  # shared; not ours to close
    exists = conn.execute("SELECT 1 FROM fitgap_entries WHERE id = %s", (entry_id,)).fetchone()
    if not exists:
        raise HTTPException(404, f"entry {entry_id} not found")
    return fg_store.add_review(conn, entry_id, Review(**body.model_dump()))



# --- Evidence Agent (evidence/) -----------------------------------------------
# A fourth query mode: one question, both engines, answered as scored claims.
# Reuses fitgap/tools.py for retrieval and traversal; adds provenance,
# near-duplicate and hub-artefact judgement on top.


# --- the Rollout Agent --------------------------------------------------------
#
# Fit-to-Standard analysis for a country rollout: the country's As-Is,
# attached to the session, compared against the Global Template in the corpus
# and -- when a source for it is attached -- SAP Best Practice. See rollout/.


class RolloutRun(BaseModel):
    # Optional: empty asks the agent to identify the template process itself.
    scope_bpml: str = ""
    # What the run analyses: the country's As-Is, or an SAP Best Practice
    # document read as the subject to find where the template has drifted
    # from SAP standard.
    subject: str = "country_as_is"
    country: str = Field(default="", max_length=80)
    country_context: str = Field(default="", max_length=4000)
    sap_release: str = Field(default="", max_length=200)
    gt_version: str = Field(default="", max_length=120)
    question: str | None = None
    upload_session: str = ""
    categories: list[str] = Field(default_factory=list)


class RolloutDecision(BaseModel):
    gap_id: str = Field(min_length=1, max_length=40)
    reviewer: str = Field(min_length=1, max_length=120)
    verdict: str
    disposition: str = ""
    comment: str = ""


def _rollout_request(req: "RolloutRun"):
    from rollout.schemas import SUBJECTS, RunRequest

    try:
        categories = [rag.check_category(c) for c in req.categories]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    if req.subject not in SUBJECTS:
        raise HTTPException(400, f"subject must be one of {sorted(SUBJECTS)}")
    return RunRequest(**{**req.model_dump(), "categories": categories})


@app.get("/rollout", response_class=HTMLResponse)
@app.get("/fit-to-standard", response_class=HTMLResponse)
def rollout_page() -> HTMLResponse:
    return _spa()


@app.get("/api/rollout/status")
def rollout_status() -> dict:
    """What the Rollout Agent can see before the first run: the BPML sheet it
    reads the Global Template from, the corpus categories, the model, and what
    an analyst may attach."""
    from rollout import agent as ro_agent, pdf as ro_pdf, store as ro_store
    from rollout.schemas import (DEVIATION_TYPES, DISPOSITIONS, DIMENSIONS, SUBJECTS,
                                 LOCALIZATION_STATES, RATING_MEANING)
    from fitgap import bpml as fg_bpml

    _pdf_ok, _pdf_why = ro_pdf.available()
    fg_uploads = _uploads()
    info: dict = {
        "bpml": fg_bpml.stats(),
        "model": ro_agent.MODEL,
        "prompt_hash": ro_agent.prompt_hash(),
        "max_tool_calls": ro_agent.MAX_TOOL_CALLS,
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "runs": 0,
        "decisions": 0,
        # Whether this machine can render the pack as a PDF. Probed here so
        # the page offers the format it can actually produce, rather than a
        # button that fails at the download.
        "pdf": {"available": _pdf_ok, "detail": _pdf_why},
        "error": None,
        # The controlled vocabularies, so the page renders the same labels the
        # validator enforces instead of a second copy that can drift.
        "vocabulary": {
            "deviation_types": DEVIATION_TYPES,
            "dispositions": DISPOSITIONS,
            "localization_states": LOCALIZATION_STATES,
            "dimensions": {k: {"label": v[0], "weight": round(v[1] * 100)}
                           for k, v in DIMENSIONS.items()},
            "ratings": {str(k): v for k, v in RATING_MEANING.items()},
        },
        # What a run can be about, and which upload role each one requires, so
        # the page does not keep its own copy of that pairing.
        "subjects": [
            {"value": sub.key, "label": sub.label, "role": sub.role,
             "localization": sub.localization, "score_b": sub.score_b}
            for sub in SUBJECTS.values()
        ],
        "uploads": {
            "ttl_hours": fg_uploads.TTL_HOURS,
            "max_files": fg_uploads.MAX_FILES,
            "accepted": sorted(ACCEPTED),
            "database": rag.database_name(fg_uploads.database_url()),
            "roles": [{"value": r, "label": fg_uploads.ROLE_LABEL[r]} for r in fg_uploads.ROLES],
        },
    }
    try:
        info.update(ro_store.stats())
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    try:
        info["documents"], info["chunks"] = rag.counts()
        info["categories"] = [
            {"code": code, "documents": docs, "chunks": chunks}
            for code, docs, chunks in rag.totals()
        ]
    except Exception as exc:
        info["corpus_error"] = f"{type(exc).__name__}: {exc}"
    return info


@app.post("/api/rollout/preview")
def rollout_preview(req: "RolloutRun") -> dict:
    from rollout.orchestrator import preview as ro_preview

    out = ro_preview(_rollout_request(req))
    if out.get("error"):
        raise HTTPException(400, out["error"])
    return out


@app.post("/api/rollout/run")
def rollout_run(req: "RolloutRun") -> StreamingResponse:
    """Stream one Fit-to-Standard analysis as server-sent events: `scope`,
    `stage`, `tool_call`, `asis`, `gate`, `analysis`, `scores`, `done`."""
    from rollout.orchestrator import run as ro_run

    request = _rollout_request(req)

    def sse(event: str, data) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    def events():
        try:
            for event, data in ro_run(request):
                yield sse(event, data)
        except SystemExit as exc:
            yield sse("error", {"message": str(exc)})
        except Exception as exc:
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/rollout/runs")
def rollout_runs(limit: int = 40) -> list[dict]:
    from rollout import store as ro_store

    conn = ro_store.connect()  # shared; not ours to close
    ro_store.create_schema(conn)
    return ro_store.list_runs(conn, limit)


@app.get("/api/rollout/runs/{run_id}")
def rollout_get_run(run_id: str) -> dict:
    from rollout import store as ro_store

    conn = ro_store.connect()
    ro_store.create_schema(conn)
    run = ro_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.delete("/api/rollout/runs/{run_id}")
def rollout_run_delete(run_id: str) -> dict:
    """Remove one analysis. The same shape as the Evidence Agent's, because a
    person who has learned one history panel should not have to learn another."""
    from rollout import store as ro_store

    conn = ro_store.connect()
    ro_store.create_schema(conn)
    if not ro_store.delete_run(conn, run_id):
        raise HTTPException(404, f"No rollout analysis {run_id}")
    return {"status": "deleted", "id": run_id}


@app.post("/api/rollout/runs/{run_id}/decisions")
def rollout_decide(run_id: str, body: "RolloutDecision") -> dict:
    """Record a human decision on one gap. The agent proposes; this is where a
    named person disposes, and the proposal is never overwritten."""
    from rollout import store as ro_store

    if body.verdict not in ("accept", "reject", "defer"):
        raise HTTPException(400, "verdict must be accept, reject or defer")
    conn = ro_store.connect()
    ro_store.create_schema(conn)
    if not ro_store.get_run(conn, run_id):
        raise HTTPException(404, "Run not found")
    return ro_store.save_decision(conn, run_id, body.gap_id, body.reviewer,
                                  body.verdict, body.disposition, body.comment)


@app.get("/api/rollout/runs/{run_id}/export")
def rollout_export(run_id: str, format: str = "md"):
    """The analysis as a workshop pack: PDF, Markdown or JSON.

    All three are the same document. The PDF is rendered from the Markdown
    rather than from the run, so a section added to one cannot go missing from
    the other."""
    from rollout import store as ro_store
    from rollout.export import to_markdown

    conn = ro_store.connect()
    ro_store.create_schema(conn)
    run = ro_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if format == "pdf":
        from rollout import pdf as ro_pdf

        ok, why = ro_pdf.available()
        if not ok:
            # 503 rather than 500: the analysis is fine and every other format
            # still works. The message says what to install.
            raise HTTPException(503, f"This server cannot render PDFs. {why}")
        try:
            blob = ro_pdf.render(run, to_markdown(run))
        except Exception as exc:
            raise HTTPException(500, f"PDF rendering failed: {type(exc).__name__}: {exc}") from None
        return Response(
            content=blob,
            media_type="application/pdf",
            headers={"Content-Disposition":
                     f'attachment; filename="{ro_pdf.filename(run)}"'},
        )
    if format == "json":
        return StreamingResponse(
            iter([json.dumps(run, indent=2, default=str)]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{run_id}.json"'},
        )
    return StreamingResponse(
        iter([to_markdown(run)]),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{run_id}.md"'},
    )


@app.get("/evidence", response_class=HTMLResponse)
@app.get("/investigate", response_class=HTMLResponse)
def evidence_page() -> HTMLResponse:
    return _spa()


@app.get("/api/evidence/status")
def evidence_status() -> dict:
    from evidence import agent as ev_agent, independence, paths

    info: dict = {
        "model": ev_agent.MODEL,
        "prompt_hash": ev_agent.prompt_hash(),
        "max_tool_calls": ev_agent.MAX_TOOL_CALLS,
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "tools": [t["name"] for t in ev_agent.tool_definitions()],
        "categories": [],
        "error": None,
    }
    try:
        # Whether the memory server is up, so the page can offer the toggle
        # rather than let it fail on the first run. Probed with a short
        # deadline and cached, so a server that is down costs nothing here.
        from fitgap import memory as agent_memory

        info["memory"] = agent_memory.describe()
    except Exception as exc:
        info["memory"] = {"configured": False, "available": False,
                          "detail": f"{type(exc).__name__}: {exc}"}
    try:
        # What the run may be pointed at, and how much is in each.
        info["categories"] = [
            {"code": code, "documents": docs, "chunks": chunks}
            for code, docs, chunks in rag.totals()
        ]
    except Exception:
        pass
    try:
        from evidence import store as ev_store

        info["history"] = ev_store.stats()
    except Exception as exc:
        info["history"] = {"runs": 0, "answered": 0, "error": f"{type(exc).__name__}: {exc}"}
    try:
        d = independence.load()
        info["duplicate_groups"] = [sorted(g) for g in d.groups]
        info["duplicate_threshold"] = independence.DUPLICATE_AT
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    try:
        g = knowledge_graph.extract_graph()
        nodes = {n["id"]: n for n in g["nodes"]}
        info["hubs"] = [{"label": nodes[i]["label"], "degree": d}
                        for i, d in sorted(paths.hubs(g).items(), key=lambda kv: -kv[1])]
        info["hub_degree"] = paths.HUB_DEGREE
        info["graph"] = g["stats"]
    except Exception:
        info["hubs"] = []
    return info


class EvidenceQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    holdout: bool = False
    # Empty means every category, matching the Ask and Knowledge Graph pages.
    categories: list[str] = Field(default_factory=list)
    # Read what earlier runs concluded, and write down what this one does.
    # Ignored under holdout -- see fitgap/memory.py for why.
    memory: bool = False


@app.post("/api/evidence/ask")
def evidence_ask(body: EvidenceQuestion) -> StreamingResponse:
    """Stream one investigation as server-sent events: `run` with the id it is
    being recorded under, `tool_call` as each engine is queried, then `answer`
    or `error`. A sync generator, so Starlette iterates it in the threadpool.

    The run is written to evidence_runs as it goes rather than at the end, so
    an investigation whose stream is dropped -- the tab closed, the browser
    gone -- still leaves behind what it had done by then."""
    import uuid

    from evidence import agent as ev_agent, store as ev_store

    def sse(event: str, data) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    try:
        categories = [rag.check_category(c) for c in body.categories]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None

    question = body.question.strip()
    run_id = f"ev_{uuid.uuid4().hex[:10]}"

    def events():
        conn = None
        calls: list[dict] = []
        log: list[dict] = []

        def record(kind: str, data: dict) -> dict:
            """One line of the session log, in the order it happened.

            The heavy half of a tool call -- the passages it returned -- stays
            in `calls`; the log points at it by index so the console can open
            the same trace drawer without carrying a second copy of every
            chunk. Text is capped because a reasoning block is unbounded and a
            log nobody can load is a log nobody reads."""
            entry: dict = {"seq": len(log), "at": _now(), "kind": kind}
            if kind == "tool_call":
                entry.update({"tool": data.get("tool"), "engine": data.get("engine"),
                              "summary": data.get("summary"), "ms": data.get("ms"),
                              "error": data.get("error"), "warning": data.get("warning"),
                              "arguments": data.get("arguments"),
                              "call": len(calls) - 1})
            elif kind == "thinking":
                entry.update({"text": (data.get("text") or "")[:6000], "turn": data.get("turn")})
            elif kind == "note":
                entry.update({"note": data.get("kind"), "title": data.get("title"),
                              "text": (data.get("text") or "")[:6000],
                              "detail": data.get("detail") or {}})
            elif kind == "memory":
                entry.update({"used": data.get("used"), "recalled": data.get("recalled", 0),
                              "suppressed_by_holdout": data.get("suppressed_by_holdout"),
                              "memories": [m.get("text", "")[:600] for m in
                                           (data.get("memories") or [])]})
            elif kind == "answer":
                entry.update({"state": data.get("state"),
                              "claims": len(data.get("claims") or []),
                              "text": (data.get("answer") or "")[:2000],
                              "detail": {"tool_calls": data.get("tool_calls"),
                                         "input_tokens": data.get("input_tokens"),
                                         "output_tokens": data.get("output_tokens"),
                                         "seconds": data.get("seconds")}})
            elif kind == "error":
                entry.update({"text": str(data.get("message", ""))[:2000]})
            log.append(entry)
            return entry

        try:
            conn = ev_store.connect()
            ev_store.create_schema(conn)
            ev_store.start_run(conn, {
                "id": run_id, "question": question, "holdout": body.holdout,
                "categories": categories, "model": ev_agent.MODEL,
                "prompt_hash": ev_agent.prompt_hash(),
                "corpus_fingerprint": _corpus_fingerprint(categories),
            })
            yield sse("run", {"id": run_id})
        except Exception as exc:
            # History is worth having, not worth refusing to answer over.
            conn = None
            yield sse("run", {"id": run_id, "not_saved": f"{type(exc).__name__}: {exc}"})

        try:
            asked = record("question", {})
            asked.update({"text": question, "holdout": body.holdout,
                          "scope": categories or ["all categories"],
                          "memory": body.memory})
            yield sse("log", asked)

            for event, data in ev_agent.run(
                question, holdout=body.holdout, categories=categories,
                memory=body.memory,
            ):
                if event == "tool_call":
                    calls.append(data)
                entry = record(event, data)
                if conn is not None:
                    try:
                        if event == "memory":
                            ev_store.save_memory(conn, run_id, data)
                        elif event == "tool_call":
                            ev_store.save_calls(conn, run_id, calls)
                        elif event == "answer":
                            ev_store.finish_run(conn, run_id, data, calls)
                        elif event == "error":
                            ev_store.fail_run(conn, run_id, str(data.get("message", "")), calls)
                        # Written after the event it describes, so a dropped
                        # stream leaves a log that ends where the run stopped.
                        ev_store.save_log(conn, run_id, log)
                    except Exception:
                        conn = None  # stop trying; the answer still streams
                # The log line goes first: the console shows the call before
                # the panel below it re-renders with the result.
                yield sse("log", entry)
                if event not in ("thinking", "note"):
                    yield sse(event, data)
        except SystemExit as exc:
            if conn is not None:
                _try(ev_store.fail_run, conn, run_id, str(exc), calls)
            yield sse("error", {"message": str(exc)})
        except Exception as exc:
            if conn is not None:
                _try(ev_store.fail_run, conn, run_id, f"{type(exc).__name__}: {exc}", calls)
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _try(fn, *args) -> None:
    """Best effort: a bookkeeping write must never turn into the error the
    caller reports."""
    try:
        fn(*args)
    except Exception:
        pass


def _corpus_fingerprint(categories: list[str]) -> str:
    """What the run could have read, hashed the way the Copilot's and the
    Rollout Agent's records hash it."""
    import hashlib

    try:
        conn = rag.connection()
        rows = (conn.execute("SELECT source, fingerprint FROM rag_documents"
                             " WHERE category = ANY(%s)", (categories,)).fetchall()
                if categories else
                conn.execute("SELECT source, fingerprint FROM rag_documents").fetchall())
        h = hashlib.sha256()
        for _, fp in sorted(rows):
            h.update(fp.encode())
        return h.hexdigest()[:16]
    except Exception:
        return ""


@app.get("/api/evidence/runs")
def evidence_runs(limit: int = 50) -> list[dict]:
    """Past investigations, newest first."""
    from evidence import store as ev_store

    conn = ev_store.connect()
    ev_store.create_schema(conn)
    return ev_store.list_runs(conn, limit=max(1, min(limit, 200)))


@app.get("/api/evidence/runs/{run_id}")
def evidence_run(run_id: str) -> dict:
    """One investigation in full: the question, every tool call, the answer."""
    from evidence import store as ev_store

    conn = ev_store.connect()
    ev_store.create_schema(conn)
    run = ev_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, f"No investigation {run_id}")
    return run


@app.delete("/api/evidence/runs/{run_id}")
def evidence_run_delete(run_id: str) -> dict:
    from evidence import store as ev_store

    conn = ev_store.connect()
    ev_store.create_schema(conn)
    if not ev_store.delete_run(conn, run_id):
        raise HTTPException(404, f"No investigation {run_id}")
    return {"status": "deleted", "id": run_id}


# --- Ask RAG history ----------------------------------------------------------
# Same shape as the Evidence Agent's, and deliberately so: a person who has
# learned one history panel should not have to learn a second.


@app.get("/api/ask/runs")
def ask_runs(limit: int = 50, search: str = "") -> dict:
    """Past questions, newest first, optionally filtered by their text."""
    conn = ask_store.connect()
    ask_store.create_schema(conn)
    return {
        "runs": ask_store.list_runs(conn, limit=max(1, min(limit, 200)), search=search),
        "retention": ask_store.RETENTION,
    }


@app.get("/api/ask/runs/{run_id}")
def ask_run(run_id: str) -> dict:
    """One question in full: the settings, every excerpt it read, the answer."""
    conn = ask_store.connect()
    ask_store.create_schema(conn)
    run = ask_store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, f"No question {run_id}")
    # Whether the corpus has changed since. A reopened answer is evidence of
    # what the corpus said then, and saying so is the difference between
    # history and a stale cache pretending to be current.
    run["corpus_changed"] = bool(
        run["corpus_fingerprint"]
        and run["corpus_fingerprint"] != _corpus_fingerprint(run["categories"])
    )
    return run


@app.delete("/api/ask/runs/{run_id}")
def ask_run_delete(run_id: str) -> dict:
    conn = ask_store.connect()
    ask_store.create_schema(conn)
    if not ask_store.delete_run(conn, run_id):
        raise HTTPException(404, f"No question {run_id}")
    return {"status": "deleted", "id": run_id}


@app.delete("/api/ask/runs")
def ask_runs_clear() -> dict:
    conn = ask_store.connect()
    ask_store.create_schema(conn)
    return {"status": "cleared", "removed": ask_store.clear(conn)}


# Hashed JS/CSS bundles of the built front end. check_dir=False so the API
# still starts before the first build.
class _ImmutableAssets(StaticFiles):
    """The built assets, cached for a year.

    Every file under /assets carries a content hash in its name, so a change
    produces a new name rather than new content at the same name. That makes
    them safe to cache immutably -- and the freshness of the page that names
    them is handled in _spa above."""

    def file_response(self, *args, **kwargs):  # type: ignore[override]
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app.mount("/assets", _ImmutableAssets(directory=DIST / "assets", check_dir=False), name="assets")
