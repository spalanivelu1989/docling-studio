"""Convert every xlsx, pptx, docx, png and jpeg file in a folder to Markdown.

    python folder_to_md.py input_folder          # writes input_folder/markdown/
    python folder_to_md.py input_folder --vlm
    python folder_to_md.py input_folder --vlm-provider claude   # or openai
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from converter import VLM_PROVIDERS, convert

FORMATS = {".xlsx", ".pptx", ".docx", ".png", ".jpg", ".jpeg"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", type=Path)
    ap.add_argument("-o", "--out-dir", type=Path, help="default: <folder>/markdown")
    ap.add_argument("--vlm", action="store_true", help="use the vision model (slower)")
    ap.add_argument(
        "--vlm-provider", choices=VLM_PROVIDERS, default="qwen",
        help="qwen = local Qwen3-VL (default); openai / claude = send images to that API "
        "through Docling (needs OPENAI_API_KEY / ANTHROPIC_API_KEY). Implies --vlm.",
    )
    args = ap.parse_args()
    use_vlm = args.vlm or args.vlm_provider != "qwen"

    out_dir = args.out_dir or args.folder / "markdown"
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(
        p for p in args.folder.iterdir()
        if p.is_file() and p.suffix.lower() in FORMATS and not p.name.startswith("~$")
    )

    failed = 0
    for i, src in enumerate(files, 1):
        print(f"[{i}/{len(files)}] Converting {src.name} ...")
        try:
            # Images are extracted only to be read, so each file gets a
            # throwaway media folder (image1.png would clash across files).
            with tempfile.TemporaryDirectory() as media:
                result = convert(
                    src, media_dir=Path(media), use_vlm=use_vlm, vlm_provider=args.vlm_provider
                )
        except Exception as exc:
            failed += 1
            print(f"  ! failed: {exc}")
            continue
        dest = out_dir / f"{src.stem}{src.suffix.lower().replace('.', '_')}.md"
        dest.write_text(result.markdown)
        print(f"  {result.pages} {result.unit}, {result.pictures} image(s): "
              f"{len(result.ocr_blocks)} OCR, {result.table_images} tables, "
              f"{result.cv_flow_images} flows, {result.vlm_images + result.flow_images} vision model, "
              f"{result.skipped_images} no text")
        print(f"  -> {dest} ({result.elapsed:.1f}s)")

    print(f"Done: {len(files) - failed} converted, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
