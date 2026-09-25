"""Remove e-mail addresses and phone numbers from what the agents return.

The hard part is the phone number. This corpus is full of long digit strings
that are not phone numbers and must survive untouched:

    M-090-030-010      a BPML code -- a letter prefix and hyphenated groups
    7.1.12.3           document numbering
    4500012345         an SAP document number, ten bare digits
    2024-01-15         a date
    INR 5,00,000       an amount
    SPARK-22877        a ticket

So a run of digits is treated as a phone number only when it LOOKS like one to
a reader, not merely when it is long:

  * it starts with "+" or "00" and a country code;          +44 20 7946 0958
  * or it has phone-style grouping -- brackets, or at least
    two separators between groups -- with 8 to 15 digits;   (020) 7946-0958
  * or a word like "tel", "phone", "mobile", "fax" or
    "call" sits just before it.                              Tel: 7946 0958

A bare 10-digit number with no such cue is left alone: it is far more likely
to be a sales order than a phone number here, and deleting an order number
from an answer is its own kind of wrong.

Measured against the 8,855 chunks of the corpus before these rules were
settled, a looser version flagged 329 "phone numbers", most of them SAP
screens: zero-padded document numbers (0006206459), item numbers
(000010 (0001)), a date followed by a quantity (13.02.2024 12 EA) and numeric
process codes (1-090-020-370). Each exclusion below is one of those shapes.
"""

from __future__ import annotations

import re
from typing import Any

MASK = "[contact removed]"

EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")

# A candidate: digits with the separators a phone number uses. Anchored so it
# cannot start inside a word ("M-090-030-010", "SPARK-22877") or inside a
# longer number or a version string.
_CANDIDATE = re.compile(
    r"(?<![\w.\-/])"                      # not glued to a word, code, date or path
    r"(?P<num>\+?\(?\d[\d \t().\-]{5,}\d)"  # one line only: a table cell is not a number
    r"(?![\w\-/]|\.\d)"
)
_CUE = re.compile(r"(?:\b(?:tel|telephone|phone|ph|mobile|mob|cell|fax|call|whatsapp|"
                  r"contact(?:\s+(?:no|number))?)\b\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*$)",
                  re.I)
_DATE = re.compile(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}(?!\d)|(?<!\d)\d{1,2}[-./]\d{1,2}[-./]\d{2,4}(?!\d)")
_TIME_RANGE = re.compile(r"\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.\d{2}")   # 12.05 - 16.05
_DOTTED = re.compile(r"^\d{1,3}(?:\.\d{1,3}){2,}$")          # 7.1.12.3, 1.2.3


def _is_phone(num: str, before: str) -> bool:
    digits = re.sub(r"\D", "", num)
    if not 7 <= len(digits) <= 15:
        return False
    s = num.strip()
    groups = [g for g in re.split(r"[ \t().\-]+", s) if g]
    # First: "+91-80-4123-4567" would otherwise read as the date 91-80-4123.
    if s.startswith("+"):
        return len(digits) >= 8
    if _DATE.search(s) or _TIME_RANGE.search(s) or _DOTTED.match(s):
        return False
    # A year standing as a group of its own: 01.-06-2026, 26 2005 10.
    if len(groups) <= 3 and any(re.fullmatch(r"(?:19|20)\d\d", g) for g in groups):
        return False
    # "0044 20 7946 0958": an international prefix is 00 and a country code,
    # and is written apart from the rest. 0006206459 is a document number.
    if re.match(r"00[1-9]", s):
        return len(groups) >= 2 and len(digits) >= 10
    # Zero-padded SAP numbering, in any group: 000010, 0001.
    if any(len(g) >= 4 and g.startswith("00") for g in groups):
        return False
    # Numeric process codes, 1-090-020-370 and the OCR'd 0-020-090: a lead
    # digit, then groups of three.
    if re.match(r"\d-\d{3}-\d{3}", s):
        return False
    if _CUE.search(before[-24:]):
        return True
    brackets = "(" in s and ")" in s
    if len(digits) >= 8 and (brackets or len(groups) >= 3):
        if not all(1 <= len(g) <= 5 for g in groups):
            return False
        # Spaces alone separate lists of numbers as often as phone groups
        # ("30 50 60 70"). Without a cue, a space-grouped number must open
        # with the trunk 0 a dialled number starts with: 020 7946 0958.
        if not re.search(r"[().\-]", s):
            return s.startswith("0")
        return True
    return False


def redact(text: str) -> str:
    """The text with every e-mail address and phone number replaced by MASK."""
    if not text or not isinstance(text, str):
        return text
    out = EMAIL.sub(MASK, text)
    if not any(ch.isdigit() for ch in out):
        return out
    parts, last = [], 0
    for m in _CANDIDATE.finditer(out):
        num = m.group("num").rstrip(" .-")
        if _is_phone(num, out[max(0, m.start() - 24):m.start()]):
            parts.append(out[last:m.start()])
            parts.append(MASK)
            last = m.start() + len(num)
    parts.append(out[last:])
    return "".join(parts)


def redact_obj(obj: Any) -> Any:
    """Redact every string inside a JSON-shaped value, keys left alone."""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_obj(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(redact_obj(v) for v in obj)
    return obj


class Stream:
    """Redact text that arrives a few characters at a time.

    A model's answer streams in tokens, and "j.doe@" and "solvay.com" can be
    two of them: redacting each token alone would let both halves through.
    So text is held back until a point no contact detail crosses -- a line
    break, or the end of a sentence (". ", "? ", "! ") -- and redacted up to
    there. An e-mail address has dots but never ". "; a phone number has
    spaces but no sentence end. A run of text with neither is released at
    MAX_HOLD, cut at the last space, so a table row cannot stall the stream.
    """

    MAX_HOLD = 600
    _BOUNDARY = re.compile(r"\n|[.?!](?=\s)")

    def __init__(self) -> None:
        self._held = ""

    def feed(self, delta: str) -> str:
        self._held += delta or ""
        cut = 0
        for m in self._BOUNDARY.finditer(self._held):
            cut = m.end()
        if not cut and len(self._held) > self.MAX_HOLD:
            cut = self._held.rfind(" ", 0, len(self._held) - 40) + 1
        if cut <= 0:
            return ""
        out, self._held = self._held[:cut], self._held[cut:]
        return redact(out)

    def flush(self) -> str:
        out, self._held = self._held, ""
        return redact(out)


def found(text: str) -> bool:
    """Whether the text holds anything redact() would remove."""
    return redact(text) != text
