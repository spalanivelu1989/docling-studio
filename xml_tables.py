"""Convert XML documents into structured Markdown tables and sections.

Designed for enterprise XML data files (SAP forms, IDocs, configuration
files, transaction records) where Docling's native schema-bound parsers
(JATS/USPTO/XBRL) skip the file.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


def _clean_tag(tag: str) -> str:
    """Strip XML namespace prefixes like '{http://...}Tag'."""
    return tag.split("}")[-1] if "}" in tag else tag


def _escape_cell(text: str) -> str:
    """Escape pipes and newlines for Markdown table cells."""
    return text.replace("|", "\\|").replace("\r\n", " ").replace("\n", " ").strip()


def _is_leaf(elem: ET.Element) -> bool:
    """Check if an element is a leaf node (has no child elements)."""
    return len(elem) == 0


def _format_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    """Generate a clean Markdown table."""
    if not headers or not rows:
        return []
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join([":---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join([_escape_cell(c) for c in row]) + " |")
    lines.append("")
    return lines


def _render_element(elem: ET.Element, level: int = 2) -> list[str]:
    """Recursively render an element to Markdown sections and tables."""
    lines: list[str] = []
    prefix = "#" * min(level, 6)
    tag_name = _clean_tag(elem.tag)

    # Check for repeating child tags (e.g. list of <Item>, <Row>, <Entry>)
    tag_groups: dict[str, list[ET.Element]] = defaultdict(list)
    for child in elem:
        tag_groups[_clean_tag(child.tag)].append(child)

    # Collect scalar children of current element
    scalars: list[tuple[str, str]] = []
    complex_children: list[ET.Element] = []

    for child in elem:
        ctag = _clean_tag(child.tag)
        # If this child tag appears multiple times, we will handle it as a table
        if len(tag_groups[ctag]) > 1:
            continue

        if _is_leaf(child):
            val = (child.text or "").strip()
            if val:
                scalars.append((ctag, val))
        else:
            complex_children.append(child)

    # Also check attributes on current element
    for attr, val in elem.attrib.items():
        if val.strip():
            scalars.append((f"@{_clean_tag(attr)}", val.strip()))

    # Render scalar properties in a key-value table
    if scalars:
        rows = [[f"**{k}**", v] for k, v in scalars]
        lines.extend(_format_table(["Field", "Value"], rows))

    # Render repeated child groups as multi-row tables
    for group_tag, items in tag_groups.items():
        if len(items) <= 1:
            continue

        lines.append(f"{prefix}# {group_tag} ({len(items)} entries)\n")
        # Collect columns from attributes and leaf subchildren
        cols: list[str] = []
        for item in items:
            for k in item.attrib:
                c = f"@{_clean_tag(k)}"
                if c not in cols:
                    cols.append(c)
            for sub in item:
                stag = _clean_tag(sub.tag)
                if stag not in cols and _is_leaf(sub):
                    cols.append(stag)

        # An element's own text is content, and it was being dropped: the
        # columns were built from attributes and leaf sub-children only, so
        # <Step seq="1">Create the order</Step> produced a @seq column and
        # lost the sentence. It survived only in the raw XML at the bottom,
        # which is why a reader saw headings with nothing under them.
        if any((item.text or "").strip() for item in items):
            cols.append("Text")

        if cols:
            table_rows = []
            for item in items:
                row = []
                for col in cols:
                    if col == "Text":
                        val = (item.text or "").strip()
                    elif col.startswith("@"):
                        val = item.attrib.get(col[1:], "")
                    else:
                        sub = next((s for s in item if _clean_tag(s.tag) == col), None)
                        val = (sub.text or "").strip() if sub is not None else ""
                    row.append(val)
                table_rows.append(row)
            lines.extend(_format_table(cols, table_rows))
        else:
            # Neither attributes nor children: a repeated run of text, which
            # is what a list of <Paragraph> elements is. Rendered as
            # paragraphs rather than as a heading per empty item.
            for idx, item in enumerate(items, start=1):
                own = (item.text or "").strip()
                if _is_leaf(item) and own:
                    lines.append(f"{own}\n")
                    continue
                lines.append(f"{prefix}## {group_tag} [{idx}]\n")
                lines.extend(_render_element(item, level=level + 2))

    # Mixed content: an element that has children AND text of its own. The
    # text is the sentence; losing it keeps the structure and drops the point.
    own_text = (elem.text or "").strip()
    if own_text and len(elem):
        lines.append(f"{own_text}\n")

    # Render complex non-repeating children
    for comp in complex_children:
        comp_tag = _clean_tag(comp.tag)
        lines.append(f"{prefix}# {comp_tag}\n")
        lines.extend(_render_element(comp, level=level + 1))

    return lines


def xml_to_markdown(src: Path, title: str | None = None) -> str:
    """Convert an XML file into structured Markdown."""
    doc_title = title or src.stem

    try:
        raw_text = src.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return f"# {doc_title}\n\n*Error reading XML file: {exc}*\n"

    try:
        tree = ET.parse(src)
        root = tree.getroot()
    except Exception as exc:
        # Fallback to displaying raw XML code block
        return (
            f"# {doc_title}\n\n"
            f"*Note: XML parser reported an error: {exc}. Displaying raw content below.*\n\n"
            f"```xml\n{raw_text}\n```\n"
        )

    root_tag = _clean_tag(root.tag)
    lines: list[str] = [f"# {doc_title}\n"]

    if root_tag != doc_title:
        lines.append(f"> **Root Element**: `{root_tag}`\n")

    # Render root attributes if any
    if root.attrib:
        lines.append("### Document Attributes\n")
        rows = [[f"**@{_clean_tag(k)}**", v] for k, v in root.attrib.items()]
        lines.extend(_format_table(["Attribute", "Value"], rows))

    # Render child structure
    lines.extend(_render_element(root, level=2))

    # Append raw XML code block at the bottom
    lines.append("\n---\n\n## Raw XML Source\n")
    # Limit raw display to first 2500 lines to keep UI responsive on huge files
    raw_lines = raw_text.splitlines()
    if len(raw_lines) > 2500:
        truncated_raw = "\n".join(raw_lines[:2500]) + f"\n\n... [{len(raw_lines) - 2500} lines truncated] ..."
        lines.append(f"```xml\n{truncated_raw}\n```\n")
    else:
        lines.append(f"```xml\n{raw_text}\n```\n")

    return "\n".join(lines)

