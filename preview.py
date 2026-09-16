"""Render a document to per-page PNGs so the browser can show the original.

There is no good pure-JS renderer for the kind of PowerPoint this pipeline
targets -- decks whose content is flowcharts built from native shapes and
connectors. LibreOffice renders them faithfully, so the preview path is
LibreOffice -> PDF -> per-page PNG.

Note this is deliberately two hops: `--convert-to png` exports only the *first*
slide of a presentation, so the PDF intermediate is required to get every page.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

# LibreOffice on macOS lives inside the app bundle rather than on PATH.
_SOFFICE_CANDIDATES = (
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
)
PREVIEW_DPI = 90
CONVERT_TIMEOUT = 300

# A standalone image is already its own single page: no LibreOffice, no PDF.
IMAGE_FORMATS = {".png", ".jpg", ".jpeg"}


class PreviewError(RuntimeError):
    pass


def find_soffice() -> str | None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    return next((p for p in _SOFFICE_CANDIDATES if Path(p).exists()), None)


def find_pdftoppm() -> str | None:
    return shutil.which("pdftoppm")


def available() -> bool:
    return bool(find_soffice() and find_pdftoppm())


def _to_pdf(src: Path, out_dir: Path) -> Path:
    soffice = find_soffice()
    if not soffice:
        raise PreviewError(
            "LibreOffice not found. Install it with: brew install --cask libreoffice"
        )
    # Give each job its own user profile: concurrent soffice invocations that
    # share the default profile will silently refuse to start.
    profile = (out_dir / "lo-profile").resolve().as_uri()
    proc = subprocess.run(
        [
            soffice,
            "--headless",
            "--norestore",
            f"-env:UserInstallation={profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir),
            str(src),
        ],
        capture_output=True,
        text=True,
        timeout=CONVERT_TIMEOUT,
    )
    pdfs = list(out_dir.glob("*.pdf"))
    if not pdfs:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise PreviewError(f"LibreOffice produced no PDF for {src.name}. {detail}")
    return pdfs[0]


def _to_pngs(pdf: Path, out_dir: Path, dpi: int) -> list[Path]:
    pdftoppm = find_pdftoppm()
    if not pdftoppm:
        raise PreviewError("pdftoppm not found. Install it with: brew install poppler")
    proc = subprocess.run(
        [pdftoppm, "-png", "-r", str(dpi), str(pdf), str(out_dir / "page")],
        capture_output=True,
        text=True,
        timeout=CONVERT_TIMEOUT,
    )
    # pdftoppm pads the page number to the width of the highest page, so the
    # filenames differ between a 9-page and a 144-page document. Sort the actual
    # output rather than reconstructing names.
    pages = sorted(out_dir.glob("page-*.png"))
    if not pages:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise PreviewError(f"pdftoppm produced no images. {detail}")
    return pages


def image_to_png(src: Path, dest: Path) -> None:
    """Write an uploaded image as an upright, opaque PNG.

    Phone photos record their rotation in EXIF rather than in the pixels, and
    screenshots often carry transparency. Left alone, the first reads as a
    sideways page and the second as text on a black background -- both of which
    OCR and the vision model then misread.
    """
    from PIL import Image, ImageOps

    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            backdrop = Image.new("RGBA", im.size, (255, 255, 255, 255))
            im = Image.alpha_composite(backdrop, im)
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.convert("RGB").save(dest, "PNG")


def render(src: Path, out_dir: Path, dpi: int = PREVIEW_DPI) -> int:
    """Render every page of `src` into out_dir as page-0001.png ... Returns count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in IMAGE_FORMATS:
        image_to_png(src, page_path(out_dir, 1))
        return 1
    work = out_dir / ".work"
    work.mkdir(exist_ok=True)
    try:
        pdf = src if src.suffix.lower() == ".pdf" else _to_pdf(src, work)
        pages = _to_pngs(pdf, work, dpi)
        # Renumber to a fixed width so the API can address pages by index.
        for index, page in enumerate(pages, start=1):
            page.replace(out_dir / f"page-{index:04d}.png")
        return len(pages)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def page_path(out_dir: Path, number: int) -> Path:
    return out_dir / f"page-{number:04d}.png"
