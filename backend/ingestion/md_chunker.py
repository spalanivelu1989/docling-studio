"""Split the converted Markdown files into chunks for retrieval.

The files come out of converter.py, so their structure is known: headings
(slide titles, sheet names, document sections), paragraphs, Markdown tables
from spreadsheets and Word, ```mermaid flowcharts, and HTML comments saying how
an image was read. The chunker follows that structure instead of cutting every
N characters:

1. The text is parsed into blocks -- heading, paragraph, table, code fence --
   and the provenance comments are dropped (they say which OCR engine ran, not
   what the document says).
2. A heading starts a new chunk, so a chunk is a section: one slide, one sheet,
   one numbered chapter. A section too small to answer anything on its own (a
   slide title, "Role = ...") is joined to the section after it.
3. A section is cut between blocks once a chunk reaches TARGET_TOKENS. A block
   that is itself too large is cut on its own boundaries: a table between rows
   into even pieces, with the header row repeated on every piece; a flowchart
   between lines, still inside a ```mermaid fence; a paragraph between
   sentences.
4. Every chunk keeps the document title and the heading path it sits under.
   That text is put in front of the chunk when it is embedded, so a table row
   saying only "OK | Lorenzo Zabala" is still found by a question about the
   L4 validation file.

Sizes are in tokens estimated as characters / 4, which is close enough for
English prose and errs large for tables. Nothing overlaps: pieces are cut on
structural boundaries and carry their headings, which is what overlap would
otherwise be there to supply.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from pathlib import Path

TARGET_TOKENS = 500  # stop adding blocks to a chunk once it reaches this
MAX_TOKENS = 1000  # no chunk is larger, except a single table row or line that is
MIN_TOKENS = 120  # a section smaller than this is joined to the next one

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# A leading `---` block carries metadata for the indexer (rag.py reads the
# category out of it), not text anyone asked a question about.
_FRONT_MATTER = re.compile(r"\A---\r?\n.*?\r?\n---\r?\n", re.S)
_SENTENCE_END = re.compile(r"(?<=[.!?;])\s+")
# The converter names files "<original stem>_<extension>.md".
_SOURCE_KIND = re.compile(r"^(.*)_(pptx|docx|xlsx|pdf|png|jpe?g)$", re.I)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


@dataclass
class Block:
    kind: str  # heading | paragraph | table | code
    text: str
    level: int = 0  # heading level


@dataclass
class Chunk:
    source: str  # file name of the .md
    title: str  # the original document, e.g. "Energy production cycle (pptx)"
    index: int
    headings: list[str]
    content: str
    tokens: int = field(init=False)

    def __post_init__(self):
        self.tokens = estimate_tokens(self.content)

    @property
    def heading_path(self) -> str:
        return " / ".join(self.headings)

    def embedding_text(self) -> str:
        """What is sent to the embedding model: context first, then the text."""
        return with_context(self.title, self.heading_path, self.content)


def with_context(title: str, heading_path: str, content: str) -> str:
    lines = [f"Document: {title}"]
    if heading_path:
        lines.append(f"Section: {heading_path}")
    return "\n".join(lines) + "\n\n" + content


def document_title(path: Path) -> str:
    m = _SOURCE_KIND.match(path.stem)
    return f"{m.group(1).strip()} ({m.group(2).lower()})" if m else path.stem


# --- parsing -----------------------------------------------------------------


def _strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def _strip_front_matter(text: str) -> str:
    return _FRONT_MATTER.sub("", text, count=1)


def parse_blocks(text: str) -> list[Block]:
    lines = _strip_comments(_strip_front_matter(text)).splitlines()
    blocks: list[Block] = []
    para: list[str] = []

    def flush_para():
        if para:
            blocks.append(Block("paragraph", html.unescape("\n".join(para))))
            para.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_para()
            fence = [line]
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                fence.append(lines[i])
                i += 1
            fence.append("```")  # also closes a fence left open at end of file
            blocks.append(Block("code", html.unescape("\n".join(fence))))
        elif stripped.startswith("|"):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            blocks.append(Block("table", html.unescape(_drop_empty_columns(rows))))
            continue
        elif m := _HEADING.match(stripped):
            flush_para()
            if m.group(2):
                blocks.append(Block("heading", html.unescape(m.group(2)), len(m.group(1))))
        elif not stripped:
            flush_para()
        else:
            para.append(stripped)
        i += 1
    flush_para()
    return blocks


def _cells(row: str) -> list[str]:
    return [c.strip() for c in row.strip().strip("|").split("|")]


def _is_separator(row: str) -> bool:
    return bool(re.fullmatch(r"\|?[\s:\-|]+\|?", row)) and "-" in row


def _drop_empty_columns(rows: list[str]) -> str:
    """Remove spreadsheet columns that have no values ("col10" and blanks)."""
    has_separator = len(rows) > 1 and _is_separator(rows[1])
    table = [_cells(r) for r in rows]
    width = max(len(r) for r in table)
    table = [r + [""] * (width - len(r)) for r in table]
    body = [r for k, r in enumerate(table) if not (k == 1 and has_separator)]
    header, data = body[0], body[1:]
    keep = [
        c
        for c in range(width)
        if any(r[c] for r in data) or (header[c] and not re.fullmatch(r"col\d+", header[c]))
    ]
    if not keep:
        return ""
    out = []
    for k, r in enumerate(table):
        if k == 1 and has_separator:
            out.append("| " + " | ".join("---" for _ in keep) + " |")
        else:
            out.append("| " + " | ".join(r[c] for c in keep) + " |")
    return "\n".join(out)


# --- splitting blocks that are too large on their own ------------------------


def _split_table(text: str) -> list[str]:
    rows = text.splitlines()
    head = rows[:2] if len(rows) > 1 and _is_separator(rows[1]) else rows[:1]
    head_text = "\n".join(head)
    # Even pieces: 1300 tokens becomes 3 x ~430, not 500 + 500 + 300.
    total = estimate_tokens(text)
    per_piece = total / -(-total // TARGET_TOKENS)
    pieces, current = [], []
    size = estimate_tokens(head_text)
    for row in rows[len(head) :]:
        row_tokens = estimate_tokens(row)
        if current and size + row_tokens > per_piece:
            pieces.append("\n".join([head_text, *current]))
            current, size = [], estimate_tokens(head_text)
        current.append(row)
        size += row_tokens
    if current:
        pieces.append("\n".join([head_text, *current]))
    return pieces or [text]


def _split_code(text: str) -> list[str]:
    lines = text.splitlines()
    opening, body = lines[0], lines[1:-1]
    # Keep "flowchart LR" on every piece so each still reads as a flowchart.
    keep = body[:1] if body and re.match(r"(flowchart|graph)\b", body[0].strip()) else []
    pieces, current = [], []
    for line in body[len(keep) :]:
        if current and estimate_tokens("\n".join(current + [line])) > TARGET_TOKENS:
            pieces.append("\n".join([opening, *keep, *current, "```"]))
            current = []
        current.append(line)
    if current:
        pieces.append("\n".join([opening, *keep, *current, "```"]))
    return pieces or [text]


def _split_paragraph(text: str) -> list[str]:
    pieces, current = [], ""
    for sentence in _SENTENCE_END.split(text):
        # A "sentence" with no punctuation (a run-on OCR line) is cut by length.
        while estimate_tokens(sentence) > TARGET_TOKENS:
            cut = sentence.rfind(" ", 0, TARGET_TOKENS * 4)
            cut = cut if cut > 0 else TARGET_TOKENS * 4
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut])
            sentence = sentence[cut:].lstrip()
        if current and estimate_tokens(current + " " + sentence) > TARGET_TOKENS:
            pieces.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def _fit(block: Block) -> list[Block]:
    # Table rows are separate facts, so tables are cut at the target size;
    # prose and flowcharts only when they would not fit at all.
    limit = TARGET_TOKENS if block.kind == "table" else MAX_TOKENS
    if estimate_tokens(block.text) <= limit:
        return [block]
    split = {"table": _split_table, "code": _split_code}.get(block.kind, _split_paragraph)
    return [Block(block.kind, piece) for piece in split(block.text)]


# --- grouping blocks into chunks ---------------------------------------------


def _sections(blocks: list[Block]) -> list[list[Block]]:
    """A heading plus everything up to the next heading."""
    sections: list[list[Block]] = []
    for block in blocks:
        if block.kind == "heading" or not sections:
            sections.append([block])
        else:
            sections[-1].append(block)
    return sections


def _join_small(sections: list[list[Block]]) -> list[list[Block]]:
    """Join each section under MIN_TOKENS onto the one after it (the last onto
    the one before), so a slide title stays with the slide's content."""
    joined: list[list[Block]] = []
    carry: list[Block] = []
    for section in sections:
        section = carry + section
        small = sum(estimate_tokens(b.text) for b in section) < MIN_TOKENS
        if small or section[-1].kind == "heading":
            carry = section
        else:
            joined.append(section)
            carry = []
    if carry:
        if joined:
            joined[-1] = joined[-1] + carry
        else:
            joined.append(carry)
    return joined


def _pack(blocks: list[Block]) -> list[list[Block]]:
    """Fill chunks up to TARGET_TOKENS; a chunk never ends on a heading."""
    groups: list[list[Block]] = []
    current: list[Block] = []
    size = 0
    for block in blocks:
        tokens = estimate_tokens(block.text)
        if current and size >= MIN_TOKENS and size + tokens > TARGET_TOKENS:
            # Headings at the end belong with the text that follows them.
            cut = len(current)
            while cut > 0 and current[cut - 1].kind == "heading":
                cut -= 1
            if cut:
                groups.append(current[:cut])
                current = current[cut:]
                size = sum(estimate_tokens(b.text) for b in current)
        current.append(block)
        size += tokens
    if current:
        groups.append(current)
    return groups


def chunk_markdown(text: str, source: str, title: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    stack: list[tuple[int, str]] = []  # headings above the current position
    for section in _join_small(_sections(parse_blocks(text))):
        pieces = [piece for block in section for piece in _fit(block)]
        for group in _pack(pieces):
            inside = [b for b in group if b.kind == "heading"]
            # Context: the headings above this chunk that its own headings do not
            # replace, then the headings it contains.
            top = min((b.level for b in inside), default=99)
            above = [h for level, h in stack if level < top]
            own = list(dict.fromkeys(b.text for b in inside))  # "Role = ..." repeats per slide
            headings = above + [h for h in own if h not in above]
            for b in inside:
                stack = [h for h in stack if h[0] < b.level] + [(b.level, b.text)]
            content = "\n\n".join("#" * b.level + " " + b.text if b.kind == "heading" else b.text for b in group)
            chunks.append(Chunk(source, title, len(chunks), headings, content))
    return chunks


def chunk_file(path: Path) -> list[Chunk]:
    return chunk_markdown(path.read_text(encoding="utf-8"), path.name, document_title(path))
