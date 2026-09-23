"""Unit tests for the plain-text branch of converter.py.

There is one property here worth protecting, and it is not obvious from the
code: a .txt file must come out of the converter with its characters
unchanged. The agents quote evidence verbatim and `fitgap.verifier` checks
each quote character-for-character against the chunk it came from, so any
escaping applied on the way in turns a correctly quoted business rule into an
unverifiable one -- which is dropped silently, with the reader told only that
the evidence was thin.

That is not hypothetical. Docling accepts a .txt file, but parses it as
Markdown: `->` comes back as `-&gt;` and `5_000` as `5\\_000`. These tests are
what stops someone deleting the dedicated branch and letting .txt fall through
to Docling again.

Run: python test_converter.py   (no network, no database)

The .csv tests do run Docling, because Docling is what converts a .csv here:
its CSV backend sniffs the delimiter and builds the table, and what these
check is the pair of things around it -- decoding, and the title -- plus the
fidelity of what comes back. They are local and take about a tenth of a
second; everything else in this file still runs without it.
"""

from __future__ import annotations

import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from converter import (CSV_FORMATS, TEXT_FORMATS, convert,  # noqa: E402
                       csv_rows, csv_to_markdown, text_to_markdown)
from xml_tables import xml_to_markdown  # noqa: E402


def _write(body: str, name: str = "sop.txt", encoding: str = "utf-8") -> Path:
    path = Path(tempfile.mkdtemp()) / name
    path.write_bytes(body.encode(encoding))
    return path


def test_txt_is_an_accepted_format():
    assert ".txt" in TEXT_FORMATS


def test_the_characters_a_quote_would_be_checked_against_are_unchanged():
    # Every one of these is mangled by a Markdown parser, and every one of
    # them is the sort of thing an As-Is SOP actually contains.
    body = (
        "1. Credit check runs. If exposure > limit, block Z1 is applied.\n"
        "   - Under INR 5,00,000 -> team lead\n"
        "   - Above INR 5,00,000 -> credit committee\n"
        "2. Analyst reviews * flags an exception * and routes it.\n"
        "Note: the 2_000 character limit applies #per line.\n"
    )
    md = text_to_markdown(_write(body), title="India As-Is")
    for line in body.strip().splitlines():
        assert line in md, f"the converter altered: {line!r}"


def test_convert_routes_txt_to_the_text_path_not_to_docling():
    """The tests above exercise `text_to_markdown` directly, so they would all
    still pass if the branch in `convert` were deleted and .txt fell back to
    Docling. This is the one that notices."""
    body = "Above INR 5,00,000 -> credit committee\n"
    result = convert(_write(body), flows=False, ocr=False)

    assert result.unit == "files"          # the text branch, not the page pipeline
    assert "-&gt;" not in result.markdown  # what Docling's Markdown parser does
    assert body.strip() in result.markdown


def test_a_title_is_added_and_nothing_else():
    md = text_to_markdown(_write("just one line\n"), title="My Document")
    assert md == "# My Document\n\njust one line\n"


def test_the_filename_is_the_title_when_none_is_given():
    md = text_to_markdown(_write("body\n", name="India_As_Is.txt"))
    assert md.startswith("# India_As_Is\n")


def test_windows_line_endings_do_not_end_up_inside_quotes():
    """A CRLF file would otherwise put a \\r at the end of every line, so a
    quote copied from one line would never match the chunk."""
    md = text_to_markdown(_write("first line\r\nsecond line\r\n"))
    assert "\r" not in md
    assert "first line\nsecond line" in md


def test_a_file_that_is_not_utf8_still_converts():
    # cp1252 is what a Windows export gives you; failing here would mean an
    # analyst's document simply cannot be attached.
    path = _write("Fee is 50–100 EUR\n", encoding="cp1252")
    md = text_to_markdown(path)
    assert "Fee is 50" in md and "100 EUR" in md


def test_an_empty_file_is_still_a_document():
    md = text_to_markdown(_write(""), title="Empty")
    assert md == "# Empty\n\n\n"


# --- XML ---------------------------------------------------------------------
# The rule is the same one the plain-text branch exists for: everything the
# document says has to survive into the Markdown, because the agents quote it
# and the verifier checks those quotes against the chunk. These tests came out
# of a real loss -- an element's own text was dropped whenever the element
# repeated, so a list of process steps rendered as a table of sequence numbers
# with the steps missing, and a list of paragraphs rendered as empty headings.


def _xml(body: str) -> Path:
    path = Path(tempfile.mkdtemp()) / "doc.xml"
    path.write_text(body, encoding="utf-8")
    return path


def test_a_repeated_element_keeps_its_own_text():
    md = xml_to_markdown(_xml(
        '<Steps>'
        '<Step seq="1" actor="CSR">Create returns order with reference to the invoice.</Step>'
        '<Step seq="2" actor="Quality">Record the inspection outcome.</Step>'
        '</Steps>'
    ))
    body = md.split("## Raw XML Source")[0]
    assert "Create returns order with reference to the invoice." in body
    assert "Record the inspection outcome." in body
    # And the attributes are still there beside it.
    assert "@seq" in body and "@actor" in body


def test_repeated_paragraphs_are_not_empty_headings():
    md = xml_to_markdown(_xml(
        "<Narrative><Paragraph>A return above INR 2,00,000 needs approval.</Paragraph>"
        "<Paragraph>Returns are never credit-blocked.</Paragraph></Narrative>"
    ))
    body = md.split("## Raw XML Source")[0]
    assert "A return above INR 2,00,000 needs approval." in body
    assert "Returns are never credit-blocked." in body


def test_mixed_content_keeps_the_sentence_as_well_as_the_structure():
    md = xml_to_markdown(_xml(
        "<Control>Approval is required above the threshold."
        "<Owner>Finance Controller</Owner></Control>"
    ))
    body = md.split("## Raw XML Source")[0]
    assert "Approval is required above the threshold." in body
    assert "Finance Controller" in body


def test_a_data_xml_gains_no_empty_text_column():
    """The fix must not add a column to the tables the converter was written
    for: an IDoc's segments carry their values in child elements, not in text
    of their own."""
    md = xml_to_markdown(_xml(
        "<IDOC><E1EDP01><POSEX>000010</POSEX><MENGE>100.000</MENGE></E1EDP01>"
        "<E1EDP01><POSEX>000020</POSEX><MENGE>250.000</MENGE></E1EDP01></IDOC>"
    ))
    body = md.split("## Raw XML Source")[0]
    assert "| Text |" not in body and "| Text " not in body
    assert "000010" in body and "250.000" in body


def test_the_raw_source_is_still_appended():
    # It is the backstop: whatever the structural rendering does, the source
    # text itself stays in the document and can be quoted.
    md = xml_to_markdown(_xml("<a><b>x</b></a>"))
    assert "## Raw XML Source" in md and "<b>x</b>" in md


# --- CSV ---------------------------------------------------------------------
# Docling reads the .csv; these hold the two things it does not do. It requires
# UTF-8 and raises on anything else, so the CSV an analyst exports from Excel
# on Windows -- cp1252, and semicolon-separated in most of Europe -- is exactly
# the file that fails. And it returns a bare table, with no heading for the
# chunker to file the rows under.


def _csv(body: str, name: str = "returns.csv", encoding: str = "utf-8") -> Path:
    path = Path(tempfile.mkdtemp()) / name
    path.write_bytes(body.encode(encoding))
    return path


ROWS = (
    'Step,Actor,Rule,Threshold\n'
    '10,CSR,"Create returns order with reference to the invoice",n/a\n'
    '20,Credit Analyst,"If exposure > limit, block Z1 is applied",INR 5_00_000\n'
    '40,Finance,"Approve credit memo -> post to ledger",EUR 10.000\n'
)


def test_csv_is_an_accepted_format():
    assert ".csv" in CSV_FORMATS


def test_a_csv_becomes_one_markdown_table():
    md = csv_to_markdown(_csv(ROWS), title="Returns")
    assert md.startswith("# Returns\n")
    assert "| Step" in md or "|   Step" in md      # a header row, however padded
    assert md.count("\n|") >= 4                    # header, rule, three data rows


def test_the_cells_a_quote_would_be_checked_against_are_unchanged():
    # The same property the .txt branch exists for. A Markdown parse would
    # turn `->` into `-&gt;` and `5_00_000` into `5\_00_000`; the CSV backend
    # does not, and these are the strings an agent would quote.
    md = csv_to_markdown(_csv(ROWS))
    for probe in ("exposure > limit", "INR 5_00_000",
                  "Approve credit memo -> post to ledger", "EUR 10.000"):
        assert probe in md, f"the converter altered: {probe!r}"


def test_a_windows_excel_export_converts_instead_of_failing():
    """The case that made this a wrapper rather than a pass-through: Docling
    rejects a non-UTF-8 file outright ("is not valid"), and cp1252 with
    semicolons is what Excel writes across most of Europe."""
    md = csv_to_markdown(_csv(
        "Étape;Acteur;Règle\n"
        "10;Chargé clientèle;Créer l'avoir – montant 50–100 EUR\n",
        encoding="cp1252"), title="Avoirs")
    assert "Chargé clientèle" in md
    assert "Créer l'avoir – montant 50–100 EUR" in md
    assert "Règle" in md


def test_a_semicolon_file_is_not_read_as_one_column():
    md = csv_to_markdown(_csv("Step;Actor;Rule\n10;CSR;Create the order\n"))
    body = md.splitlines()[2]
    assert body.count("|") >= 4, f"the delimiter was not detected: {body!r}"


def test_a_utf8_bom_does_not_end_up_in_the_first_heading():
    """Excel writes a BOM. Left in, it becomes part of the first column name,
    and every quote of that header fails to match."""
    md = csv_to_markdown(_csv("Step,Actor\n10,CSR\n", encoding="utf-8-sig"))
    assert "\ufeff" not in md
    assert "| Step" in md or "|   Step" in md


def test_convert_routes_csv_to_the_csv_path():
    result = convert(_csv(ROWS), flows=False, ocr=False, title="Returns")
    assert result.unit == "rows"
    assert result.pages == 3                       # data rows, not the header
    assert "INR 5_00_000" in result.markdown


def test_the_row_count_does_not_include_the_header():
    assert csv_rows(_csv(ROWS)) == 3
    assert csv_rows(_csv("Step,Actor\n")) == 0     # header only


def test_an_empty_csv_is_still_a_document():
    md = csv_to_markdown(_csv(""), title="Nothing")
    assert md == "# Nothing\n\n"


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items())
           if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception:
            failed += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
