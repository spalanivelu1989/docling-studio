"""What the pipeline will accept, and that both halves can actually handle it.

Run: python test_formats.py

No Postgres, no Ollama, no API key. The formats added last were .xlsm, .json,
.msg and .eml, and each one was a different kind of gap:

  * .xlsm was rejected at the door although converter.py had read macro-enabled
    workbooks for as long as spreadsheets have been special-cased -- accepted
    and convertible had drifted apart, so the first test here is that they
    agree in both directions;
  * .json previewed as one unreadable line, because it is usually minified;
  * .msg is an OLE2 container LibreOffice cannot open at all, and .eml would
    have rendered as raw MIME, headers and boundaries included.

The last two are why preview grew a stand-in step: what gets rendered is not
always the file that arrived.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402
import converter  # noqa: E402
import mail_reader  # noqa: E402
import preview  # noqa: E402

# A real Outlook message cannot be written here -- olefile reads OLE2 and does
# not create it -- so the .msg tests run against a sample if one is reachable
# and say so plainly when it is not, rather than quietly passing.
MSG_SAMPLE = next(
    (p for p in [
        ROOT / "tests" / "fixtures" / "sample.msg",
        Path.home() / "Desktop/axway/markitdown/packages/markitdown/tests/test_files/test_outlook_msg.msg",
    ] if p.is_file()),
    None,
)

TMP = Path(tempfile.mkdtemp(prefix="docling-formats-"))


def write(name: str, text: str) -> Path:
    p = TMP / name
    p.write_text(text, encoding="utf-8")
    return p


# --- the tests ----------------------------------------------------------------

def test_every_accepted_format_has_a_converter():
    """A suffix accepted with nothing to convert it produces a document that
    previews and then fails -- worse than refusing it at the door."""
    handled = (converter.SPREADSHEET_FORMATS | converter.IMAGE_FORMATS
               | converter.TEXT_FORMATS | converter.CSV_FORMATS
               | converter.JSON_FORMATS | converter.MAIL_FORMATS
               | {".xml"}
               # Everything else is Docling's: Office documents, PDF and HTML.
               | {".pptx", ".ppt", ".docx", ".doc", ".xls", ".pdf", ".html", ".htm"})
    orphans = app.ACCEPTED - handled
    assert not orphans, f"accepted but nothing converts them: {sorted(orphans)}"


def test_formats_the_converter_handles_are_accepted():
    """The other direction, which is how .xlsm went missing: converter.py read
    it, the API turned it away."""
    convertible = (converter.SPREADSHEET_FORMATS | converter.TEXT_FORMATS
                   | converter.CSV_FORMATS | converter.JSON_FORMATS
                   | converter.MAIL_FORMATS)
    unreachable = convertible - app.ACCEPTED
    assert not unreachable, f"the converter handles these but the API refuses them: {sorted(unreachable)}"


def test_xlsm_is_accepted():
    assert ".xlsm" in app.ACCEPTED
    assert ".xlsm" in converter.SPREADSHEET_FORMATS


def test_minified_json_is_re_indented_and_fenced():
    src = write("min.json", '{"invoice":{"id":"INV-1001","lines":[{"qty":12}]}}')
    md = converter.json_to_markdown(src)
    assert "```json" in md, "JSON was not fenced; the braces will be chunked apart"
    assert '\n  "invoice"' in md, "a minified file was not re-indented"
    assert md.count("\n") > 6, "still one line -- unreadable on the page"


def test_malformed_json_is_kept_as_it_arrived():
    src = write("bad.json", '{"broken": [1,2,')
    md = converter.json_to_markdown(src)
    assert "not valid JSON" in md, "a parse failure was hidden from the reader"
    assert '{"broken": [1,2,' in md, "the original text was not preserved"


def test_preview_rewrites_json_but_passes_a_pdf_through():
    work = TMP / "w1"
    work.mkdir(exist_ok=True)
    src = write("mini.json", '{"a":1,"b":[2,3]}')
    stand_in = preview._readable(src, work)
    assert stand_in != src, "minified JSON went to LibreOffice as one long line"
    assert stand_in.suffix == ".txt"
    assert '\n  "a"' in stand_in.read_text()

    pdfish = write("thing.pdf", "%PDF-1.4")
    assert preview._readable(pdfish, work) == pdfish, "a PDF was needlessly rewritten"


def test_preview_turns_mail_into_a_page():
    work = TMP / "w2"
    work.mkdir(exist_ok=True)
    src = write("m.eml", "From: a@example.com\r\nTo: b@example.com\r\n"
                         "Subject: Return order\r\n\r\nBody text.\r\n")
    stand_in = preview._readable(src, work)
    assert stand_in.suffix == ".html", "a .eml would render as raw MIME"
    page = stand_in.read_text()
    assert "Return order" in page and "a@example.com" in page


def test_eml_headers_and_body():
    src = write("full.eml", "From: sender@example.com\r\nTo: rcpt@example.com\r\n"
                            "Cc: watcher@example.com\r\n"
                            "Date: Sun, 22 Dec 2024 11:23:00 +0300\r\n"
                            "Subject: Credit memo\r\n\r\nPlease raise a credit memo.\r\n")
    mail = mail_reader.read(src)
    assert mail["subject"] == "Credit memo"
    assert mail["to"] == "rcpt@example.com"
    assert mail["cc"] == "watcher@example.com"
    assert mail["date"].startswith("2024-12-22")
    assert "credit memo" in mail["body"]


def test_mail_markdown_puts_the_headers_in_a_table():
    """Who sent a thing and when is the half of an email that gets cited, and a
    table survives chunking as one block."""
    src = write("t.eml", "From: a@example.com\r\nTo: b@example.com\r\n"
                         "Subject: Return order\r\n\r\nBody text.\r\n")
    md = converter.mail_to_markdown(src)
    assert md.startswith("# Return order")
    assert "| Field | Value |" in md
    assert "| From | a@example.com |" in md
    assert "Body text." in md


def test_an_empty_header_gets_no_row():
    src = write("nocc.eml", "From: a@example.com\r\nTo: b@example.com\r\n"
                            "Subject: No cc\r\n\r\nBody.\r\n")
    md = converter.mail_to_markdown(src)
    assert "| Cc |" not in md, "an empty header was given a row of its own"


def test_a_file_that_is_not_a_message_says_so():
    src = write("fake.msg", "not an OLE file at all")
    try:
        mail_reader.read(src)
    except mail_reader.MailError as exc:
        assert "readable Outlook message" in str(exc)
    else:
        raise AssertionError("a non-OLE .msg was accepted as a message")


def test_msg_is_parsed():
    if MSG_SAMPLE is None:
        print("       (skipped: no .msg sample; put one at tests/fixtures/sample.msg)")
        return
    mail = mail_reader.read(MSG_SAMPLE)
    assert mail.get("subject"), "no subject read from the .msg"
    assert mail.get("body"), "no body read from the .msg"
    assert mail.get("sender_email") or mail.get("sender_name"), "no sender read"
    md = converter.mail_to_markdown(MSG_SAMPLE)
    assert md.startswith("# ") and "| Field | Value |" in md


def test_a_message_renders_as_one_page_not_a_binary_dump():
    """End to end through preview.render, not just the stand-in helper.

    Writer WILL open a raw .msg -- it takes the OLE2 container and lays out its
    bytes, which for this four-line email came to fourteen pages of binary. So
    "it rendered" is not the assertion worth making; "it rendered as an email"
    is. Removing the stand-in from render() leaves every unit test below
    passing, and only this one notices."""
    if MSG_SAMPLE is None:
        print("       (skipped: no .msg sample)")
        return
    out = TMP / "rendered-msg"
    shutil.rmtree(out, ignore_errors=True)
    if not preview.available():
        print("       (skipped: LibreOffice or pdftoppm not installed)")
        return
    pages = preview.render(MSG_SAMPLE, out)
    assert 0 < pages <= 3, (
        f"a short email rendered as {pages} pages -- that is the raw container, "
        "not the message")


def test_msg_preview_becomes_html():
    if MSG_SAMPLE is None:
        print("       (skipped: no .msg sample)")
        return
    work = TMP / "w3"
    work.mkdir(exist_ok=True)
    stand_in = preview._readable(MSG_SAMPLE, work)
    assert stand_in.suffix == ".html", "LibreOffice cannot open a .msg directly"
    assert "<table>" in stand_in.read_text()


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    try:
        for fn in tests:
            try:
                fn()
            except Exception as exc:
                failed += 1
                print(f"  FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
            else:
                print(f"  ok   {fn.__name__}")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
