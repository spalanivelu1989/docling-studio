"""Local vision-model reader for images Tesseract cannot read *structurally*.

Tesseract recognises character shapes. It has no idea it is looking at a table,
so on a screenshot of one it returns the right-ish words in the wrong order with
the rows collapsed -- and reports high confidence while doing it. Its confidence
score answers "am I sure this glyph is an 'e'", not "did I preserve the table".

That distinction drives the routing here: an image is sent to the vision model
because it is *dense* (tables, diagrams, SAP screenshots), not because Tesseract
said it was unsure. A confident-but-scrambled table is exactly the case a
confidence threshold would miss.

Two jobs, two prompts, one model:

* `read` asks for Markdown, for tables and screenshots.
* `read_flow` asks for Mermaid, for boxes-and-arrows diagrams that arrived as a
  flattened image. This is the only way to get *arrows* out of a picture. It is
  a draft: measured against the connector ground truth in the Solvay decks it
  recovers about half the arrows and about a third of what it asserts is wrong,
  so callers must label the output as needing review. Where the real PowerPoint
  connectors exist, pptx_flow beats this outright and should be preferred.

The model is Qwen3-VL-8B running locally through MLX on Apple silicon, so
nothing leaves the machine. It replaced IBM's granite-docling-258M, which cannot
do this job at all: granite emits DocTags, a document markup with no tag for a
graph edge, so it scored zero arrows on every diagram tested.
"""

from __future__ import annotations

import os
import re
import tempfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=UserWarning)

MODEL = "mlx-community/Qwen3-VL-8B-Instruct-4bit"

# Tesseract handles short labels and callouts fine and is far cheaper, so only
# images holding a substantial block of text are worth the vision model.
MIN_WORDS_FOR_VLM = 20
# Below this a "dense" image is more likely noise than content.
MIN_PIXELS_FOR_VLM = 200 * 150

# Qwen3-VL works at native resolution, so a big scan turns into a lot of vision
# tokens. The cap only exists to stop an oversized scan exhausting memory, and
# it has to sit above a full slide render (2000px at 200 DPI): squeezed to
# 1600px the model stops drawing gateways as diamonds and starts writing the
# branch condition into the node itself, which loses the branch structure.
MAX_EDGE = 2400

# A dense slide runs past 2048 tokens, and a truncated answer used to be thrown
# away wholesale. Big enough that the common case finishes cleanly.
FLOW_MAX_TOKENS = 4096

DOC_PROMPT = (
    "Convert this image to Markdown. Preserve tables as Markdown tables with "
    "their real rows and columns. Do not miss any text and output only the bare "
    "Markdown."
)

# Asked for a flowchart, this model will draw one out of anything -- shown a SAP
# table it happily chains the cells together into a process that does not exist.
# Nothing downstream can tell that apart from a real answer, so the only safe
# gate is to ask first, cheaply, whether there is a diagram there at all.
IS_FLOW_PROMPT = """Look at this image.

Answer YES if it is a diagram of a process: boxes, diamonds or circles joined by \
arrows showing the order steps happen in. Cycles and swim-lane diagrams count as YES.

Answer NO if it is anything else: a screenshot of software, a table or \
spreadsheet, a data-entry form, a photo, a logo or a chart.

Answer with exactly one word: YES or NO."""

# Measured as-is: this exact wording produced the 48% recall / 63% precision
# benchmark against the PowerPoint connector graph. Rewording it invalidates
# those numbers, so re-run the benchmark if you change it.
FLOW_PROMPT = """This image is a business process flowchart.

Convert it to Mermaid flowchart code.

Rules:
- Start with `flowchart TD`.
- Every box, diamond and rounded shape in the image becomes one node whose
  label is the exact text inside that shape.
- Every arrow in the image becomes one edge `A --> B`, following the
  arrowhead: the tail shape is A, the shape the head points at is B.
- If an arrow has a label beside it, write it as `A -->|label| B`.
- Only output arrows you can actually see. Do not invent connections.
- Output only the Mermaid code block, nothing else.
"""

_model = None
_processor = None


def available() -> bool:
    try:
        import mlx_vlm  # noqa: F401
    except Exception:
        return False
    return True


def _load():
    """Load the weights once; that is by far the expensive part."""
    global _model, _processor
    if _model is None:
        from mlx_vlm import load
        from transformers.utils import logging

        # mlx_vlm passes enable_thinking=False, which Qwen3-VL-Instruct's
        # template does not use, so transformers warns on every single call.
        logging.set_verbosity_error()
        _model, _processor = load(MODEL)
    return _model, _processor


def _shrink(path: Path) -> tuple[Path, bool]:
    """Downscale an oversized image; the flag says whether to delete it after."""
    from PIL import Image

    with Image.open(path) as im:
        if max(im.size) <= MAX_EDGE:
            return path, False
        ratio = MAX_EDGE / max(im.size)
        small = im.convert("RGB").resize(
            (round(im.width * ratio), round(im.height * ratio)), Image.LANCZOS
        )
    # mkstemp rather than NamedTemporaryFile: the latter hands back an *open*
    # handle that nothing here ever closes, and a long deck is hundreds of
    # images against a default limit of 256 descriptors.
    fd, name = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    small.save(name)
    return Path(name), True


def _ask(path: Path, prompt: str, max_tokens: int) -> str:
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    model, processor = _load()
    image, temporary = _shrink(path)
    try:
        formatted = apply_chat_template(processor, model.config, prompt, num_images=1)
        out = generate(
            model,
            processor,
            formatted,
            [str(image)],
            max_tokens=max_tokens,
            temperature=0.0,
            verbose=False,
        )
    finally:
        if temporary:
            image.unlink(missing_ok=True)
    return (out.text if hasattr(out, "text") else str(out)).strip()


def should_use(words: int, width: int, height: int) -> bool:
    """Whether this image is dense enough that structure is worth recovering."""
    return words >= MIN_WORDS_FOR_VLM and width * height >= MIN_PIXELS_FOR_VLM


def read(path: Path) -> str:
    """Return Markdown for one image, or '' if the model produced nothing."""
    md = _ask(path, DOC_PROMPT, max_tokens=4096)
    # Unwrap only a fence that encloses the whole answer. Stripping any
    # trailing ``` also ate the closing fence of a mermaid block that happened
    # to end the answer, which swallowed the rest of the page into the diagram.
    outer = re.fullmatch(r"\s*```(?:markdown|md)?[ \t]*\n(.*?)\n?```\s*", md, re.S)
    if outer:
        md = outer.group(1)
    md = md.replace("<!-- image -->", "").strip()
    # A reply cut off at the token limit can leave a fence open.
    if md.count("```") % 2:
        md += "\n```"
    return _MERMAID_BLOCK.sub(lambda m: m.group(1) + _tidy(m.group(2)) + m.group(3), md)


_FENCE = re.compile(r"```(?:mermaid)?\s*(.*?)```", re.S)
_MERMAID_BLOCK = re.compile(r"(```mermaid[ \t]*\n)(.*?)(\n?```)", re.S)
_EDGE = re.compile(r"\b[A-Za-z]\w*\s*(?:--+>|-\.-*->|==+>)", re.M)

# Splitting a line on its arrows leaves alternating node segments and arrows,
# which is what makes the label rewriting below tractable.
_ARROW = re.compile(r"((?:--+>|-\.-*->|==+>|--+[xo])\s*(?:\|[^|]*\|)?)")
_NODE = re.compile(r"^(\s*)([A-Za-z]\w*)(\(\[|\[\[|\(\(|\{\{|\[\(|\[|\(|\{|>)(.+)$")
_CLOSERS = {"([": ")]", "[[": "]]", "((": "))", "{{": "}}", "[(": ")]",
            "[": "]", "(": ")", "{": "}", ">": "]"}


def _clean_label(text: str) -> str:
    """Make one label safe to sit inside a Mermaid shape.

    Mermaid is rendered with `securityLevel: "strict"`, which escapes HTML, so
    the `<br>` the model likes to emit would show up literally. Parentheses are
    the bigger problem: `A[Complete Inspection Lot(UD)]` is a syntax error that
    kills the whole diagram, and the model produces them regularly.
    """
    text = re.sub(r"<br\s*/?>", " ", text)
    text = text.replace('"', "'").replace("\\n", " ")
    return " ".join(text.split())


def _tidy(flow: str) -> str:
    """Quote every node and edge label so one stray bracket cannot break a diagram."""
    out = []
    for line in flow.splitlines():
        parts = _ARROW.split(line)
        for i, part in enumerate(parts):
            if _ARROW.fullmatch(part.strip()) and "|" in part:
                head, label, tail = part.split("|", 2)
                parts[i] = f'{head}|"{_clean_label(label)}"|{tail}'
                continue
            node = _NODE.match(part)
            if not node:
                continue
            indent, name, opener, rest = node.groups()
            closer = _CLOSERS[opener]
            cut = rest.rfind(closer)
            if cut < 0:
                continue
            label = _clean_label(rest[:cut])
            parts[i] = f'{indent}{name}{opener}"{label}"{closer}{rest[cut + len(closer):]}'
        out.append("".join(parts))
    return "\n".join(out)


def is_flowchart(path: Path) -> bool:
    """Whether the image actually holds a process diagram.

    Costs a few seconds and one word of generation, and it is what stops a
    screenshot of a table from being rendered as an invented process.
    """
    answer = _ask(path, IS_FLOW_PROMPT, max_tokens=4).strip().upper()
    return answer.startswith("YES")


def read_flow(path: Path) -> str | None:
    """Return Mermaid flowchart source for one diagram image, or None.

    None means "I got nothing usable": not a diagram in the first place, an
    empty answer, prose instead of code, or a graph so small it says less than
    the OCR'd labels already do. The caller keeps whatever it had rather than
    printing a stub.
    """
    if not is_flowchart(path):
        return None
    raw = _ask(path, FLOW_PROMPT, max_tokens=FLOW_MAX_TOKENS)
    fenced = _FENCE.search(raw)
    if fenced:
        body = fenced.group(1).strip()
    else:
        # No closing fence means the answer was cut off at the token limit. The
        # graph up to that point is still good, so strip the opening fence by
        # hand -- matching only complete fences threw away a 165-edge diagram --
        # and drop the half-written last line.
        body = re.sub(r"^\s*```[a-z]*\s*", "", raw).strip()
        lines = body.splitlines()
        if lines and not lines[-1].rstrip().endswith(("]", "}", ")", '"')):
            lines.pop()
        body = "\n".join(lines).strip()

    if not body.lower().startswith(("flowchart", "graph ")):
        return None
    if looks_degenerate(body):
        return None
    # One or two arrows is not a process; it is the model shrugging.
    if len(_EDGE.findall(body)) < 3:
        return None
    return _tidy(body)


def looks_degenerate(md: str) -> bool:
    """Detect the repetition loop small VLMs fall into.

    Asked to read something it cannot parse, a small model will often emit the
    same line over and over until it hits the token limit. That failure is
    invisible to a length check -- the loop produces *more* text than the
    correct answer -- so it has to be caught on its own.
    """
    lines = [ln.strip() for ln in md.splitlines() if ln.strip()]
    if len(lines) < 6:
        return False
    return len(set(lines)) / len(lines) < 0.5


def is_better_than(vlm_md: str, ocr_text: str) -> bool:
    """Whether the vision model's answer actually beats the Tesseract one.

    A recovered table wins -- that is the whole reason for the detour. Anything
    else has to have read at least as much text as Tesseract did, and must not
    be a repetition loop, so a confused answer never discards good OCR output.
    """
    if not vlm_md or looks_degenerate(vlm_md):
        return False
    if "---|" in vlm_md or "| ---" in vlm_md:
        return True
    return len(vlm_md) >= len(ocr_text)
