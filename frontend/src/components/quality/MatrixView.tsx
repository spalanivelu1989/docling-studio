/** Metric matrix — every answer against every metric, with a detail pane.
 *
 *  The Answers table ranks; this compares. Laid out as a heatmap, a pattern
 *  that the table hides becomes a stripe: a column that is pale all the way
 *  down (context precision here) is a system-wide weakness, a row that is
 *  pale all the way across is one bad answer. Choosing a row fills the pane
 *  on the right with what the judge actually found -- claims supported,
 *  excerpts that helped -- read from its stored working, so "why 0.40?" is
 *  answered beside the grid rather than behind a click.
 *
 *  Shades are one hue at rising strength, with the text colour fixed, so the
 *  contrast holds in both themes; a score under the line also gets an outline,
 *  so the threshold never rests on telling two shades apart.
 */
import {
  Box, Button, ButtonBase, CircularProgress, Stack, Typography, alpha, useTheme,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

import { askHistory, type AskRunDetail, type FailureType, type QualityPoint } from "../../api";
import { MONO } from "./AnswersView";
import { band, statusOf } from "./charts";
import { finding } from "./findings";
import { Empty, RADIUS } from "./parts";

type Col = { key: string; short: string; name: string };
const COLS: Col[] = [
  { key: "overall", short: "Overall", name: "Overall quality (weighted)" },
  { key: "faithfulness", short: "Faithful.", name: "Faithfulness" },
  { key: "answer_relevancy", short: "Ans. rel.", name: "Answer relevancy" },
  { key: "context_precision", short: "Ctx prec.", name: "Context precision" },
  { key: "context_relevance", short: "Ctx rel.", name: "Context relevance" },
  { key: "context_utilization", short: "Ctx util.", name: "Context utilization" },
  { key: "coherence", short: "Coherence", name: "Coherence" },
  { key: "conciseness", short: "Concise.", name: "Conciseness" },
];

/** The shade steps, strongest first. The last is the warning hue: below 0.40
 *  is a different kind of result, not merely a paler one. */
const STEPS = [0.85, 0.7, 0.55, 0.4];

function shade(theme: Theme, v: number | null): string {
  if (v === null) return "transparent";
  if (v < STEPS[3]) return alpha(theme.palette.warning.main, 0.22);
  // A little stronger on the dark ground, where the same alpha reads fainter.
  const steps = theme.palette.mode === "dark" ? [0.66, 0.46, 0.28, 0.13] : [0.5, 0.34, 0.2, 0.09];
  const strength = steps[STEPS.findIndex((s) => v >= s)];
  return alpha(theme.palette.primary.main, strength);
}

const valueOf = (p: QualityPoint, key: string): number | null =>
  key === "overall" ? p.overall : (p.values?.[key] ?? null);

const when = (at: string | null) => at
  ? new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "";

export default function MatrixView({ points, line, failures, onOpen }: {
  points: QualityPoint[];
  line: number;
  failures: FailureType[];
  onOpen: (p: QualityPoint) => void;
}) {
  const theme = useTheme();
  const [sortKey, setSortKey] = useState("overall");
  const [picked, setPicked] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, AskRunDetail>>({});
  const [loadError, setLoadError] = useState("");
  const causeLabel = Object.fromEntries(failures.map((f) => [f.key, f.label]));

  const rows = useMemo(() => [...points].sort((a, b) =>
    (valueOf(a, sortKey) ?? 2) - (valueOf(b, sortKey) ?? 2)), [points, sortKey]);
  const selectedId = picked && rows.some((r) => r.run_id === picked) ? picked : rows[0]?.run_id ?? null;
  const selected = rows.find((r) => r.run_id === selectedId) ?? null;
  const run = selectedId ? runs[selectedId] : undefined;

  useEffect(() => {
    if (!selectedId || runs[selectedId]) return;
    let stop = false;
    askHistory.run(selectedId)
      .then((r) => { if (!stop) { setRuns((all) => ({ ...all, [selectedId]: r })); setLoadError(""); } })
      .catch((e) => !stop && setLoadError((e as Error).message));
    return () => { stop = true; };
  }, [selectedId, runs]);

  const means = COLS.map((c) => {
    const vs = points.map((p) => valueOf(p, c.key)).filter((v): v is number => v !== null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  });

  if (!points.length) {
    return <Empty>No scored answers match these filters.</Empty>;
  }

  const grid = `minmax(220px, 1fr) repeat(${COLS.length}, 68px) 124px`;
  const cellBase = { height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                     fontFamily: MONO, fontSize: 12.5, borderLeft: 1, borderColor: "background.paper" } as const;

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexDirection: { xs: "column", lg: "row" } }}>
      <Box sx={{ flex: 1, minWidth: 0, width: "100%", border: 1, borderColor: "divider", borderRadius: RADIUS,
                 bgcolor: "background.paper", overflow: "hidden" }}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", px: 2, py: 1.25,
                                                          borderBottom: 1, borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Answer × metric ({rows.length})</Typography>
          <Box sx={{ flex: 1 }} />
          {[["≥ 0.85", 0.9], ["0.70–0.85", 0.75], ["0.55–0.70", 0.6], ["0.40–0.55", 0.45], ["< 0.40", 0.2]].map(([label, v]) => (
            <Stack key={label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 18, height: 12, bgcolor: shade(theme, v as number), border: 1, borderColor: "divider" }} />
              <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{label}</Typography>
            </Stack>
          ))}
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 18, height: 12, boxShadow: `inset 0 0 0 2px ${theme.palette.warning.main}` }} />
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>below {line.toFixed(2)}</Typography>
          </Stack>
        </Stack>
        <Box sx={{ overflowX: "auto" }}>
          <Box sx={{ minWidth: 220 + COLS.length * 68 + 124 }}>
            <Box role="row" sx={{ display: "grid", gridTemplateColumns: grid, bgcolor: alpha(theme.palette.text.primary, 0.03),
                                  borderBottom: 1, borderColor: "divider" }}>
              <Typography role="columnheader" sx={{ px: 1.5, py: 1, fontSize: 12, fontWeight: 600, color: "text.secondary" }}>Question</Typography>
              {COLS.map((c) => (
                <ButtonBase key={c.key} role="columnheader" title={`${c.name}: sort lowest first`} onClick={() => setSortKey(c.key)}
                            aria-sort={sortKey === c.key ? "ascending" : "none"}
                            sx={{ px: 0.5, py: 1, fontSize: 11.5, fontWeight: 600, lineHeight: 1.25,
                                  color: sortKey === c.key ? "primary.main" : "text.secondary",
                                  borderLeft: 1, borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}>
                  {c.short}{sortKey === c.key ? " ↑" : ""}
                </ButtonBase>
              ))}
              <Typography role="columnheader" sx={{ px: 1.25, py: 1, fontSize: 12, fontWeight: 600, color: "text.secondary",
                                                    borderLeft: 1, borderColor: "divider" }}>Cause</Typography>
            </Box>
            {rows.map((p) => {
              const on = p.run_id === selectedId;
              return (
                <Box key={p.run_id} role="row" sx={{
                  display: "grid", gridTemplateColumns: grid, borderBottom: 1, borderColor: "divider",
                  bgcolor: on ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                  outline: on ? `2px solid ${theme.palette.primary.main}` : "none", outlineOffset: -2,
                }}>
                  <ButtonBase onClick={() => setPicked(p.run_id)} aria-pressed={on} title={p.question}
                              sx={{ justifyContent: "flex-start", px: 1.5, height: 36, fontSize: 13, textAlign: "left",
                                    minWidth: 0, "&:hover": { bgcolor: "action.hover" } }}>
                    <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                fontWeight: on ? 600 : 400 }}>{p.question}</Box>
                  </ButtonBase>
                  {COLS.map((c) => {
                    const v = valueOf(p, c.key);
                    return (
                      <Box key={c.key} role="cell" title={`${c.name}: ${v === null ? "not scored" : v.toFixed(2)}`}
                           sx={{ ...cellBase, bgcolor: shade(theme, v), color: "text.primary",
                                 fontWeight: c.key === "overall" ? 600 : 400,
                                 boxShadow: v !== null && v < line ? `inset 0 0 0 2px ${theme.palette.warning.main}` : "none" }}>
                        {v === null ? "—" : v.toFixed(2)}
                      </Box>
                    );
                  })}
                  <Typography role="cell" sx={{ px: 1.25, fontSize: 12, color: "text.secondary", display: "flex",
                                                alignItems: "center", borderLeft: 1, borderColor: "divider" }}>
                    {p.failure ? causeLabel[p.failure] : "—"}
                  </Typography>
                </Box>
              );
            })}
            <Box role="row" sx={{ display: "grid", gridTemplateColumns: grid, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
              <Typography sx={{ px: 1.5, py: 1, fontSize: 12, fontWeight: 600 }}>Mean</Typography>
              {means.map((m, i) => (
                <Typography key={COLS[i].key} sx={{ ...cellBase, fontWeight: 600,
                                                    color: m !== null && m < line ? "warning.main" : "text.primary" }}>
                  {m === null ? "—" : m.toFixed(2)}
                </Typography>
              ))}
              <span />
            </Box>
          </Box>
        </Box>
      </Box>

      <Box component="aside" aria-label="Selected answer" sx={{
        width: { xs: "100%", lg: 400 }, flexShrink: 0, border: 1, borderColor: "divider", borderRadius: RADIUS,
        bgcolor: "background.paper", position: { lg: "sticky" }, top: { lg: 16 },
      }}>
        {selected && (
          <>
            <Stack spacing={0.75} sx={{ px: 2, py: 1.75, borderBottom: 1, borderColor: "divider" }}>
              <Typography sx={{ fontSize: 11.5, color: "text.secondary", fontFamily: MONO }}>
                {selected.run_id} · {when(selected.at)} · {selected.mode}
              </Typography>
              <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{selected.question}</Typography>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline" }}>
                <Typography sx={{ fontFamily: MONO, fontSize: 22, fontWeight: 500 }}>{selected.overall?.toFixed(2) ?? "—"}</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600,
                                  color: selected.overall === null ? "text.secondary" : band(theme, selected.overall) }}>
                  {statusOf(selected.overall).label}{selected.failure ? ` · ${causeLabel[selected.failure]}` : ""}
                </Typography>
              </Stack>
            </Stack>

            <Stack spacing={1.25} sx={{ px: 2, py: 1.5 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>Judge findings</Typography>
              {!run && !loadError && <CircularProgress size={16} />}
              {loadError && <Typography sx={{ fontSize: 12.5, color: "warning.main" }}>{loadError}</Typography>}
              {run?.evaluation && COLS.slice(1).map((c) => {
                const m = run.evaluation!.metrics[c.key];
                const v = m?.value ?? null;
                return (
                  <Box key={c.key} sx={{ display: "grid", gridTemplateColumns: "122px 40px minmax(0, 1fr)", gap: 1, alignItems: "baseline" }}>
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{c.name}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500,
                                      color: v !== null && v < line ? "warning.main" : "text.primary" }}>
                      {v === null ? "—" : v.toFixed(2)}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5 }}>{finding(c.key, m)}</Typography>
                  </Box>
                );
              })}

              {run && run.sources.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", pt: 0.75 }}>
                    Excerpts retrieved ({run.sources.length})
                  </Typography>
                  <Box sx={{ border: 1, borderColor: "divider" }}>
                    {run.sources.map((s, i) => {
                      const w = run.evaluation?.metrics.context_precision?.working;
                      const verdict = w && "kind" in w && w.kind === "excerpts" ? w.items[i]?.useful : undefined;
                      return (
                        <Box key={`${s.n}-${i}`} sx={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) 70px", gap: 1,
                                                        px: 1.25, py: 0.6, fontSize: 12, borderTop: i ? 1 : 0, borderColor: "divider" }}>
                          <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary" }}>{s.n}</Box>
                          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.title}>{s.title}</Box>
                          <Box component="span" sx={{ textAlign: "right",
                                                      color: verdict === undefined ? "text.disabled" : verdict ? "success.main" : "warning.main" }}>
                            {verdict === undefined ? "—" : verdict ? "useful" : "not useful"}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </>
              )}

              <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
                <Button variant="contained" size="small" disableElevation onClick={() => onOpen(selected)}
                        sx={{ textTransform: "none", borderRadius: RADIUS }}>
                  Open judge's working
                </Button>
                <Button variant="outlined" size="small" onClick={() => onOpen(selected)}
                        sx={{ textTransform: "none", borderRadius: RADIUS }}>
                  Add review
                </Button>
              </Stack>
            </Stack>
          </>
        )}
      </Box>
    </Box>
  );
}
