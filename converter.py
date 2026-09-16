"""Document -> Markdown conversion, shared by the CLI and the web API.

Docling reads native text out of OOXML directly, but it has no OCR on the
Office paths -- embedded raster images arrive as bare `<!-- image -->`
placeholders. This module converts the document, pulls the embedded media out
of the package, OCRs each image with Tesseract (see pptx_ocr), and splices the
recovered text back in at the matching placeholder.
"""

from __future__ import annotations

import re
import shutil
import sys
import time
import warnings
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from docling.document_converter import DocumentConverter

import flow_cv
import table_cv
import vlm_api
import vlm_ocr
from preview import IMAGE_FORMATS, image_to_png
from pptx_flow import slide_flows
from pptx_ocr import DEFAULT_SCALE, OcrResult, default_tessdata, gray_image, read, read_image
from xlsx_tables import sheet_count, workbook_to_markdown

warnings.filterwarnings("ignore", category=UserWarning)

# Spreadsheets take a dedicated path: Docling splits a sheet on blank rows,
# which orphans the header row from its data. See xlsx_tables.
SPREADSHEET_FORMATS = {".xlsx", ".xlsm"}

PLACEHOLDER = "<!-- image -->"

# Who reads dense images when the vision model is switched on: Qwen3-VL on this
# machine, or a cloud model reached through Docling's VLM pipeline (vlm_api).
VLM_PROVIDERS = ("qwen", *vlm_api.PROVIDERS)
_RELS = re.compile(r'Target="\.\./media/([^"]+)"')
# Office packages park embedded raster media under a per-format prefix.
_MEDIA_PREFIXES = ("ppt/media/", "word/media/", "xl/media/")

_converter: DocumentConverter | None = None


def _docling() -> DocumentConverter:
    """Reuse one DocumentConverter; building it re-reads backend config."""
    global _converter
    if _converter is None:
        _converter = DocumentConverter()
    return _converter


@dataclass
class OcrBlock:
    page: int | None
    image: str
    confidence: float
    chars: int


@dataclass
class Result:
    markdown: str
    pages: int
    pictures: int
    unit: str = "pages"
    skipped_images: int = 0
    vlm_images: int = 0
    flows: int = 0
    flow_images: int = 0
    # Images whose tables or flow were recovered by image processing.
    table_images: int = 0
    cv_flow_images: int = 0
    ocr_blocks: list[OcrBlock] = field(default_factory=list)
    elapsed: float = 0.0


# Said plainly because the numbers are not good enough to imply otherwise:
# measured against the connector ground truth in these decks the model finds
# roughly half the arrows, and roughly a third of the arrows it does draw are
# wrong. Useful as a starting point, not as a record of the process.
FLOW_CAVEAT = (
    "Flow read from the image by the local vision model. DRAFT -- on this "
    "corpus it recovers about half the arrows and about a third of the arrows "
    "it draws are wrong, so check every one against the image before relying "
    "on it. The box labels below are read by OCR and are reliable."
)


def _flow_block(flow: str, ocr_text: str) -> str:
    """Render a recovered diagram: the draft graph, then the labels."""
    parts = [f"<!-- {FLOW_CAVEAT} -->", "", "```mermaid", flow, "```"]
    if ocr_text.strip():
        parts += ["", "<!-- labels read from the image via tesseract -->", "",
                  ocr_text]
    return "\n".join(parts)


CV_FLOW_CAVEAT = (
    "Flow traced from the image by image processing (shapes, connector lines "
    "and arrowheads). DRAFT -- on rendered process slides it recovers about "
    "60% of the arrows, and about 1 in 5 of the arrows it draws is wrong; "
    "dashed arrows are missed. Check it against the original. The box labels "
    "below are read by OCR."
)


def _cv_flow_block(name: str, flow: str, ocr_text: str) -> str:
    parts = [f"<!-- {name}: {CV_FLOW_CAVEAT} -->", "", "```mermaid", flow, "```"]
    if ocr_text.strip():
        parts += ["", "<!-- labels read from the image via tesseract -->", "", ocr_text]
    return "\n".join(parts)


def slide_media_map(src: Path) -> dict[int, list[str]]:
    """Map slide number -> embedded media filenames, from the pptx slide rels.

    Only PowerPoint gives us a reliable page mapping this way; other formats
    fall back to matching pictures against media in document order.
    """
    out: dict[int, list[str]] = {}
    try:
        with zipfile.ZipFile(src) as z:
            for name in z.namelist():
                m = re.fullmatch(r"ppt/slides/_rels/slide(\d+)\.xml\.rels", name)
                if not m:
                    continue
                targets = _RELS.findall(z.read(name).decode("utf-8", "replace"))
                if targets:
                    out[int(m.group(1))] = targets
    except (zipfile.BadZipFile, KeyError):
        pass
    return out


def extract_media(src: Path, dest: Path) -> list[str]:
    """Copy embedded media out of the OOXML package. Returns names in order."""
    names: list[str] = []
    try:
        with zipfile.ZipFile(src) as z:
            for name in sorted(z.namelist()):
                if not name.startswith(_MEDIA_PREFIXES):
                    continue
                dest.mkdir(parents=True, exist_ok=True)
                with z.open(name) as fh, open(dest / Path(name).name, "wb") as out:
                    shutil.copyfileobj(fh, out)
                names.append(Path(name).name)
    except (zipfile.BadZipFile, KeyError):
        pass
    return names


def pdf_page_images(src: Path, dest: Path, dpi: int = 150) -> dict[int, list[str]]:
    """Render PDF pages to PNGs so scanned pages can be read like any image.

    A PDF is not an OOXML package, so `extract_media` finds nothing in it and
    an image-only PDF would reach neither Tesseract nor the vision model --
    Docling's own OCR is left to carry the whole page alone. Rendering each
    page puts scanned PDFs back on the same footing as a pasted screenshot.
    """
    import preview

    try:
        count = preview.render(src, dest, dpi=dpi)
    except Exception as exc:
        print(f"  ! could not render {src.name}: {exc}", file=sys.stderr)
        return {}
    return {n: [f"page-{n:04d}.png"] for n in range(1, count + 1)}


def _splice(md: str, blocks: list[str]) -> str:
    """Replace each `<!-- image -->` placeholder, in order, with its OCR block.

    The blocks carry only what was read from the image, never the image itself.
    """
    parts = md.split(PLACEHOLDER)
    out = parts[0]
    for i, tail in enumerate(parts[1:]):
        out += (blocks[i] if i < len(blocks) else PLACEHOLDER) + tail
    return out


class _ImageReader:
    """Turns one image into a Markdown block: OCR first, vision model if asked.

    Shared by images embedded in a document and images uploaded on their own,
    so a screenshot reads the same whichever way it arrives. Decks reuse the
    same logo or diagram across many slides, so every stage is cached by
    filename rather than re-reading identical bytes.
    """

    def __init__(
        self,
        media_dir: Path,
        result: Result,
        *,
        use_vlm: bool,
        vlm_provider: str = "qwen",
        lang: str,
        tessdata: str | None,
        scale: int,
    ) -> None:
        self.media_dir = media_dir
        self.result = result
        self.use_vlm = use_vlm
        self.vlm_provider = vlm_provider
        self.lang = lang
        self.tessdata = tessdata or default_tessdata()
        self.scale = scale
        self.ocr_cache: dict[str, OcrResult] = {}
        self.vlm_cache: dict[str, str] = {}
        self.flow_cache: dict[str, str | None] = {}
        self.structure_cache: dict[str, str | None] = {}

    def block(self, name: str, page: int | None, allow_flow: bool = True) -> str:
        path = self.media_dir / name
        if name in self.ocr_cache:
            found = self.ocr_cache[name]
        else:
            try:
                found = read(path, lang=self.lang, tessdata=self.tessdata, scale=self.scale)
            except Exception as exc:  # one bad image must not kill the run
                print(f"  ! OCR failed on {name}: {exc}", file=sys.stderr)
                return PLACEHOLDER
            self.ocr_cache[name] = found

        if self.use_vlm and found.is_text and self._vlm_available():
            try:
                better = self._vision(path, name, found, allow_flow)
                if better:
                    return better
            except Exception as exc:
                print(f"  ! VLM failed on {name}: {exc}", file=sys.stderr)

        if found.is_text:
            try:
                structured = self._structure(path, name, found, allow_flow)
                if structured:
                    return structured
            except Exception as exc:
                print(f"  ! structure detection failed on {name}: {exc}", file=sys.stderr)
            self.result.ocr_blocks.append(
                OcrBlock(page, name, found.confidence, len(found.text))
            )
            return (
                f"<!-- OCR of {name} via tesseract, mean confidence "
                f"{found.confidence:.1f} -->\n\n{found.text}"
            )
        # Photos, icons and gradients yield confident-looking gibberish; keep
        # let none of that text into the Markdown.
        self.result.skipped_images += 1
        return f"<!-- no readable text in {name} (OCR confidence {found.confidence:.1f}) -->"

    def _structure(
        self, path: Path, name: str, found: OcrResult, allow_flow: bool
    ) -> str | None:
        """Flow or tables recovered by image processing, or None to keep plain OCR.

        Tesseract alone returns a table's words with the rows run together and
        a diagram's labels with no arrows. The drawn lines hold that structure:
        see flow_cv and table_cv.
        """
        if name in self.structure_cache:
            return self.structure_cache[name]
        import numpy as np
        from PIL import ImageDraw

        img = gray_image(path)
        gray = np.array(img)
        block = None
        flow = flow_cv.find_flow(gray, self.lang, self.tessdata)
        if flow:
            # A slide whose arrows came from real connectors keeps those; the
            # picture's labels are still worth having.
            if allow_flow:
                self.result.cv_flow_images += 1
                block = _cv_flow_block(name, flow.to_mermaid(), found.text)
        else:
            tables = table_cv.find_tables(gray, self.lang, self.tessdata)
            if tables:
                self.result.table_images += 1
                # Read what lies outside the tables separately, so their text
                # is not repeated as loose lines.
                draw = ImageDraw.Draw(img)
                for t in tables:
                    draw.rectangle((t.left, t.top, t.right, t.bottom), fill=255)
                rest = read_image(img, lang=self.lang, tessdata=self.tessdata, scale=self.scale)
                parts = [f"<!-- tables in {name} read by image processing + tesseract -->"]
                if rest.is_text:
                    parts.append(rest.text)
                parts += [t.to_markdown() for t in tables]
                block = "\n\n".join(parts)
        self.structure_cache[name] = block
        return block

    def _vlm_available(self) -> bool:
        if self.vlm_provider == "qwen":
            return vlm_ocr.available()
        return vlm_api.available(self.vlm_provider)

    def _vision(
        self, path: Path, name: str, found: OcrResult, allow_flow: bool
    ) -> str | None:
        """The vision model's reading, or None when Tesseract's should stand.

        Tesseract reads glyphs, not structure: on a table screenshot it returns
        high confidence and scrambled rows. Dense images go to the local vision
        model instead, which reads tables as tables and diagrams as flows.
        """
        from PIL import Image

        with Image.open(path) as im:
            wide, high = im.size
        if not vlm_ocr.should_use(found.words, wide, high):
            return None

        # A flattened diagram is the one case where the arrows are not recorded
        # anywhere in the file, so a picture is all there is to read them from.
        # Only the local model traces flows; a cloud model reads the image as
        # Markdown, and flows are left to image processing (flow_cv).
        if allow_flow and found.is_diagram and self.vlm_provider == "qwen":
            if name not in self.flow_cache:
                self.flow_cache[name] = vlm_ocr.read_flow(path)
            flow = self.flow_cache[name]
            if flow:
                self.result.flow_images += 1
                return _flow_block(flow, found.text)

        if name not in self.vlm_cache:
            if self.vlm_provider == "qwen":
                self.vlm_cache[name] = vlm_ocr.read(path)
            else:
                self.vlm_cache[name] = vlm_api.read(path, self.vlm_provider)
        better = self.vlm_cache[name]
        if vlm_ocr.is_better_than(better, found.text):
            self.result.vlm_images += 1
            if self.vlm_provider == "qwen":
                source = "Qwen3-VL (local vision model)"
            else:
                source = f"{vlm_api.label(self.vlm_provider)} via Docling's VLM pipeline"
            return f"<!-- {name} read by {source} -->\n\n{better}"
        return None


def _convert_image(
    src: Path,
    media_dir: Path | None,
    started: float,
    *,
    ocr: bool,
    use_vlm: bool,
    vlm_provider: str,
    title: str | None,
    lang: str,
    tessdata: str | None,
    scale: int,
) -> Result:
    """Convert a standalone PNG or JPEG: it is one picture on one page.

    Docling's own image pipeline is built for scanned full pages and runs its
    layout model over the whole thing, which is exactly what mangles screenshots
    and diagrams (see pptx_ocr). An uploaded image takes the same path as an
    image found inside a slide instead.
    """
    result = Result(markdown="", pages=1, pictures=1, unit="image")
    heading = f"# {title or src.stem}\n\n"
    if not ocr or media_dir is None:
        result.markdown = heading + PLACEHOLDER + "\n"
    else:
        # Normalised copy: upright and opaque, so OCR and the model see what a
        # person sees. Always PNG, whatever was uploaded.
        name = "image.png"
        image_to_png(src, media_dir / name)
        reader = _ImageReader(
            media_dir, result,
            use_vlm=use_vlm, vlm_provider=vlm_provider,
            lang=lang, tessdata=tessdata, scale=scale,
        )
        result.markdown = heading + reader.block(name, None) + "\n"
    result.elapsed = time.perf_counter() - started
    return result


def convert(
    src: Path,
    media_dir: Path | None = None,
    ocr: bool = True,
    use_vlm: bool = False,
    vlm_provider: str = "qwen",
    flows: bool = True,
    title: str | None = None,
    lang: str = "eng",
    tessdata: str | None = None,
    scale: int = DEFAULT_SCALE,
) -> Result:
    """Convert a document to Markdown, OCR-ing any embedded raster images.

    Images are extracted into `media_dir` only so they can be read; the
    Markdown carries the text read from them, not links to the images.

    `vlm_provider` picks the vision model used when `use_vlm` is on: "qwen"
    (local), "openai" or "claude" (sent to that API, see vlm_api).
    """
    if vlm_provider not in VLM_PROVIDERS:
        raise ValueError(f"vlm_provider must be one of {VLM_PROVIDERS}, not {vlm_provider!r}")
    if use_vlm and vlm_provider != "qwen" and not vlm_api.available(vlm_provider):
        print(
            f"  ! {vlm_api.PROVIDERS[vlm_provider].key_env} is not set; "
            "images are read without the vision model",
            file=sys.stderr,
        )
    started = time.perf_counter()
    if src.suffix.lower() in SPREADSHEET_FORMATS:
        return Result(
            markdown=workbook_to_markdown(src, title=title),
            pages=sheet_count(src),
            pictures=0,
            unit="sheets",
            elapsed=time.perf_counter() - started,
        )

    if src.suffix.lower() in IMAGE_FORMATS:
        return _convert_image(
            src, media_dir, started,
            ocr=ocr, use_vlm=use_vlm, vlm_provider=vlm_provider, title=title,
            lang=lang, tessdata=tessdata, scale=scale,
        )

    doc = _docling().convert(src).document
    md = doc.export_to_markdown()
    result = Result(markdown=md, pages=len(doc.pages), pictures=len(doc.pictures))

    # PowerPoint records each arrow's endpoints, so a deck's flowcharts can be
    # rebuilt exactly rather than guessed at from the rendered pixels. Do this
    # before the images: where real connectors exist they beat anything read
    # back off a picture, and they tell the image loop which slides it must not
    # second-guess with the vision model.
    diagrams: dict[int, str] = {}
    if flows and src.suffix.lower() in {".pptx", ".ppt"}:
        diagrams = slide_flows(src)

    if doc.pictures and ocr and media_dir is not None:
        tessdata = tessdata or default_tessdata()
        if src.suffix.lower() == ".pdf":
            # No OOXML media in a PDF; the rendered page *is* the image.
            by_slide = pdf_page_images(src, media_dir)
            available = [n for names in by_slide.values() for n in names]
        else:
            available = extract_media(src, media_dir)
            by_slide = slide_media_map(src)
        blocks: list[str] = []
        reader = _ImageReader(
            media_dir, result,
            use_vlm=use_vlm, vlm_provider=vlm_provider,
            lang=lang, tessdata=tessdata, scale=scale,
        )

        # A slide can hold several pictures, so track how many we have already
        # taken from each one; using the slide's first image every time would
        # OCR it repeatedly and never touch the others.
        taken: dict[int, int] = {}

        for index, pic in enumerate(doc.pictures):
            page = pic.prov[0].page_no if pic.prov else None
            named = by_slide.get(page) if page is not None else None
            if named:
                nth = taken.get(page, 0)
                taken[page] = nth + 1
                name = named[nth] if nth < len(named) else None
            else:
                # No rels mapping (docx, xlsx): assume pictures and media
                # appear in the same order within the package.
                name = available[index] if index < len(available) else None
            if not name or not (media_dir / name).exists():
                blocks.append(PLACEHOLDER)
                continue

            # Slides whose arrows came from real connectors are left alone:
            # pptx_flow is exact and the vision model is not.
            blocks.append(reader.block(name, page, allow_flow=page not in diagrams))

        result.markdown = _splice(md, blocks)

    if diagrams:
        parts = [
            "\n\n## Process flows",
            "",
            "_Recovered from the PowerPoint connector shapes, which record "
            "which box each arrow joins._",
        ]
        for number in sorted(diagrams):
            parts += [f"\n### Slide {number}", "", "```mermaid", diagrams[number], "```"]
        result.markdown += "\n".join(parts) + "\n"
        result.flows = len(diagrams)

    result.elapsed = time.perf_counter() - started
    return result
