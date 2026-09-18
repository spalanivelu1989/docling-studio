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

import json
import os
import shutil
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import preview
import rag
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
ACCEPTED = {".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".pdf", ".html", ".htm", ".xml"} | preview.IMAGE_FORMATS

app = FastAPI(title="Docling Extraction UI")

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
    return HTMLResponse(page.read_text())


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
def embed_doc(doc_id: str) -> dict:
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
    dest.write_text(md.read_text())

    started = time.perf_counter()
    try:
        with rag.connect() as conn:
            rag.create_schema(conn)
            result = rag.index_file(conn, dest)
            # The same document indexed from somewhere else (e.g. by
            # `rag.py index solvay-spark/markdown`) would be retrieved twice.
            result["duplicates"] = [
                _display_path(r[0])
                for r in conn.execute(
                    "SELECT source FROM rag_documents WHERE title = %s AND source <> %s",
                    (result["title"], str(dest.resolve())),
                ).fetchall()
            ]
            result["documents"], result["total_chunks"] = conn.execute(
                "SELECT (SELECT count(*) FROM rag_documents), (SELECT count(*) FROM rag_chunks)"
            ).fetchone()
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


@app.get("/api/kb/files")
def list_kb_files() -> list[dict]:
    """List all documents in the knowledge base, combining documents indexed in pgvector
    (from any source folder, such as solvay-spark/pkg/markdown) with any Markdown files
    stored in knowledge_base/."""
    items: dict[str, dict] = {}

    # 1. Primary source of truth: documents indexed in PostgreSQL rag_documents
    try:
        with rag.connect() as conn:
            rows = conn.execute(
                "SELECT d.id, d.source, d.title, count(c.id), coalesce(sum(c.tokens), 0), d.indexed_at"
                " FROM rag_documents d LEFT JOIN rag_chunks c ON c.document_id = d.id"
                " GROUP BY d.id, d.source, d.title, d.indexed_at"
                " ORDER BY d.indexed_at DESC, d.title ASC"
            ).fetchall()
            for r in rows:
                doc_id, source_path_str, title, chunk_count, token_count, indexed_at = r
                p = Path(source_path_str)
                name = p.name
                size = 0
                if p.is_file():
                    try:
                        size = p.stat().st_size
                    except Exception:
                        pass
                elif (KNOWLEDGE_BASE / name).is_file():
                    try:
                        size = (KNOWLEDGE_BASE / name).stat().st_size
                    except Exception:
                        pass

                try:
                    rel_source = str(p.relative_to(BASE))
                except Exception:
                    rel_source = str(p)

                items[name] = {
                    "name": name,
                    "title": title or p.stem,
                    "source": rel_source,
                    "full_path": str(p),
                    "size": size,
                    "chunks": int(chunk_count),
                    "tokens": int(token_count),
                    "is_indexed": True,
                    "indexed_at": indexed_at.isoformat() if hasattr(indexed_at, "isoformat") else str(indexed_at),
                }
    except Exception:
        pass

    # 2. Also check files in knowledge_base/ directory
    if KNOWLEDGE_BASE.is_dir():
        for f in sorted(KNOWLEDGE_BASE.glob("*.md")):
            if f.name.startswith((".", "~$")):
                continue
            if f.name not in items:
                items[f.name] = {
                    "name": f.name,
                    "title": f.stem,
                    "source": f"knowledge_base/{f.name}",
                    "full_path": str(f.resolve()),
                    "size": f.stat().st_size,
                    "chunks": 0,
                    "tokens": 0,
                    "is_indexed": False,
                    "indexed_at": None,
                }

    # 3. Also check solvay-spark/pkg/markdown if it exists
    pkg_md = BASE / "solvay-spark" / "pkg" / "markdown"
    if pkg_md.is_dir():
        for f in sorted(pkg_md.glob("*.md")):
            if f.name.startswith((".", "~$")):
                continue
            if f.name not in items:
                items[f.name] = {
                    "name": f.name,
                    "title": f.stem,
                    "source": f"solvay-spark/pkg/markdown/{f.name}",
                    "full_path": str(f.resolve()),
                    "size": f.stat().st_size,
                    "chunks": 0,
                    "tokens": 0,
                    "is_indexed": False,
                    "indexed_at": None,
                }

    return sorted(items.values(), key=lambda x: (not x["is_indexed"], x["title"].lower()))


@app.get("/api/kb/files/{filename}")
def get_kb_file(filename: str) -> FileResponse:
    fname = Path(filename).name
    # 1. Check knowledge_base/
    target = (KNOWLEDGE_BASE / fname).resolve()
    if target.is_file() and KNOWLEDGE_BASE.resolve() in target.parents:
        return FileResponse(target, media_type="text/markdown")

    # 2. Check solvay-spark/pkg/markdown/
    target_pkg = (BASE / "solvay-spark" / "pkg" / "markdown" / fname).resolve()
    if target_pkg.is_file():
        return FileResponse(target_pkg, media_type="text/markdown")

    # 3. Check rag_documents source in database
    try:
        with rag.connect() as conn:
            row = conn.execute(
                "SELECT source FROM rag_documents WHERE source LIKE %s LIMIT 1",
                (f"%/{fname}",),
            ).fetchone()
            if row:
                db_path = Path(row[0]).resolve()
                if db_path.is_file():
                    return FileResponse(db_path, media_type="text/markdown")
    except Exception:
        pass

    raise HTTPException(404, f"File '{filename}' not found")


@app.delete("/api/kb/files/{filename}")
def delete_kb_file(filename: str) -> dict:
    fname = Path(filename).name
    deleted_db = False
    try:
        with rag.connect() as conn:
            with conn.transaction():
                res = conn.execute(
                    "DELETE FROM rag_documents WHERE source LIKE %s OR source = %s RETURNING id",
                    (f"%/{fname}", fname),
                ).fetchall()
                deleted_db = bool(res)
    except Exception:
        pass

    target = (KNOWLEDGE_BASE / fname).resolve()
    if target.is_file() and KNOWLEDGE_BASE.resolve() in target.parents:
        target.unlink(missing_ok=True)

    return {"status": "deleted", "filename": filename, "deleted_from_db": deleted_db}


@app.post("/api/kb/batch-insert")
def kb_batch_insert(files: list[UploadFile]) -> StreamingResponse:
    """Upload multiple .md files, save them to knowledge_base/, and embed them into pgvector."""
    if not files:
        raise HTTPException(400, "No files uploaded")

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
            with rag.connect() as conn:
                rag.create_schema(conn)

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

                        res = rag.index_file(conn, dest)
                        succeeded += 1
                        chunks = res.get("chunks", 0)
                        tokens = res.get("tokens", 0)
                        total_chunks += chunks
                        total_tokens += tokens

                        duplicates = [
                            _display_path(r[0])
                            for r in conn.execute(
                                "SELECT source FROM rag_documents WHERE title = %s AND source <> %s",
                                (res["title"], str(dest.resolve())),
                            ).fetchall()
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
                    row = conn.execute(
                        "SELECT (SELECT count(*) FROM rag_documents), (SELECT count(*) FROM rag_chunks)"
                    ).fetchone()
                    docs_count = int(row[0]) if row and row[0] is not None else succeeded
                    chunks_count = int(row[1]) if row and row[1] is not None else total_chunks
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
def embed_batch(batch_id: str) -> StreamingResponse:
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
            with rag.connect() as conn:
                rag.create_schema(conn)

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
                        dest.write_text(md_file.read_text(encoding="utf-8"), encoding="utf-8")

                        res = rag.index_file(conn, dest)
                        succeeded += 1
                        chunks = res.get("chunks", 0)
                        tokens = res.get("tokens", 0)
                        total_chunks += chunks
                        total_tokens += tokens

                        duplicates = [
                            _display_path(r[0])
                            for r in conn.execute(
                                "SELECT source FROM rag_documents WHERE title = %s AND source <> %s",
                                (res["title"], str(dest.resolve())),
                            ).fetchall()
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
                    row = conn.execute(
                        "SELECT (SELECT count(*) FROM rag_documents), (SELECT count(*) FROM rag_chunks)"
                    ).fetchone()
                    docs_count = int(row[0]) if row and row[0] is not None else succeeded
                    chunks_count = int(row[1]) if row and row[1] is not None else total_chunks
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
        "error": None,
    }
    if "DATABASE_URL" not in missing:
        try:
            with rag.connect() as conn:
                info["documents"], info["chunks"] = conn.execute(
                    "SELECT (SELECT count(*) FROM rag_documents), (SELECT count(*) FROM rag_chunks)"
                ).fetchone()
        except Exception as exc:  # no tables yet, server down, bad credentials
            info["error"] = str(exc).splitlines()[0]
    return info


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=rag.DEFAULT_K, ge=1, le=20)
    mode: str = "hybrid"


@app.post("/api/ask")
def ask(body: Question) -> StreamingResponse:
    """Run the pipeline and stream it as server-sent events: `stage` as each
    step starts and ends, `sources`, `token` while Claude writes, then `done`
    or `error`. A sync generator, so Starlette iterates it in the threadpool."""
    if body.mode not in rag.MODES:
        raise HTTPException(400, f"mode must be one of {rag.MODES}")

    def sse(event: str, data) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    def events():
        try:
            for event, data in rag.ask_events(body.question.strip(), body.k, body.mode):
                yield sse(event, data)
        # rag.py exits with a message when a key or DATABASE_URL is missing.
        except SystemExit as exc:
            yield sse("error", {"message": str(exc)})
        except Exception as exc:
            yield sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Hashed JS/CSS bundles of the built front end. check_dir=False so the API
# still starts before the first build.
app.mount("/assets", StaticFiles(directory=DIST / "assets", check_dir=False), name="assets")
