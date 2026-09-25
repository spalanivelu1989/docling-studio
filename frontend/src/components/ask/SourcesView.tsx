/** Sources — Ask RAG's retrieved excerpts in the Fit-Gap Copilot's register
 *  idiom: a sortable, filterable table with the chosen excerpt open beside
 *  it, and a retrieval map one toggle away showing how each ranking signal
 *  scored each excerpt. */
import {
  Box, Button, ButtonBase, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { BookOpen, Check, Download, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Source } from "../../api";
import Markdown from "../Markdown";
import { searchColors } from "../../theme";
import { MONO, RADIUS, usePremium } from "../rollout/premium";
import { Section } from "../rollout/SummaryView";

type SortKey = "score" | "similarity" | "bm25" | "n";

function Chips<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { v: T; label: string; n?: number }[]; onChange: (v: T) => void;
}) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap role="group" aria-label={label} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Typography sx={{ fontSize: 12, color: "text.secondary", mr: 0.25 }}>{label}</Typography>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <ButtonBase key={o.v} onClick={() => onChange(o.v)} aria-pressed={on} disabled={o.n === 0 && !on}
                      sx={{ height: 30, px: 1.25, borderRadius: 15, fontSize: 12.5, gap: 0.75, border: 1,
                            borderColor: on ? "text.primary" : "divider", bgcolor: on ? "text.primary" : "background.paper",
                            color: on ? "background.paper" : "text.primary", opacity: o.n === 0 && !on ? 0.45 : 1 }}>
            {o.label}{o.n !== undefined && <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, opacity: 0.7 }}>{o.n}</Box>}
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

function Signal({ value, fraction, colour, empty }: { value: string; fraction: number; colour: string; empty?: boolean }) {
  return (
    <Stack spacing={0.4} sx={{ opacity: empty ? 0.5 : 1 }}>
      <Box sx={{ height: 8, bgcolor: "action.selected" }}>
        <Box sx={{ height: 8, width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, bgcolor: colour }} />
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{value}</Typography>
    </Stack>
  );
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function SourcesView({ sources, cited, highlight, focus, onInspect, showCategory, fileStem }: {
  sources: Source[];
  cited: Set<number>;
  highlight: RegExp | null;
  /** An excerpt to open, when the reader arrives from a citation. */
  focus?: { n: number; at: number } | null;
  onInspect: (s: Source) => void;
  showCategory: boolean;
  fileStem: string;
}) {
  const theme = useTheme();
  const p = usePremium();
  const colors = searchColors[theme.palette.mode];
  const [view, setView] = useState<"register" | "map">("register");
  const [sort, setSort] = useState<SortKey>("score");
  const [only, setOnly] = useState<"all" | "cited" | "uncited">("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number>(sources[0]?.n ?? 1);

  useEffect(() => {
    if (!focus) return;
    setView("register"); setOnly("all"); setQ(""); setSel(focus.n);
    setTimeout(() => document.getElementById(`source-${focus.n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }, [focus]);
  useEffect(() => { if (!sources.some((s) => s.n === sel) && sources[0]) setSel(sources[0].n); }, [sources, sel]);

  const maxScore = Math.max(0, ...sources.map((s) => s.score)) || 1;
  const maxBm25 = Math.max(0, ...sources.map((s) => s.bm25 ?? 0)) || 1;
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...sources]
      .filter((s) => (only === "cited" ? cited.has(s.n) : only === "uncited" ? !cited.has(s.n) : true))
      .filter((s) => !t || `${s.title} ${s.section} ${s.content}`.toLowerCase().includes(t))
      .sort((a, b) => sort === "n" ? a.n - b.n : (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
  }, [sources, only, q, sort, cited]);
  const s = sources.find((x) => x.n === sel) ?? null;

  const exportCsv = () => {
    const head = ["n", "document", "section", "category", "combined", "semantic", "vector_rank", "keyword", "keyword_rank", "cited"];
    const lines = rows.map((x) => [x.n, x.title, x.section, x.category, x.score.toFixed(4), x.similarity ?? "", x.vector_rank ?? "",
                                   x.bm25 ?? "", x.keyword_rank ?? "", cited.has(x.n) ? "yes" : "no"].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${fileStem}-sources.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const toolbar = (
    <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, px: 2, py: 1.5,
               display: "flex", alignItems: "center", gap: 2.5, flexWrap: "wrap" }}>
      <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="View"
                         sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 13, px: 1.75, py: 0.5, borderRadius: RADIUS } }}>
        <ToggleButton value="register">Register</ToggleButton>
        <ToggleButton value="map">Retrieval map</ToggleButton>
      </ToggleButtonGroup>
      {view === "register" ? (
        <>
          <TextField size="small" placeholder="Document, section or text" value={q} onChange={(e) => setQ(e.target.value)}
                     slotProps={{ htmlInput: { "aria-label": "Search sources" },
                                  input: { startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> } }}
                     sx={{ width: 230, "& .MuiInputBase-input": { fontSize: 13, py: 0.8 }, "& .MuiOutlinedInput-root": { borderRadius: RADIUS } }} />
          <Chips label="Show" value={only} onChange={setOnly} options={[
            { v: "all", label: "All", n: sources.length },
            { v: "cited", label: "Cited", n: sources.filter((x) => cited.has(x.n)).length },
            { v: "uncited", label: "Not cited", n: sources.filter((x) => !cited.has(x.n)).length },
          ]} />
          <Chips label="Rank by" value={sort} onChange={setSort} options={[
            { v: "score", label: "Combined" }, { v: "similarity", label: "Semantic" }, { v: "bm25", label: "Keyword" }, { v: "n", label: "Citation no." },
          ]} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
                  sx={{ textTransform: "none", borderRadius: RADIUS }}>Export CSV</Button>
        </>
      ) : (
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          How each search signal scored each excerpt. Click an excerpt to open it in the register.
        </Typography>
      )}
    </Box>
  );

  if (view === "map") {
    return (
      <Stack spacing={2}>
        {toolbar}
        <RetrievalMap sources={sources} cited={cited} onPick={(n) => { setSel(n); setView("register"); setOnly("all"); setQ(""); }} />
      </Stack>
    );
  }

  const grid = `48px minmax(0, 1fr) ${showCategory ? "56px " : ""}110px 110px 110px 64px`;
  return (
    <Stack spacing={2}>
      {toolbar}
      <Box sx={{ display: "grid", gap: 2.5, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 500px" } }}>
        <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, overflowX: "auto", minWidth: 0 }}>
          <Box sx={{ minWidth: 720 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, px: 2.25, py: 1.1, bgcolor: "action.hover",
                       borderBottom: 1, borderColor: "divider", "& > *": { fontSize: 12, fontWeight: 600, color: "text.secondary" } }}>
              <span>#</span><span>Document · section</span>{showCategory && <span>Category</span>}
              <span>Combined</span><span>Semantic</span><span>Keyword</span><span>Cited</span>
            </Box>
            {rows.map((x) => {
              const on = x.n === sel;
              return (
                <ButtonBase key={x.n} id={`source-${x.n}`} onClick={() => setSel(x.n)} aria-pressed={on}
                            sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, alignItems: "start", width: "100%", textAlign: "left",
                                  px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider", scrollMarginTop: 80,
                                  bgcolor: on ? "action.selected" : "transparent", boxShadow: on ? `inset 3px 0 0 ${p.accent}` : "none",
                                  "&:hover": { bgcolor: on ? "action.selected" : "action.hover" } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent }}>[{x.n}]</Typography>
                  <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, overflowWrap: "anywhere" }}>{x.title}</Typography>
                    <Typography sx={{ fontSize: 12, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                title={x.section}>{x.section || "(start of document)"}</Typography>
                  </Stack>
                  {showCategory && <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{x.category}</Typography>}
                  <Signal value={x.score.toFixed(4)} fraction={x.score / maxScore} colour={colors.combined} />
                  <Signal value={x.similarity == null ? "not in top 40" : `${x.similarity.toFixed(3)}${x.vector_rank ? ` · #${x.vector_rank}` : ""}`}
                          fraction={x.similarity ?? 0} colour={colors.vector} empty={x.similarity == null} />
                  <Signal value={x.bm25 == null ? "no match" : `${x.bm25.toFixed(2)}${x.keyword_rank ? ` · #${x.keyword_rank}` : ""}`}
                          fraction={(x.bm25 ?? 0) / maxBm25} colour={colors.keyword} empty={x.bm25 == null} />
                  <Typography sx={{ fontSize: 12.5, fontWeight: cited.has(x.n) ? 600 : 400, color: cited.has(x.n) ? p.accent : "text.disabled" }}>
                    {cited.has(x.n) ? "Cited" : "—"}
                  </Typography>
                </ButtonBase>
              );
            })}
            {!rows.length && <Typography sx={{ fontSize: 13, color: "text.secondary", p: 3 }}>No excerpt matches these filters.</Typography>}
          </Box>
        </Box>

        <Box component="aside" aria-label="Excerpt detail"
             sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS,
                   position: { lg: "sticky" }, top: { lg: 16 }, maxHeight: { lg: "calc(100vh - 32px)" }, overflowY: { lg: "auto" } }}>
          {s && (
            <>
              <Stack spacing={1.25} sx={{ px: 2.75, pt: 2.25, pb: 2 }}>
                <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: p.accent }}>[{s.n}]</Typography>
                  {s.category && <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{s.category}</Typography>}
                  <Box sx={{ flex: 1 }} />
                  {cited.has(s.n)
                    ? <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: p.accent }}><Check size={13} /><Typography sx={{ fontSize: 12, fontWeight: 600 }}>Cited in the answer</Typography></Stack>
                    : <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Retrieved, not cited</Typography>}
                </Stack>
                <Typography component="h2" sx={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.4, overflowWrap: "anywhere" }}>{s.title}</Typography>
                <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{s.section || "(start of document)"}</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", border: 1, borderColor: "divider", borderRadius: RADIUS }}>
                  {[
                    { l: "Combined (RRF)", v: s.score.toFixed(4), c: colors.combined },
                    { l: "Semantic", v: s.similarity == null ? "—" : s.similarity.toFixed(3), sub: s.vector_rank ? `rank #${s.vector_rank}` : "not in top 40", c: colors.vector },
                    { l: "Keyword (BM25)", v: s.bm25 == null ? "—" : s.bm25.toFixed(2), sub: s.keyword_rank ? `rank #${s.keyword_rank}` : "no match", c: colors.keyword },
                  ].map((k, i) => (
                    <Stack key={k.l} spacing={0.25} sx={{ px: 1.5, py: 1.1, borderLeft: i ? 1 : 0, borderColor: "divider" }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                        <Box sx={{ width: 8, height: 8, bgcolor: k.c }} />
                        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{k.l}</Typography>
                      </Stack>
                      <Typography sx={{ fontFamily: MONO, fontSize: 17, fontWeight: 500 }}>{k.v}</Typography>
                      {k.sub && <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{k.sub}</Typography>}
                    </Stack>
                  ))}
                </Box>
                <Button variant="outlined" size="small" startIcon={<BookOpen size={14} />} onClick={() => onInspect(s)}
                        sx={{ alignSelf: "flex-start", textTransform: "none", borderRadius: RADIUS }}>
                  Inspect in the full document
                </Button>
              </Stack>
              <Stack spacing={1.25} sx={{ px: 2.75, py: 2, borderTop: 1, borderColor: "divider" }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "text.secondary" }}>EXCERPT</Typography>
                <Box sx={{ bgcolor: "background.default", border: 1, borderColor: "divider", borderRadius: RADIUS, px: 1.75, py: 1.25 }}>
                  <Markdown source={s.content} highlight={highlight} dense />
                </Box>
              </Stack>
            </>
          )}
        </Box>
      </Box>
    </Stack>
  );
}

/** Retrieval map — design D2 for excerpts: every excerpt against the three
 *  signals as a heat map, with the documents they came from beside it. */
function RetrievalMap({ sources, cited, onPick }: { sources: Source[]; cited: Set<number>; onPick: (n: number) => void }) {
  const theme = useTheme();
  const p = usePremium();
  const colors = searchColors[theme.palette.mode];
  const maxScore = Math.max(0, ...sources.map((s) => s.score)) || 1;
  const maxBm25 = Math.max(0, ...sources.map((s) => s.bm25 ?? 0)) || 1;
  const docs = useMemo(() => {
    const m: Record<string, { n: number; cited: number }> = {};
    for (const s of sources) {
      m[s.title] ??= { n: 0, cited: 0 };
      m[s.title].n++;
      if (cited.has(s.n)) m[s.title].cited++;
    }
    return Object.entries(m).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  }, [sources, cited]);
  const maxDoc = Math.max(1, ...docs.map(([, d]) => d.n));
  const both = sources.filter((s) => s.similarity != null && s.bm25 != null).length;
  const vecOnly = sources.filter((s) => s.similarity != null && s.bm25 == null).length;
  const kwOnly = sources.filter((s) => s.similarity == null && s.bm25 != null).length;

  const cell = (fraction: number | null, colour: string, label: string): ReactNode => (
    <Box sx={{ py: 0.5, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
      <Box sx={{ height: 32, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "2px",
                 fontFamily: MONO, fontSize: 12, fontWeight: 600,
                 bgcolor: fraction == null ? "transparent" : alpha(colour, 0.15 + 0.7 * fraction),
                 color: fraction != null && fraction > 0.6 ? (p.dark ? p.onAccent : "#ffffff") : "text.primary" }}>
        {fraction == null ? <Box component="span" sx={{ color: "text.disabled" }}>—</Box> : label}
      </Box>
    </Box>
  );

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.45fr) minmax(0, 1fr)" } }}>
        <Section title="Documents retrieved" hint={`${docs.length} documents · ${sources.length} excerpts · ${cited.size} cited`}>
          <Stack spacing={1}>
            {docs.map(([title, d]) => (
              <Box key={title} title={title} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px 48px", gap: 1.25, alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</Typography>
                <Box sx={{ height: 10, bgcolor: "action.hover", display: "flex" }}>
                  <Box sx={{ height: 10, width: `${(d.cited / maxDoc) * 100}%`, bgcolor: p.accent }} />
                  <Box sx={{ height: 10, width: `${((d.n - d.cited) / maxDoc) * 100}%`, bgcolor: theme.palette.text.disabled }} />
                </Box>
                <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{d.cited}/{d.n}</Typography>
              </Box>
            ))}
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}><Box sx={{ width: 10, height: 10, bgcolor: p.accent }} /><Typography sx={{ fontSize: 12, color: "text.secondary" }}>Cited</Typography></Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}><Box sx={{ width: 10, height: 10, bgcolor: "text.disabled" }} /><Typography sx={{ fontSize: 12, color: "text.secondary" }}>Retrieved only</Typography></Stack>
          </Stack>
        </Section>
        <Section title="Which search found them">
          <Stack spacing={1}>
            {[
              { l: "Both searches", n: both, c: colors.combined },
              { l: "Meaning only (vector)", n: vecOnly, c: colors.vector },
              { l: "Words only (keyword)", n: kwOnly, c: colors.keyword },
            ].map((r) => (
              <Box key={r.l} sx={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr) 24px", gap: 1.25, alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5 }}>{r.l}</Typography>
                <Box sx={{ height: 10, bgcolor: "action.hover" }}><Box sx={{ height: 10, width: `${(r.n / Math.max(1, sources.length)) * 100}%`, bgcolor: r.c }} /></Box>
                <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{r.n}</Typography>
              </Box>
            ))}
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 2 }}>
            Excerpts found by both searches are the ones the fusion trusts most; one found by a single search is either a
            code match (keyword) or a paraphrase (vector).
          </Typography>
        </Section>
      </Box>

      <Section pad={false} title="Excerpts × signals" hint="darker = stronger, relative to this question's best">
        <Box sx={{ overflowX: "auto", px: 2.5, pb: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "52px minmax(220px, 1fr) repeat(3, minmax(96px, 130px)) 72px",
                     columnGap: 0.75, alignItems: "center", minWidth: 760 }}>
            {["#", "Document · section", "Combined", "Semantic", "Keyword", "Cited"].map((h, i) => (
              <Typography key={h} sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", pb: 0.75, textAlign: i >= 2 && i <= 4 ? "center" : "left" }}>{h}</Typography>
            ))}
            {sources.map((s) => [
              <ButtonBase key={`${s.n}-n`} onClick={() => onPick(s.n)}
                          sx={{ justifyContent: "flex-start", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent, py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch" }}>
                [{s.n}]
              </ButtonBase>,
              <Typography key={`${s.n}-t`} title={`${s.title} — ${s.section}`}
                          sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", py: 1, borderTop: 1, borderColor: "divider",
                                alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                {s.title}{s.section ? ` · ${s.section}` : ""}
              </Typography>,
              <Box key={`${s.n}-c`} sx={{ display: "contents" }}>{cell(s.score / maxScore, colors.combined, s.score.toFixed(4))}</Box>,
              <Box key={`${s.n}-v`} sx={{ display: "contents" }}>{cell(s.similarity, colors.vector, s.similarity?.toFixed(3) ?? "")}</Box>,
              <Box key={`${s.n}-k`} sx={{ display: "contents" }}>{cell(s.bm25 == null ? null : s.bm25 / maxBm25, colors.keyword, s.bm25?.toFixed(2) ?? "")}</Box>,
              <Typography key={`${s.n}-x`} sx={{ fontSize: 12.5, fontWeight: cited.has(s.n) ? 600 : 400, color: cited.has(s.n) ? p.accent : "text.disabled",
                                                py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                {cited.has(s.n) ? "Cited" : "—"}
              </Typography>,
            ])}
          </Box>
        </Box>
      </Section>
    </Stack>
  );
}
