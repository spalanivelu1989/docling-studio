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
import time
import uuid
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
ACCEPTED = {".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".pdf"} | preview.IMAGE_FORMATS

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


@app.get("/ask", response_class=HTMLResponse)
def ask_page() -> HTMLResponse:
    return _spa()


@app.get("/api/rag/status")
def rag_status() -> dict:
    """What the Ask page needs to know before the first question."""
    missing = [
        name
        for name, present in (
            ("COHERE_API_KEY", os.environ.get("COHERE_API_KEY") or os.environ.get("CO_API_KEY")),
            ("ANTHROPIC_API_KEY", os.environ.get("ANTHROPIC_API_KEY")),
            ("DATABASE_URL", os.environ.get("DATABASE_URL")),
        )
        if not present
    ]
    info = {
        "missing": missing,
        "embed_model": rag.EMBED_MODEL,
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
