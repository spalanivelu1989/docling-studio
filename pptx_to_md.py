"""CLI front-end for the converter. The web UI (app.py) shares the same core.

    python pptx_to_md.py P2P.pptx -o out
"""

from __future__ import annotations

import argparse
from pathlib import Path

from converter import VLM_PROVIDERS, convert
from pptx_ocr import DEFAULT_SCALE, default_tessdata


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("document", type=Path)
    ap.add_argument("-o", "--out-dir", type=Path, default=Path("out"))
    ap.add_argument("--lang", default="eng", help="Tesseract languages, e.g. eng+deu")
    ap.add_argument("--tessdata", default=None)
    ap.add_argument(
        "--scale",
        type=int,
        default=DEFAULT_SCALE,
        help="upscale factor applied before OCR (slide crops are low-res)",
    )
    ap.add_argument("--no-ocr", action="store_true")
    ap.add_argument(
        "--no-flows",
        action="store_true",
        help="skip rebuilding flowcharts from PowerPoint connector shapes",
    )
    ap.add_argument(
        "--vlm",
        action="store_true",
        help="read dense images with the local vision model: recovers table "
        "structure from screenshots, and traces arrows in flattened process "
        "diagrams into a draft Mermaid graph. Much slower.",
    )
    ap.add_argument(
        "--vlm-provider", choices=VLM_PROVIDERS, default="qwen",
        help="qwen = local Qwen3-VL (default); openai / claude = send images to that API "
        "through Docling (needs OPENAI_API_KEY / ANTHROPIC_API_KEY). Implies --vlm.",
    )
    args = ap.parse_args()

    src = args.document.resolve()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Converting {src.name} ...")
    result = convert(
        src,
        media_dir=out_dir / "media",
        ocr=not args.no_ocr,
        use_vlm=args.vlm or args.vlm_provider != "qwen",
        vlm_provider=args.vlm_provider,
        flows=not args.no_flows,
        lang=args.lang,
        tessdata=args.tessdata or default_tessdata(),
        scale=args.scale,
    )
    print(f"  {result.pages} pages, {result.pictures} embedded image(s)")
    if result.flows:
        print(f"  {result.flows} slide flow(s) rebuilt from connectors")
    if result.flow_images:
        print(f"  {result.flow_images} flattened diagram(s) traced by the vision "
              f"model (DRAFT -- check the arrows)")
    if result.table_images:
        print(f"  tables recovered by image processing in {result.table_images} image(s)")
    if result.cv_flow_images:
        print(f"  {result.cv_flow_images} flattened diagram(s) traced by image processing "
              f"(DRAFT -- check the arrows)")
    if result.vlm_images:
        print(f"  {result.vlm_images} image(s) read by the local vision model")
    for block in result.ocr_blocks:
        where = f"slide {block.page}" if block.page is not None else "image"
        print(f"  OCR {where} <- {block.image} (mean conf {block.confidence:.1f})")

    dest = out_dir / f"{src.stem}.md"
    dest.write_text(result.markdown)
    print(f"Wrote {dest} ({len(result.markdown):,} chars) in {result.elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
