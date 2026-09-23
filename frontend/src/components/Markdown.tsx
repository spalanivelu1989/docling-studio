import { Box, type SxProps, type Theme } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useLayoutEffect, useMemo, useRef } from "react";

interface Props {
  source: string;
  /** Draw ```mermaid blocks as diagrams (the Extract page). */
  diagrams?: boolean;
  /** Wrap matches in <mark>; matches containing a digit get class "key". */
  highlight?: RegExp | null;
  /** Turn "[3]" into a clickable citation when 3 is one of these. */
  citations?: Map<number, string>;
  onCite?: (n: number) => void;
  onHoverCite?: (n: number, target: HTMLElement) => void;
  onLeaveCite?: (n: number) => void;
  sx?: SxProps<Theme>;
  dense?: boolean;
}

// Walk text nodes (never markup) outside code, marks and citations.
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("code, pre, mark, .cite, svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function replaceMatches(node: Text, regex: RegExp, make: (m: RegExpMatchArray) => Node | string) {
  const text = node.nodeValue ?? "";
  const matches = [...text.matchAll(regex)];
  if (!matches.length) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of matches) {
    frag.append(text.slice(last, m.index), make(m));
    last = (m.index ?? 0) + m[0].length;
  }
  frag.append(text.slice(last));
  node.replaceWith(frag);
}

let diagramCounter = 0;

export default function Markdown({ source, diagrams, highlight, citations, onCite, onHoverCite, onLeaveCite, sx, dense }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const mode = theme.palette.mode;
  // The Markdown comes from uploaded files and model output: sanitise it.
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source]);
  const citeKey = citations ? [...citations.keys()].join(",") : "";

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = html;

    if (highlight) {
      for (const node of textNodes(root)) {
        replaceMatches(node, highlight, (m) => {
          const mark = document.createElement("mark");
          mark.textContent = m[0];
          if (/\d/.test(m[0])) mark.className = "key";
          return mark;
        });
      }
    }
    if (citations?.size) {
      for (const node of textNodes(root)) {
        replaceMatches(node, /\[(\d{1,2})\]/g, (m) => {
          const n = Number(m[1]);
          if (!citations.has(n)) return m[0];
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cite";
          b.dataset.cite = String(n);
          // When custom hover popover is active, avoid default browser tooltip clash
          if (!onHoverCite) {
            b.title = citations.get(n) ?? "";
          }
          b.setAttribute("aria-label", `Source ${n}: ${citations.get(n) ?? ""}`);
          b.textContent = String(n);
          return b;
        });
      }
    }

    let cancelled = false;
    const blocks = diagrams ? [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")] : [];
    if (blocks.length) {
      import("mermaid").then(async ({ default: mermaid }) => {
        // mermaid bakes its colours into the SVG it emits, so a diagram drawn
        // for one theme stays that way. The effect re-runs on `mode` and
        // rebuilds the block from `html`, which is what keeps a flowchart from
        // ending up as near-black strokes on the dark surface.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // mermaid's own dark theme fills its boxes with #1f2020, which is
          // all but the same colour as the dark surface they are drawn on --
          // a flowchart becomes labels floating on nothing. Drive it from the
          // palette instead so the nodes sit clearly above the page.
          ...(mode === "dark"
            ? {
                theme: "base" as const,
                themeVariables: {
                  darkMode: true,
                  background: theme.palette.background.paper,
                  mainBkg: "#1e2733",
                  primaryColor: "#1e2733",
                  primaryTextColor: theme.palette.text.primary,
                  primaryBorderColor: "#3f4d60",
                  secondaryColor: "#243040",
                  tertiaryColor: "#1a2029",
                  nodeBorder: "#3f4d60",
                  clusterBkg: "#11161c",
                  clusterBorder: theme.palette.divider,
                  lineColor: theme.palette.text.secondary,
                  textColor: theme.palette.text.primary,
                  edgeLabelBackground: theme.palette.background.paper,
                },
              }
            : { theme: "default" as const }),
        });
        for (const code of blocks) {
          if (cancelled) return;
          try {
            const { svg } = await mermaid.render(`diagram-${++diagramCounter}`, code.textContent ?? "");
            const box = document.createElement("div");
            box.className = "diagram";
            box.innerHTML = svg;
            code.parentElement?.replaceWith(box);
          } catch {
            // A malformed graph keeps its source visible instead of blanking the pane.
            code.parentElement?.classList.add("diagram-failed");
          }
        }
      });
    }
    return () => {
      cancelled = true;
    };
    // citeKey stands in for `citations`, which is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlight, citeKey, diagrams, mode]);

  return (
    <Box
      ref={ref}
      onClick={(e) => {
        const cite = (e.target as HTMLElement).closest<HTMLElement>(".cite");
        if (cite && onCite) onCite(Number(cite.dataset.cite));
      }}
      onMouseOver={(e) => {
        const cite = (e.target as HTMLElement).closest<HTMLElement>(".cite");
        if (cite && onHoverCite) onHoverCite(Number(cite.dataset.cite), cite);
      }}
      onMouseOut={(e) => {
        const cite = (e.target as HTMLElement).closest<HTMLElement>(".cite");
        if (cite && onLeaveCite) onLeaveCite(Number(cite.dataset.cite));
      }}
      sx={[
        (theme) => ({
          fontSize: dense ? 13.5 : 15,
          lineHeight: 1.6,
          overflowWrap: "anywhere",
          "& > :first-of-type": { mt: 0 },
          "& h1": { fontSize: dense ? "1em" : "1.4em", m: dense ? ".6em 0 .3em" : "1.3em 0 .5em", pb: dense ? 0 : ".25em", borderBottom: dense ? 0 : `1px solid ${theme.palette.divider}` },
          "& h2": { fontSize: dense ? "1em" : "1.18em", m: dense ? ".6em 0 .3em" : "1.2em 0 .4em" },
          "& h3, & h4": { fontSize: "1em", m: ".8em 0 .3em" },
          "& p, & ul, & ol": { my: dense ? ".4em" : ".6em" },
          "& table": { borderCollapse: "collapse", fontSize: dense ? 12.5 : 14, display: "block", overflowX: "auto", maxWidth: "100%" },
          "& th, & td": { border: `1px solid ${theme.palette.divider}`, p: dense ? "3px 6px" : "6px 9px", textAlign: "left", verticalAlign: "top" },
          "& th": { background: theme.palette.action.hover },
          "& code": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".88em", background: theme.palette.action.hover, px: ".35em", py: ".1em", borderRadius: 1 },
          "& pre": { whiteSpace: "pre-wrap", background: theme.palette.action.hover, p: 1.25, borderRadius: 2 },
          "& pre code": { background: "none", p: 0 },
          "& img": { maxWidth: "100%" },
          "& a": { color: theme.palette.primary.main },
          "& .diagram": { overflowX: "auto", my: 2, p: 1.5, border: `1px solid ${theme.palette.divider}`, borderRadius: 2, background: theme.palette.background.paper },
          "& .diagram svg": { maxWidth: "100%", height: "auto" },
          "& .diagram-failed": { borderLeft: `3px solid ${theme.palette.warning.main}` },
          "& .cite": {
            font: "inherit", fontSize: ".76em", fontWeight: 700, lineHeight: 1.45, cursor: "pointer",
            minWidth: "1.7em", px: ".45em", mx: "2px", verticalAlign: "1.5px", border: 0, borderRadius: "6px",
            color: theme.palette.primary.main,
            background: `color-mix(in srgb, ${theme.palette.primary.main} 14%, transparent)`,
            boxShadow: `0 1px 2px ${theme.palette.mode === "dark" ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)"}`,
            transition: "background .15s ease, color .15s ease, transform .15s ease, box-shadow .15s ease",
            "&:hover": {
              background: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              transform: "translateY(-1px)",
              boxShadow: `0 3px 8px ${theme.palette.mode === "dark" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)"}`,
            },
            "&:active": {
              transform: "translateY(0px)",
            },
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}

/** Find a quoted passage inside the text it was taken from.
 *
 *  `highlightRegex` above marks what a search looked FOR. This marks where one
 *  specific passage IS -- the Evidence Agent's case, where a claim quotes a
 *  sentence and the reader wants to see it in its paragraph.
 *
 *  Two things make the obvious approach fail. Marking runs per text node, so a
 *  quote that crosses an element boundary -- **bold**, `code`, a table cell --
 *  has no single node holding it and a whole-quote regex matches nothing. And
 *  a quote taken from a table is a whole Markdown row, most of whose cells say
 *  nothing about this passage: an author name in one hierarchy sheet matched
 *  193 times, which highlights the document instead of locating the quote.
 *
 *  So the quote is cut at everything that becomes an element, and of the
 *  fragments left, the two that appear LEAST often in `haystack` are kept --
 *  the ones that identify this passage rather than its neighbours. Measured
 *  over every quote the stored runs cite, that is 3.2 marks per document on
 *  average against 70 for the longest-fragment rule, with nothing left
 *  unhighlighted.
 */
export function locateRegex(quote: string, haystack: string): RegExp | null {
  const escape = (f: string) =>
    f.slice(0, 300).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const fragments = quote
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // `_` is deliberately not a cut: it is a word character in SPARK_FS_L2C.
    .split(/\*+|__|~~|`|\||\r?\n|^\s*[-+]\s+|^\s*\d+\.\s+/gm)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
  if (!fragments.length) return null;
  // Counted against the raw Markdown rather than the rendered text: repetition
  // is repetition either way, and this needs no second parse of a 1 MB sheet.
  const seen = new Map<string, number>();
  for (const f of fragments) {
    try {
      seen.set(f, (haystack.match(new RegExp(escape(f), "gi")) || []).length);
    } catch {
      seen.set(f, Number.MAX_SAFE_INTEGER);
    }
  }
  const chosen = [...fragments]
    .sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0))
    .slice(0, 2);
  try {
    return new RegExp(chosen.map(escape).join("|"), "gi");
  } catch {
    return null;
  }
}

/** Highlight what keyword search looked for. The server sends Postgres
 *  lexemes, stemmed ("declar"), so they match as word prefixes. Codes are taken
 *  from the question as typed: their index form ("m090030") is never in the text. */
export function highlightRegex(terms: string[], question: string): RegExp | null {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts: string[] = [];
  for (const t of terms) {
    if (t.startsWith("-") || /^[a-z]\d{5,}$/.test(t) || t.length < 2) continue;
    parts.push(/^[\d.]+$/.test(t) ? `(?<![\\w.])${esc(t)}(?!\\d|\\.\\d)` : `\\b${esc(t)}\\w*`);
  }
  for (const code of question.match(/\b[A-Za-z][A-Za-z0-9]{0,3}-\d{2,3}(?:-\d{2,3})+\b/g) ?? []) {
    parts.push(`\\b${esc(code)}`);
  }
  return parts.length ? new RegExp(parts.join("|"), "gi") : null;
}
