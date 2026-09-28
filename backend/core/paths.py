"""Where things are, relative to the repository root.

Modules used to find `.env`, `docs/`, `static/` and the corpus folders next to
themselves, which only worked while every module sat in the root. They now
live in backend/<domain>/, so the root is worked out once, here.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
KNOWLEDGE_GRAPH = DATA / "knowledge_graph.json"
