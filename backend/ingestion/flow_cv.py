"""Process flows in images, recovered with classic image processing + Tesseract.

A flowchart pasted as a picture has lost the connector data PowerPoint keeps
(see pptx_flow), so the graph has to be read back off the pixels:

1. **Shapes.** Brightness steps outline every box, diamond and ellipse, so
   each shape encloses an interior. An interior is kept if it is convex and
   holds a label or a mark; the area an elbow connector closes off between
   shapes is neither. The small pieces a gateway's X cuts its diamond into are
   grouped back into one gateway, and interiors that tile one outline (a box
   with an ID header ruled off its body) into one box.
2. **Connectors.** Dark strokes outside the shapes, grouped into connected
   pieces. A piece that touches two or more shapes joins them.
3. **Direction.** An arrowhead is a filled triangle, so where a connector meets
   the shape it points into, the stroke is several times thicker than the
   line itself. Ends without one are sources.
4. **Labels.** Each shape is OCR'd on its own. Gateways without a word in
   them are typed by their mark: + is AND, anything else XOR.
5. **Is it a flowchart at all?** SAP screens are full of boxes and lines too,
   but their lines carry no arrowheads and their boxes hold numbers, not step
   names. A result is only returned when enough of its arrows have an
   arrowhead and enough of its steps have a name.

Measured against the connector graph PowerPoint stores for 75 rendered process
slides (shapes matched by position, so OCR errors do not count): 61% of the
arrows recovered, 81% of the arrows drawn correct. This is a draft by
construction: crossing connectors merge into one piece, dashed connectors fall
apart into dashes, and a faint line loses its edge. Where the source PowerPoint
exists, pptx_flow is exact and should be preferred.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image
from tesserocr import PSM, PyTessBaseAPI

# Brightness change between neighbouring pixels that can be a shape outline.
EDGE_STEP = 24
# Areas relative to the image. Larger "shapes" are swimlanes or frames drawn
# around the whole diagram; smaller ones are glyphs and icons.
MIN_NODE_AREA = 0.0012
MAX_NODE_AREA = 0.12
# Stroke this much thicker than the connector line, where it meets a shape,
# is an arrowhead.
ARROW_RATIO = 2.2
# Enclosed areas smaller than this are filled regardless: the four triangles
# a gateway's X cuts its diamond into are empty.
MAX_GATE_PART = 0.004
# Share of an enclosed area that must be text or a mark for it to be a shape.
MIN_CONTENT = 0.01
# Interior area over its convex hull's area; below this it is not one shape.
MIN_SOLIDITY = 0.85
# Enclosed areas smaller than this are letter counters and specks.
MIN_PART_AREA = 0.0001
MIN_NODES = 3
# A flow needs this many arrows with a visible arrowhead, and this share.
MIN_ARROWED = 3
MIN_ARROWED_SHARE = 0.4
# Share of its steps whose label holds a real word. Flowcharts in this corpus
# score 0.8-1.0; an SAP screen mistaken for one scored 0.38.
MIN_NAMED_SHARE = 0.6


@dataclass
class Node:
    id: int
    left: int
    top: int
    right: int
    bottom: int
    kind: str  # "box", "event" (ellipse), "gateway" (diamond)
    text: str = ""


@dataclass
class Flow:
    nodes: list[Node]
    edges: list[tuple[int, int]] = field(default_factory=list)
    # Edges whose direction came from a detected arrowhead, not from layout.
    arrowed: int = 0

    def to_mermaid(self) -> str:
        used = {n for e in self.edges for n in e}
        lines = ["flowchart LR"]
        for n in self.nodes:
            if n.id not in used:
                continue
            text = n.text.replace('"', "'") or n.kind
            if n.kind == "gateway":
                lines.append(f'    n{n.id}{{"{text}"}}')
            elif n.kind == "event":
                lines.append(f'    n{n.id}(["{text}"])')
            else:
                lines.append(f'    n{n.id}["{text}"]')
        for a, b in self.edges:
            lines.append(f"    n{a} --> n{b}")
        return "\n".join(lines)


def _edges(gray: np.ndarray) -> np.ndarray:
    g = gray.astype(np.int16)
    step = np.zeros(g.shape, bool)
    step[:-1] |= np.abs(np.diff(g, axis=0)) >= EDGE_STEP
    step[:, :-1] |= np.abs(np.diff(g, axis=1)) >= EDGE_STEP
    return cv2.dilate(step.astype(np.uint8) * 255, np.ones((3, 3), np.uint8))


def _ideal_kind(mask: np.ndarray, bbox: tuple) -> str:
    """Box, event or gateway: whichever ideal outline the shape overlaps best."""
    x0, y0, x1, y1 = bbox
    m = mask[y0:y1, x0:x1]
    bh, bw = m.shape
    if not bh or not bw:
        return "box"
    ellipse = np.zeros_like(m, np.uint8)
    cv2.ellipse(ellipse, (bw // 2, bh // 2), (bw // 2, bh // 2), 0, 0, 360, 1, cv2.FILLED)
    diamond = np.zeros_like(m, np.uint8)
    cv2.fillPoly(diamond, [np.array([[bw // 2, 0], [bw - 1, bh // 2], [bw // 2, bh - 1], [0, bh // 2]])], 1)

    def iou(ideal):
        ideal = ideal.astype(bool)
        return (m & ideal).sum() / max((m | ideal).sum(), 1)

    scores = {"box": m.mean(), "event": iou(ellipse), "gateway": iou(diamond)}
    return max(scores, key=scores.get)


def _tile(a: tuple, b: tuple, tol: int) -> bool:
    """Whether two boxes are stacked or side by side along a shared edge."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    # Grown by the border on each side, interiors split by a single rule
    # overlap; separate shapes placed close together only come near.
    stacked = abs(ax0 - bx0) <= tol and abs(ax1 - bx1) <= tol and max(ay0, by0) - min(ay1, by1) <= 1
    beside = abs(ay0 - by0) <= tol and abs(ay1 - by1) <= tol and max(ax0, bx0) - min(ax1, bx1) <= 1
    return stacked or beside


def _shapes(strokes: np.ndarray) -> list[tuple[np.ndarray, tuple, str]]:
    """(mask, bbox, kind) for each closed shape, one per enclosed interior.

    Shapes that touch -- a label chip overlapping its box, a gateway right
    against the start event -- stay separate, because each keeps its own
    interior even where their outlines merge.
    """
    h, w = strokes.shape
    total = h * w
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        (strokes == 0).astype(np.uint8), connectivity=4
    )
    outside = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
    border = 4
    grow = np.ones((2 * border + 1, 2 * border + 1), np.uint8)
    found: list[list] = []
    parts = np.zeros((h, w), np.uint8)
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if i in outside or area > MAX_NODE_AREA * total or area < MIN_PART_AREA * total:
            continue
        part = (labels[y:y + bh, x:x + bw] == i).astype(np.uint8)
        contours, _ = cv2.findContours(part, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        whole = np.zeros_like(part)
        cv2.drawContours(whole, contours, -1, 1, cv2.FILLED)
        hull = cv2.convexHull(np.concatenate(contours))
        aspect = bw / max(bh, 1)
        if area <= MAX_GATE_PART * total and 1 / 3 < aspect < 3:
            # Possibly one of the pieces a gateway's X or + cuts its diamond
            # into; grouped below. A long strip is a box's header instead.
            # Small shapes are taken by their hull: a label like "XOR" can
            # span a gateway circle edge to edge and cut its interior in two.
            cv2.fillConvexPoly(whole, hull, 1)
            parts[y:y + bh, x:x + bw] |= whole
            continue
        # A shape's interior is convex; an area an elbow connector closes off
        # has bites where the shapes around it intrude.
        if whole.sum() < MIN_SOLIDITY * cv2.contourArea(hull):
            continue
        content = int(whole.sum()) - int(part.sum())
        fill = whole.sum() / (bw * bh)
        # A shape holds a label or a mark, or is a plain ellipse or diamond.
        if content < MIN_CONTENT * area and fill > 0.9:
            continue
        mask = np.zeros((h, w), np.uint8)
        mask[y:y + bh, x:x + bw] = whole
        box = (max(x - border, 0), max(y - border, 0), min(x + bw + border, w), min(y + bh + border, h))
        found.append([cv2.dilate(mask, grow) > 0, box, None])

    # Interiors that tile one outline -- a box split into an ID header and a
    # body by a rule -- are one shape.
    merged = True
    while merged:
        merged = False
        for i in range(len(found)):
            for j in range(i + 1, len(found)):
                if _tile(found[i][1], found[j][1], border + 2):
                    a, b = found[i][1], found[j][1]
                    found[i][0] = found[i][0] | found[j][0]
                    found[i][1] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                    del found[j]
                    merged = True
                    break
            if merged:
                break
    for f in found:
        # Close the rule between tiled interiors before judging the outline.
        f[0] = cv2.morphologyEx(f[0].astype(np.uint8), cv2.MORPH_CLOSE, grow) > 0
        f[2] = _ideal_kind(f[0], f[1])

    # Gateway pieces: neighbouring small convex areas that together fill a
    # roughly square outline.
    m, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(parts, grow), connectivity=8)
    for i in range(1, m):
        x, y, bw, bh, area = st[i]
        if area < MIN_NODE_AREA * total or not 0.6 < bw / max(bh, 1) < 1.7:
            continue
        found.append([lab == i, (x, y, x + bw, y + bh), "gateway"])

    # Drop shapes drawn inside another shape (an icon in a box, a nested frame).
    found.sort(key=lambda s: -(s[1][2] - s[1][0]) * (s[1][3] - s[1][1]))
    kept: list = []
    for mask, bb, kind in found:
        if any(k[1][0] <= bb[0] and k[1][1] <= bb[1] and bb[2] <= k[1][2] and bb[3] <= k[1][3] for k in kept):
            continue
        kept.append((mask, bb, kind))
    return kept


def _read(api: PyTessBaseAPI, gray: np.ndarray, bbox: tuple, inset: float) -> str:
    x0, y0, x1, y1 = bbox
    dx, dy = int((x1 - x0) * inset), int((y1 - y0) * inset)
    crop = gray[y0 + dy:y1 - dy, x0 + dx:x1 - dx]
    if crop.size == 0 or int(crop.max()) - int(crop.min()) < 30:
        return ""
    big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_LANCZOS4)
    _, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if (bw == 0).mean() > 0.5:
        bw = 255 - bw
    api.SetImage(Image.fromarray(cv2.copyMakeBorder(bw, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)))
    text = " ".join(api.GetUTF8Text().split())
    if api.MeanTextConf() < 40:
        return ""
    return re.sub(r"^[^\w(]+|[^\w).?]+$", "", text)


def _gateway_type(gray: np.ndarray, bbox: tuple, text: str) -> str:
    upper = text.upper()
    for word in ("XOR", "AND", "OR"):
        if word in upper:
            return word
    x0, y0, x1, y1 = bbox
    core = gray[y0 + (y1 - y0) // 4:y1 - (y1 - y0) // 4, x0 + (x1 - x0) // 4:x1 - (x1 - x0) // 4]
    if core.size == 0:
        return "XOR"
    _, ink = cv2.threshold(core, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    c = ink.shape[0] // 2, ink.shape[1] // 2
    band = max(1, min(ink.shape) // 8)
    cross = ink[c[0] - band:c[0] + band + 1].mean() + ink[:, c[1] - band:c[1] + band + 1].mean()
    diag = np.mean([ink[i, int(i * ink.shape[1] / ink.shape[0])] for i in range(ink.shape[0])])
    if cross > 0.9 and cross / 2 > diag:
        return "AND"
    return "XOR"


def _arrowhead(ink, owner, node, zone, origin, line_half) -> bool:
    """Whether the connector ends in an arrowhead where it meets this shape.

    Measured on the full stroke image around the contact point, not on the
    connector piece: the margin cut around each shape removes most of an
    arrowhead that touches the shape's border.
    """
    ys, xs = np.nonzero(zone)
    if not len(ys):
        return False
    cy, cx = int(ys.mean()) + origin[1], int(xs.mean()) + origin[0]
    r = max(8, round(min(ink.shape) / 85))
    y0, x0 = max(cy - r, 0), max(cx - r, 0)
    win = ink[y0:cy + r + 1, x0:cx + r + 1].astype(np.uint8)
    if not win.any():
        return False
    dt = cv2.distanceTransform(win, cv2.DIST_L2, 3)
    return float(dt.max()) >= ARROW_RATIO * line_half + 0.5


def find_flow(gray: np.ndarray, lang: str, tessdata: str) -> Flow | None:
    """The boxes-and-arrows graph drawn in an image, or None if there is none."""
    h, w = gray.shape
    strokes = _edges(gray)
    shapes = _shapes(strokes)
    if len(shapes) < MIN_NODES:
        return None

    nodes = [Node(i, *bbox, kind) for i, (_, bbox, kind) in enumerate(shapes)]
    owner = np.full((h, w), -1, np.int32)
    for i, (mask, _, _) in enumerate(shapes):
        owner[mask] = i

    # Connectors: dark strokes that are not part of a shape. Adaptive, so a
    # grey line over a coloured swimlane still counts.
    dark = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15)
    pad = cv2.dilate((owner >= 0).astype(np.uint8), np.ones((5, 5), np.uint8))
    lines = dark.copy()
    lines[pad > 0] = 0
    # Strokes outside every shape's interior; arrowheads that touch a shape's
    # border are still whole here.
    ink = (dark > 0) & (owner < 0)
    reach = cv2.dilate((owner >= 0).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    near = cv2.dilate(np.where(owner >= 0, owner + 1, 0).astype(np.uint16), np.ones((15, 15), np.uint8))

    edges: set[tuple[int, int]] = set()
    arrowed: set[tuple[int, int]] = set()
    n, lab, st, _ = cv2.connectedComponentsWithStats(lines, connectivity=8)
    for i in range(1, n):
        x, y, bw, bh, area = st[i]
        if max(bw, bh) < 15:
            continue
        piece = (lab[y:y + bh, x:x + bw] == i)
        touch = piece & reach[y:y + bh, x:x + bw]
        ids = set(np.unique(near[y:y + bh, x:x + bw][touch])) - {0}
        if len(ids) < 2:
            continue
        dt = cv2.distanceTransform(piece.astype(np.uint8), cv2.DIST_L2, 3)
        line_half = max(float(np.percentile(dt[piece], 60)), 0.7)
        heads, tails = [], []
        for nid in ids:
            zone = touch & (near[y:y + bh, x:x + bw] == nid)
            if _arrowhead(ink, owner, nid - 1, zone, (x, y), line_half):
                heads.append(nid - 1)
            else:
                tails.append(nid - 1)
        if heads and tails:
            found = {(a, b) for a in tails for b in heads if a != b}
            edges |= found
            arrowed |= found
        elif not heads and len(tails) == 2:
            # No arrowhead found: read it left to right, then top to bottom.
            a, b = sorted(tails, key=lambda k: (nodes[k].left, nodes[k].top))
            edges.add((a, b))

    # Screens full of input fields have boxes and lines too, but their lines
    # carry no arrowheads. A flowchart's mostly do.
    if len(arrowed) < MIN_ARROWED or len(arrowed) < MIN_ARROWED_SHARE * len(edges):
        return None
    used = {k for e in edges for k in e}
    with PyTessBaseAPI(psm=PSM.SINGLE_BLOCK, lang=lang, path=tessdata) as api:
        for node in nodes:
            if node.id not in used:
                continue
            bbox = (node.left, node.top, node.right, node.bottom)
            inset = 0.22 if node.kind != "box" else 0.04
            node.text = _read(api, gray, bbox, inset)
            if node.kind == "gateway" and len(node.text) <= 3:
                node.text = _gateway_type(gray, bbox, node.text)
    # Process steps are named. Boxes that read as numbers and fragments are
    # input fields on a screen that happened to pass the arrowhead test.
    steps = [n for n in nodes if n.id in used and n.kind != "gateway"]
    named = sum(1 for n in steps if re.search(r"[A-Za-z]{3,}", n.text))
    if named < MIN_NAMED_SHARE * len(steps):
        return None
    return Flow(nodes, sorted(edges), len(arrowed))
