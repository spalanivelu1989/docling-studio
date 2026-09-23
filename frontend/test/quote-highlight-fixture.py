"""Rebuild the fixture quote-highlight.mjs runs against.

Run from the project root:  .venv/bin/python frontend/test/quote-highlight-fixture.py

Takes every quote the stored Evidence Agent runs cited, with the chunk it
names and the document that chunk was indexed from. Regenerate after a
re-index -- chunk ids move, and a fixture pinned to old ones would go on
passing while the feature broke.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import rag  # noqa: E402

OUT = Path(__file__).resolve().parent / "quote-highlight.fixture.json"


def check_helpers_agree() -> None:
    """The .mjs copies locateRegex out of Markdown.tsx; warn if they drifted."""
    page = (ROOT / "frontend/src/components/Markdown.tsx").read_text()
    test = (ROOT / "frontend/test/quote-highlight.mjs").read_text()

    def split_line(text: str) -> str | None:
        m = re.search(r"\.split\((/.*?/gm)\)", text)
        return m.group(1) if m else None

    if split_line(page) != split_line(test):
        print("WARNING: locateRegex in Markdown.tsx and quote-highlight.mjs have drifted")
        print(f"  source: {split_line(page)}")
        print(f"  test: {split_line(test)}")


def main() -> int:
    check_helpers_agree()
    conn = rag.connection()
    rows = conn.execute(
        "SELECT answer FROM evidence_runs WHERE status = 'done' AND answer IS NOT NULL"
    ).fetchall()
    out, seen = [], set()
    for (answer,) in rows:
        for claim in (answer or {}).get("claims", []):
            for src in claim.get("sources", []):
                cid, quote = src.get("chunk_id"), src.get("quote")
                if not cid or not quote or (cid, quote) in seen:
                    continue
                seen.add((cid, quote))
                chunk = rag.chunk(cid)
                if not chunk:
                    continue  # a stale citation is the inspector's problem, not this one
                path = Path(chunk["source"])
                if not path.exists():
                    continue
                out.append({"chunk_id": cid, "quote": quote,
                            "chunk": chunk["content"],
                            "doc": path.read_text(errors="replace")})
    OUT.write_text(json.dumps(out))
    print(f"{len(out)} cited quotes written to {OUT.relative_to(ROOT)}"
          f" ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
