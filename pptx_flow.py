"""Recover the real process flow from PowerPoint flowcharts.

OCR and vision models read a flowchart as loose text: they see the labels but
not which box leads to which. PowerPoint does not have that problem -- it draws
each arrow from a connector shape that names the two shapes it joins:

    <p:cxnSp> ... <a:stCxn id="61"/> <a:endCxn id="64"/> ... </p:cxnSp>

That is ground truth, not inference. This module reads those connectors back
out and rebuilds the graph, so a slide's Markdown can carry the actual process
instead of a bag of labels. Across the P2P deck 94% of 810 connectors name both
endpoints; the rest are arrows the author left floating, which are matched to
their nearest shape by geometry.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

# A connector endpoint has to land this close to a shape (as a fraction of the
# slide width) before we believe it was meant to attach to it.
SNAP_FRACTION = 0.04
# Condition labels sit beside their arrow rather than on it; this is how far
# from an edge's midpoint one may sit and still be considered its label.
LABEL_FRACTION = 0.10

_SP = re.compile(r"<p:sp>.*?</p:sp>", re.S)
_CXN = re.compile(r"<p:cxnSp>.*?</p:cxnSp>", re.S)
_ID = re.compile(r'<p:cNvPr id="(\d+)"')
_GEOM = re.compile(r'<a:prstGeom prst="([^"]+)"')
_OFF = re.compile(r'<a:off x="(-?\d+)" y="(-?\d+)"')
_EXT = re.compile(r'<a:ext cx="(-?\d+)" cy="(-?\d+)"')
_TEXT = re.compile(r"<a:t>([^<]*)</a:t>")
_ST = re.compile(r'<a:stCxn id="(\d+)"')
_END = re.compile(r'<a:endCxn id="(\d+)"')
_SLIDE = re.compile(r"ppt/slides/slide(\d+)\.xml")

# The X or + drawn inside a gateway diamond, and the diamond itself.
GATEWAY_SYMBOLS = {"mathMultiply": "XOR", "mathPlus": "AND"}
GATEWAY_SHAPES = {"diamond", "flowChartDecision"}
# Rounded "App name" chips and similar furniture are not process steps.
FURNITURE = re.compile(
    r"^(app name|done|n/?a|pull list|present|tbd|note)\s*$", re.I
)
# An arrow thinner than this in its short dimension is a straight run. Elbow
# connectors bend, and their bounding box then covers a large rectangle of the
# slide that has nothing to do with the arrow's actual path.
STRAIGHT_EMU = 100000


@dataclass
class Shape:
    id: str
    geom: str
    x: int
    y: int
    cx: int
    cy: int
    text: str

    @property
    def cxm(self) -> float:
        return self.x + self.cx / 2

    @property
    def cym(self) -> float:
        return self.y + self.cy / 2

    @property
    def is_gateway(self) -> bool:
        return self.geom in GATEWAY_SHAPES and not self.text

    @property
    def is_condition(self) -> bool:
        return self.text.lower().startswith("condition")


@dataclass
class Slide:
    number: int
    shapes: dict[str, Shape]
    edges: list[tuple[str, str]]
    width: int
    boxes: dict = field(default_factory=dict)
    gateways: dict[str, str] = field(default_factory=dict)


def _shapes_and_edges(xml: str) -> tuple[dict[str, Shape], list[tuple[str, str]], dict]:
    shapes: dict[str, Shape] = {}
    symbols: dict[tuple[int, int], str] = {}

    for block in _SP.finditer(xml):
        sp = block.group(0)
        sid = _ID.search(sp)
        if not sid:
            continue
        geom = _GEOM.search(sp)
        off = _OFF.search(sp)
        ext = _EXT.search(sp)
        text = " ".join(t.strip() for t in _TEXT.findall(sp) if t.strip())
        kind = geom.group(1) if geom else "rect"
        x, y = (int(off.group(1)), int(off.group(2))) if off else (0, 0)
        cx, cy = (int(ext.group(1)), int(ext.group(2))) if ext else (0, 0)

        # The X / + glyph is a separate shape floating inside the diamond; it is
        # not a step, but it tells us what kind of gateway the diamond is.
        if kind in GATEWAY_SYMBOLS:
            symbols[(x + cx // 2, y + cy // 2)] = GATEWAY_SYMBOLS[kind]
            continue

        shapes[sid.group(1)] = Shape(sid.group(1), kind, x, y, cx, cy, text)

    edges: list[tuple[str, str]] = []
    boxes: dict[tuple[str, str], tuple[float, float]] = {}
    loose: list[tuple] = []
    for block in _CXN.finditer(xml):
        c = block.group(0)
        st, en = _ST.search(c), _END.search(c)
        off, ext = _OFF.search(c), _EXT.search(c)
        flip_h = 'flipH="1"' in c
        flip_v = 'flipV="1"' in c
        if st and en:
            pair = (st.group(1), en.group(1))
            edges.append(pair)
            # The connector's own box is where the arrow is actually drawn.
            # Elbow connectors bend, so this beats the straight line between
            # the two shape centres when deciding which caption belongs to it.
            if off and ext:
                x, y = int(off.group(1)), int(off.group(2))
                boxes[pair] = (x, y, x + int(ext.group(1)), y + int(ext.group(2)))
            continue
        if off and ext:
            x, y = int(off.group(1)), int(off.group(2))
            x2, y2 = x + int(ext.group(1)), y + int(ext.group(2))
            # flipH/flipV say which corners of the box the arrow actually runs
            # between, so the start point is not always the top-left corner.
            p0 = (x2 if flip_h else x, y2 if flip_v else y)
            p1 = (x if flip_h else x2, y if flip_v else y2)
            loose.append(
                (
                    p0,
                    p1,
                    st.group(1) if st else None,
                    en.group(1) if en else None,
                )
            )
    return shapes, edges, {"symbols": symbols, "loose": loose, "boxes": boxes}


def _nearest(shapes: dict[str, Shape], point, snap: float) -> str | None:
    """The shape an arrow endpoint lands on, by distance to its edge."""
    px, py = point
    best, dist = None, snap
    for s in shapes.values():
        # Distance to the box, not its centre: a big box is not "far" just
        # because its middle is.
        dx = max(s.x - px, 0, px - (s.x + s.cx))
        dy = max(s.y - py, 0, py - (s.y + s.cy))
        d = (dx * dx + dy * dy) ** 0.5
        if d < dist:
            best, dist = s.id, d
    return best


def _attach_loose(
    shapes: dict[str, Shape], loose: list, width: int
) -> list[tuple[str, str]]:
    """Resolve arrows that name one endpoint or neither.

    An arrow that names its start but not its end still tells us half the
    answer; only the unknown side is matched by geometry.
    """
    snap = width * SNAP_FRACTION
    found: list[tuple[str, str]] = []
    for p0, p1, known_start, known_end in loose:
        a = known_start or _nearest(shapes, p0, snap)
        b = known_end or _nearest(shapes, p1, snap)
        if a and b and a != b:
            found.append((a, b))
    return found


def _assign_labels(slide: Slide, edges: list[tuple[str, str]]) -> dict:
    """Attach each 'Condition: ...' caption to the arrow it sits beside.

    Captions are free-floating text boxes -- nothing in the file says which
    arrow they belong to. Each caption is therefore given to its own nearest
    arrow rather than each arrow grabbing the nearest caption: a caption
    belongs to exactly one arrow, while an arrow may legitimately have none.
    """
    conditions = [s for s in slide.shapes.values() if s.is_condition]
    limit = slide.width * LABEL_FRACTION
    out: dict[tuple[str, str], str] = {}

    for c in sorted(conditions, key=lambda s: s.id):
        best, dist = None, limit
        for a, b in edges:
            box = slide.boxes.get((a, b))
            if box is None:  # arrow geometry missing; fall back to the span
                sa, sb = slide.shapes[a], slide.shapes[b]
                anchor = ((sa.cxm + sb.cxm) / 2, (sa.cym + sb.cym) / 2)
            else:
                anchor = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
            d = ((c.cxm - anchor[0]) ** 2 + (c.cym - anchor[1]) ** 2) ** 0.5
            if d < dist and (a, b) not in out:
                best, dist = (a, b), d
        if best:
            out[best] = re.sub(
                r"^condition\s*:\s*", "", c.text, flags=re.I
            ).strip()
    return out


def _split_through(
    shapes: dict[str, Shape],
    edges: list[tuple[str, str]],
    boxes: dict,
    gateways: dict[str, str],
) -> list[tuple[str, str]]:
    """Insert steps that sit on top of a long arrow into that arrow's path.

    Authors routinely draw one arrow across the slide and drop the intervening
    boxes on top of it, so PowerPoint stores a single edge where the reader sees
    a chain. Any step whose centre falls inside the arrow's own bounding box
    belongs between its endpoints.
    """
    out: list[tuple[str, str]] = []
    for a, b in edges:
        # A connector can attach to a picture or a group, which are not parsed
        # as shapes; keep the edge but do not try to route through it.
        if a not in shapes or b not in shapes:
            out.append((a, b))
            continue
        box = boxes.get((a, b))
        if box is None:
            out.append((a, b))
            continue
        x0, x1 = sorted((box[0], box[2]))
        y0, y1 = sorted((box[1], box[3]))
        # Only straight runs may absorb the shapes they pass over. For an elbow
        # the box is a big rectangle and everything inside it would be swept in.
        if min(x1 - x0, y1 - y0) > STRAIGHT_EMU:
            out.append((a, b))
            continue
        pad = 60000
        between = [
            s
            for s in shapes.values()
            if s.id not in (a, b)
            and (s.text or s.id in gateways)
            and not s.is_condition
            and x0 - pad <= s.cxm <= x1 + pad
            and y0 - pad <= s.cym <= y1 + pad
        ]
        if not between:
            out.append((a, b))
            continue
        # Order them by how far along the arrow they sit, measured from the
        # shape the arrow leaves. Sorting on raw coordinates gets the chain
        # backwards whenever the arrow runs right-to-left or bottom-to-top.
        start = shapes[a]
        between.sort(
            key=lambda s: (s.cxm - start.cxm) ** 2 + (s.cym - start.cym) ** 2
        )
        chain = [a] + [s.id for s in between] + [b]
        out.extend(zip(chain, chain[1:]))
    return out


def parse_slide(xml: str, number: int, width: int) -> Slide:
    shapes, edges, extra = _shapes_and_edges(xml)
    edges += _attach_loose(shapes, extra["loose"], width)

    # Name each gateway by the glyph drawn inside it.
    gateways = {}
    for s in shapes.values():
        if s.is_gateway:
            for (sx, sy), kind in extra["symbols"].items():
                if abs(sx - s.cxm) < s.cx and abs(sy - s.cym) < s.cy:
                    gateways[s.id] = kind
                    break
            gateways.setdefault(s.id, "XOR")
    edges = _split_through(shapes, edges, extra["boxes"], gateways)
    # Splitting can produce the same hop twice; keep first occurrence order.
    edges = list(dict.fromkeys(edges))
    return Slide(number, shapes, edges, width, extra["boxes"], gateways)


def _mermaid_node(s: Shape, gateways: dict[str, str]) -> str:
    text = s.text.replace('"', "'").replace("\n", " ").strip()
    if s.id in gateways:
        return f'n{s.id}{{"{gateways[s.id]}"}}'
    if s.geom == "ellipse":
        return f'n{s.id}(["{text}"])'
    return f'n{s.id}["{text}"]'


def to_mermaid(slide: Slide) -> str:
    """Render one slide's flow as a Mermaid diagram, or '' if it has no arrows."""
    if not slide.edges:
        return ""
    conditions = [s for s in slide.shapes.values() if s.is_condition]
    skip = {c.id for c in conditions}
    skip |= {
        s.id
        for s in slide.shapes.values()
        if FURNITURE.match(s.text) or (not s.text and s.id not in slide.gateways)
    }

    edges = [(a, b) for a, b in slide.edges if a not in skip and b not in skip]
    edges = [
        (a, b) for a, b in edges if a in slide.shapes and b in slide.shapes
    ]
    if not edges:
        return ""

    labels = _assign_labels(slide, edges)
    lines = ["flowchart LR"]
    for sid in dict.fromkeys([e for pair in edges for e in pair]):
        lines.append(f"    {_mermaid_node(slide.shapes[sid], slide.gateways)}")
    for a, b in edges:
        label = labels.get((a, b), "")
        arrow = f'-->|"{label}"|' if label else "-->"
        lines.append(f"    n{a} {arrow} n{b}")
    return "\n".join(lines)


def slide_flows(src: Path) -> dict[int, str]:
    """Map slide number -> Mermaid diagram, for every slide that has arrows."""
    out: dict[int, str] = {}
    try:
        with zipfile.ZipFile(src) as z:
            pres = z.read("ppt/presentation.xml").decode("utf-8", "replace")
            m = re.search(r"sldSz[^>]*cx=\"(\d+)\"", pres)
            width = int(m.group(1)) if m else 9144000
            for name in z.namelist():
                sm = _SLIDE.fullmatch(name)
                if not sm:
                    continue
                xml = z.read(name).decode("utf-8", "replace")
                flow = to_mermaid(parse_slide(xml, int(sm.group(1)), width))
                if flow:
                    out[int(sm.group(1))] = flow
    except (zipfile.BadZipFile, KeyError):
        pass
    return out


if __name__ == "__main__":
    import sys

    flows = slide_flows(Path(sys.argv[1]))
    wanted = [int(a) for a in sys.argv[2:]] or sorted(flows)[:3]
    print(f"{len(flows)} slides with a recoverable flow\n")
    for n in wanted:
        if n in flows:
            print(f"--- slide {n} ---\n{flows[n]}\n")
