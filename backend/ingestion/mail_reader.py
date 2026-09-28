"""Read an Outlook .msg or a MIME .eml into headers, body and attachment names.

Neither format is something LibreOffice or Docling reads as a MESSAGE. Writer
will open either one and lay out what it finds -- raw MIME for a .eml, raw
bytes for a .msg -- which is not the same as reading it. A .eml is MIME and the
standard library already parses it. A .msg is an OLE2 compound file whose
properties live in streams named by their MAPI tag -- `__substg1.0_0037001F` is
the subject, `_1000001F` the plain body, and so on, where the last four hex
digits are the type: 001F is UTF-16, 001E an 8-bit string, 0102 raw bytes.

That is read here with `olefile`, which docling already installs, rather than by
adding a mail library: the handful of tags an email review actually needs is a
short list, and the rest of a .msg is Outlook bookkeeping nobody is reading.

Two outputs, because the two halves of the review page want different things:
`to_markdown` for the corpus and the Markdown pane, `to_html` for the preview
pipeline, which renders it through LibreOffice like any other document.
"""

from __future__ import annotations

import html as html_mod
import re
from email import message_from_bytes, policy
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

MAIL_FORMATS = {".msg", ".eml"}

# The MAPI tags worth reading. The 0x3707 one lives inside an attachment
# storage rather than at the top level.
_TAGS = {
    "0037": "subject",
    "0C1A": "sender_name",
    "0C1F": "sender_email",
    "0042": "sent_representing",
    "0E04": "to",
    "0E03": "cc",
    "0E02": "bcc",
    "1000": "body",
    "1013": "html",
    "007D": "headers",
    "001A": "message_class",
    "3707": "attach_name",
    "3704": "attach_short_name",
}


class MailError(RuntimeError):
    pass


def _decode(raw: bytes, kind: str) -> str:
    if kind == "001F":
        return raw.decode("utf-16-le", "replace").rstrip("\x00")
    if kind == "001E":
        return raw.decode("cp1252", "replace").rstrip("\x00")
    # 0102 is raw bytes; the only one we want as text is the HTML body.
    return raw.decode("utf-8", "replace")


def _read_msg(path: Path) -> dict[str, Any]:
    import olefile

    try:
        ole = olefile.OleFileIO(str(path))
    except Exception as exc:  # not actually a compound file
        raise MailError(f"{path.name} is not a readable Outlook message: {exc}") from None

    out: dict[str, Any] = {"attachments": []}
    attach: dict[str, str] = {}
    try:
        for entry in ole.listdir():
            leaf = entry[-1]
            if not leaf.startswith("__substg1.0_"):
                continue
            tag = leaf[len("__substg1.0_"):]
            name = _TAGS.get(tag[:4])
            if not name:
                continue
            try:
                value = _decode(ole.openstream(entry).read(), tag[4:8])
            except Exception:
                continue
            if name.startswith("attach_"):
                # Keyed by the storage the stream sits in, so two attachments
                # do not overwrite one another.
                attach.setdefault(entry[0], value)
            else:
                out.setdefault(name, value)
    finally:
        ole.close()

    out["attachments"] = [v for _, v in sorted(attach.items()) if v]
    out["date"] = _date_from_headers(out.get("headers", ""))
    return out


def _date_from_headers(headers: str) -> str:
    m = re.search(r"^Date:\s*(.+)$", headers or "", re.MULTILINE)
    if not m:
        return ""
    try:
        return parsedate_to_datetime(m.group(1).strip()).isoformat()
    except Exception:
        return m.group(1).strip()


def _read_eml(path: Path) -> dict[str, Any]:
    msg = message_from_bytes(path.read_bytes(), policy=policy.default)
    body = htmlbody = ""
    attachments: list[str] = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        if filename or part.get_content_disposition() == "attachment":
            attachments.append(filename or "(unnamed attachment)")
            continue
        try:
            text = part.get_content()
        except Exception:
            continue
        if part.get_content_type() == "text/html" and not htmlbody:
            htmlbody = text
        elif part.get_content_type() == "text/plain" and not body:
            body = text
    return {
        "subject": msg.get("Subject", ""),
        "sender_name": msg.get("From", ""),
        "sender_email": msg.get("From", ""),
        "to": msg.get("To", ""),
        "cc": msg.get("Cc", ""),
        "bcc": msg.get("Bcc", ""),
        "date": _date_from_headers(f"Date: {msg.get('Date', '')}") or msg.get("Date", ""),
        "body": body,
        "html": htmlbody,
        "attachments": attachments,
    }


def read(path: Path) -> dict[str, Any]:
    """Headers, body and attachment names, whichever container it arrived in."""
    suffix = path.suffix.lower()
    if suffix == ".msg":
        return _read_msg(path)
    if suffix == ".eml":
        return _read_eml(path)
    raise MailError(f"{suffix} is not a mail format")


def _sender(mail: dict[str, Any]) -> str:
    name = (mail.get("sender_name") or "").strip()
    email = (mail.get("sender_email") or "").strip()
    if name and email and email not in name:
        return f"{name} <{email}>"
    return name or email


def _rows(mail: dict[str, Any]) -> list[tuple[str, str]]:
    rows = [("From", _sender(mail)), ("To", mail.get("to", "")),
            ("Cc", mail.get("cc", "")), ("Date", mail.get("date", ""))]
    if mail.get("attachments"):
        rows.append(("Attachments", ", ".join(mail["attachments"])))
    return [(k, v.strip()) for k, v in rows if (v or "").strip()]


def to_markdown(path: Path) -> str:
    """The message as Markdown: a header table, then the body.

    The headers are a table rather than prose because who sent a thing and when
    is the half of an email that gets cited, and a table survives chunking as
    one block."""
    mail = read(path)
    lines = [f"# {mail.get('subject') or path.stem}", ""]
    rows = _rows(mail)
    if rows:
        lines += ["| Field | Value |", "| --- | --- |"]
        lines += [f"| {k} | {v.replace('|', chr(92) + '|')} |" for k, v in rows]
        lines.append("")
    body = (mail.get("body") or "").replace("\r\n", "\n").strip()
    if not body and mail.get("html"):
        body = re.sub(r"<[^>]+>", " ", mail["html"])
        body = html_mod.unescape(re.sub(r"\s+", " ", body)).strip()
    lines.append(body or "*(no message body)*")
    return "\n".join(lines) + "\n"


def to_html(path: Path) -> str:
    """The message as a page LibreOffice can render for the preview pane."""
    mail = read(path)
    esc = html_mod.escape
    rows = "".join(
        f"<tr><th align='left' valign='top'>{esc(k)}</th><td>{esc(v)}</td></tr>"
        for k, v in _rows(mail)
    )
    if mail.get("html"):
        body = mail["html"]
        # A full document inside a document renders as an empty page.
        body = re.sub(r"(?is)^.*?<body[^>]*>|</body>.*$", "", body) or mail["html"]
    else:
        body = "<pre>" + esc((mail.get("body") or "").replace("\r\n", "\n")) + "</pre>"
    return (
        "<html><head><meta charset='utf-8'>"
        "<style>body{font-family:sans-serif;font-size:11pt}"
        "table{border-collapse:collapse;margin-bottom:12pt}"
        "th,td{border:1px solid #999;padding:3pt 6pt;font-size:10pt}"
        "th{background:#eee;white-space:nowrap}"
        "pre{white-space:pre-wrap;font-family:monospace;font-size:10pt}</style></head><body>"
        f"<h2>{esc(mail.get('subject') or path.stem)}</h2>"
        f"<table>{rows}</table>{body}</body></html>"
    )
