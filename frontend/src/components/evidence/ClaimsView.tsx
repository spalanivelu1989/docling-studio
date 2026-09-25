/** Claims — the Evidence Agent's answer taken apart, in the Fit-Gap
 *  Copilot's register idiom: a filterable table of claims with the chosen one
 *  open in an inspector beside it, and an evidence map one toggle away. The
 *  inspector carries the score's arithmetic as a table, the graph facts and
 *  every quote, so nothing the old claim cards showed is lost. */
import {
  Box, Button, ButtonBase, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup,
  Typography, useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Download, Network, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { EvidenceClaim, EvidenceSource } from "../../api";
import { MONO, RADIUS, usePremium } from "../rollout/premium";
import { Section } from "../rollout/SummaryView";

export const strength = (score: number) => score >= 0.65 ? "Strong" : score >= 0.4 ? "Moderate" : "Weak";

export function useScoreColour() {
  const theme = useTheme();
  const p = usePremium();
  return (score: number) => score >= 0.65 ? p.accent : score >= 0.4 ? theme.palette.warning.main : theme.palette.error.main;
}

/** A 0–1 score as a bar and its figure. */
export function ScoreBar({ score, width = 64 }: { score: number; width?: number }) {
  const colour = useScoreColour();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box sx={{ width, height: 8, bgcolor: "action.selected", flex: "none" }}>
        <Box sx={{ height: 8, width: `${Math.max(0, Math.min(1, score)) * 100}%`, bgcolor: colour(score) }} />
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: colour(score) }}>{score.toFixed(2)}</Typography>
    </Stack>
  );
}

function Chips<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { v: T; label: string; n: number }[]; onChange: (v: T) => void;
}) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap role="group" aria-label={label} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Typography sx={{ fontSize: 12, color: "text.secondary", mr: 0.25 }}>{label}</Typography>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <ButtonBase key={o.v} onClick={() => onChange(o.v)} aria-pressed={on} disabled={!o.n && !on}
                      sx={{ height: 30, px: 1.25, borderRadius: 15, fontSize: 12.5, gap: 0.75, border: 1,
                            borderColor: on ? "text.primary" : "divider", bgcolor: on ? "text.primary" : "background.paper",
                            color: on ? "background.paper" : "text.primary", opacity: !o.n && !on ? 0.45 : 1 }}>
            {o.label}<Box component="span" sx={{ fontFamily: MONO, fontSize: 12, opacity: 0.7 }}>{o.n}</Box>
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25} sx={{ px: 2.75, py: 2, borderTop: 1, borderColor: "divider" }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "text.secondary" }}>{title}</Typography>
      {children}
    </Stack>
  );
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

type Filter = "all" | "Strong" | "Moderate" | "Weak" | "opposed" | "graph";

export default function ClaimsView({ claims, focus, renderSource, fileStem }: {
  claims: EvidenceClaim[];
  /** A claim to open, when the reader arrives from the Answer tab. */
  focus?: { index: number; at: number } | null;
  renderSource: (s: EvidenceSource, key: number) => ReactNode;
  fileStem: string;
}) {
  const theme = useTheme();
  const p = usePremium();
  const colour = useScoreColour();
  const [view, setView] = useState<"register" | "map">("register");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!focus) return;
    setView("register"); setFilter("all"); setQ(""); setSel(focus.index);
  }, [focus]);
  useEffect(() => { if (sel >= claims.length) setSel(0); }, [claims, sel]);

  const rows = claims.map((c, i) => ({ c, i })).filter(({ c }) => {
    if (filter === "Strong" || filter === "Moderate" || filter === "Weak") { if (strength(c.score) !== filter) return false; }
    if (filter === "opposed" && !c.sources.some((s) => s.stance === "opposes")) return false;
    if (filter === "graph" && !c.graph_facts.length) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      const hay = [c.text, c.note, ...c.sources.map((s) => `${s.doc} ${s.quote}`), ...c.graph_facts.map((g) => g.statement)].join(" ").toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
  const count = (f: (c: EvidenceClaim) => boolean) => claims.filter(f).length;
  const claim = claims[sel] ?? null;

  const exportCsv = () => {
    const head = ["claim", "text", "score", "strength", "supporting", "independent_documents", "opposing", "graph_facts", "unverified_quotes", "note"];
    const lines = rows.map(({ c, i }) => [i + 1, c.text, c.score.toFixed(2), strength(c.score),
      c.sources.filter((s) => s.stance === "supports").length, c.independent_sources,
      c.sources.filter((s) => s.stance === "opposes").length, c.graph_facts.length,
      c.sources.filter((s) => s.verified === false).length, c.note].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${fileStem}-claims.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!claims.length) {
    return (
      <Section title="Claims">
        <Typography sx={{ fontSize: 13.5 }}>
          This answer makes no claim that rests on a source — it is a state (not in the corpus, unrepresentable) rather than a finding.
        </Typography>
      </Section>
    );
  }

  const toolbar = (
    <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, px: 2, py: 1.5,
               display: "flex", alignItems: "center", gap: 2.5, flexWrap: "wrap" }}>
      <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="View"
                         sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 13, px: 1.75, py: 0.5, borderRadius: RADIUS } }}>
        <ToggleButton value="register">Register</ToggleButton>
        <ToggleButton value="map">Evidence map</ToggleButton>
      </ToggleButtonGroup>
      {view === "register" ? (
        <>
          <TextField size="small" placeholder="Claim, document or quote" value={q} onChange={(e) => setQ(e.target.value)}
                     slotProps={{ htmlInput: { "aria-label": "Search claims" },
                                  input: { startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> } }}
                     sx={{ width: 230, "& .MuiInputBase-input": { fontSize: 13, py: 0.8 }, "& .MuiOutlinedInput-root": { borderRadius: RADIUS } }} />
          <Chips label="Show" value={filter} onChange={setFilter} options={[
            { v: "all", label: "All", n: claims.length },
            { v: "Strong", label: "Strong", n: count((c) => strength(c.score) === "Strong") },
            { v: "Moderate", label: "Moderate", n: count((c) => strength(c.score) === "Moderate") },
            { v: "Weak", label: "Weak", n: count((c) => strength(c.score) === "Weak") },
            { v: "opposed", label: "Opposed", n: count((c) => c.sources.some((s) => s.stance === "opposes")) },
            { v: "graph", label: "Graph-backed", n: count((c) => c.graph_facts.length > 0) },
          ]} />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{rows.length} of {claims.length} shown</Typography>
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
                  sx={{ textTransform: "none", borderRadius: RADIUS }}>Export CSV</Button>
        </>
      ) : (
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          Which documents carry which claims. Click a claim to open it in the register.
        </Typography>
      )}
    </Box>
  );

  if (view === "map") {
    return (
      <Stack spacing={2}>
        {toolbar}
        <EvidenceMap claims={claims} onPick={(i) => { setSel(i); setView("register"); setFilter("all"); setQ(""); }} />
      </Stack>
    );
  }

  const grid = "44px minmax(0, 1fr) 120px 96px 72px 64px";
  return (
    <Stack spacing={2}>
      {toolbar}
      <Box sx={{ display: "grid", gap: 2.5, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 480px" } }}>
        <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, overflowX: "auto", minWidth: 0 }}>
          <Box sx={{ minWidth: 640 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, px: 2.25, py: 1.1, bgcolor: "action.hover",
                       borderBottom: 1, borderColor: "divider", "& > *": { fontSize: 12, fontWeight: 600, color: "text.secondary" } }}>
              <span>#</span><span>Claim</span><span>Score</span><span>Sources</span><span>Opposing</span><span>Graph</span>
            </Box>
            {rows.map(({ c, i }) => {
              const on = i === sel;
              const supports = c.sources.filter((s) => s.stance === "supports").length;
              const opposes = c.sources.filter((s) => s.stance === "opposes").length;
              const unverified = c.sources.filter((s) => s.verified === false).length;
              return (
                <ButtonBase key={i} id={`claim-${i}`} onClick={() => setSel(i)} aria-pressed={on}
                            sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, alignItems: "start", width: "100%", textAlign: "left",
                                  px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider",
                                  bgcolor: on ? "action.selected" : "transparent", boxShadow: on ? `inset 3px 0 0 ${p.accent}` : "none",
                                  "&:hover": { bgcolor: on ? "action.selected" : "action.hover" } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent }}>C{i + 1}</Typography>
                  <Stack spacing={0.4} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.45 }}>{c.text}</Typography>
                    {(c.note || unverified > 0) && (
                      <Typography sx={{ fontSize: 12, color: "warning.main" }}>
                        {[unverified ? `${unverified} unverified quote${unverified === 1 ? "" : "s"}` : "", c.note].filter(Boolean).join(" · ")}
                      </Typography>
                    )}
                  </Stack>
                  <Stack spacing={0.4}>
                    <ScoreBar score={c.score} width={52} />
                    <Typography sx={{ fontSize: 12, color: colour(c.score) }}>{strength(c.score)}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12.5 }} title={`${c.independent_sources} independent document(s)`}>
                    {supports} · <Box component="span" sx={{ color: "text.secondary" }}>{c.independent_sources} doc{c.independent_sources === 1 ? "" : "s"}</Box>
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12.5, color: opposes ? "error.main" : "text.disabled" }}>{opposes || "—"}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12.5, color: c.graph_facts.length ? "info.main" : "text.disabled" }}>
                    {c.graph_facts.length || "—"}
                  </Typography>
                </ButtonBase>
              );
            })}
            {!rows.length && <Typography sx={{ fontSize: 13, color: "text.secondary", p: 3 }}>No claim matches these filters.</Typography>}
          </Box>
        </Box>

        <Box component="aside" aria-label="Claim detail"
             sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS,
                   position: { lg: "sticky" }, top: { lg: 16 }, maxHeight: { lg: "calc(100vh - 32px)" }, overflowY: { lg: "auto" } }}>
          {claim && (
            <>
              <Stack spacing={1.25} sx={{ px: 2.75, pt: 2.25, pb: 2 }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: p.accent }}>C{sel + 1}</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: colour(claim.score) }}>{strength(claim.score)} claim</Typography>
                </Stack>
                <Typography component="h2" sx={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.45 }}>{claim.text}</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", border: 1, borderColor: "divider", borderRadius: RADIUS }}>
                  {[
                    { l: "Score", v: claim.score.toFixed(2), c: colour(claim.score) },
                    { l: "Independent documents", v: String(claim.independent_sources) },
                    { l: "Quotes", v: `${claim.sources.length}` },
                  ].map((k, i) => (
                    <Stack key={k.l} spacing={0.25} sx={{ px: 1.5, py: 1.1, borderLeft: i ? 1 : 0, borderColor: "divider" }}>
                      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{k.l}</Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: 18, fontWeight: 500, color: k.c }}>{k.v}</Typography>
                    </Stack>
                  ))}
                </Box>
                {claim.note && <Typography sx={{ fontSize: 12.5, color: "warning.main" }}>{claim.note}</Typography>}
              </Stack>

              <Block title="HOW THE SCORE WAS REACHED">
                {claim.score_terms.length ? (
                  <Box sx={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", rowGap: 0.75, columnGap: 1.5 }}>
                    {claim.score_terms.map((t, i) => (
                      <Box key={i} sx={{ display: "contents" }}>
                        <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600,
                                          color: t.cap != null ? "warning.main" : t.delta >= 0 ? p.accent : "error.main" }}>
                          {t.cap != null ? `cap ${t.cap.toFixed(2)}` : `${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}`}
                        </Typography>
                        <Typography sx={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <b>{t.rule}</b>{t.detail ? ` — ${t.detail}` : ""}
                        </Typography>
                      </Box>
                    ))}
                    <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, borderTop: 1, borderColor: "divider", pt: 0.75 }}>
                      = {claim.score.toFixed(2)}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: "text.secondary", borderTop: 1, borderColor: "divider", pt: 0.75 }}>
                      Arithmetic over the evidence, not the model's opinion.
                    </Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>No terms were recorded for this score.</Typography>
                )}
              </Block>

              {claim.graph_facts.length > 0 && (
                <Block title={`KNOWLEDGE GRAPH · ${claim.graph_facts.length}`}>
                  {claim.graph_facts.map((f, i) => (
                    <Stack key={i} spacing={0.5} sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: RADIUS,
                                                       bgcolor: alpha(f.meaningful ? theme.palette.info.main : theme.palette.warning.main, 0.06) }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                        <Network size={12} />
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: f.meaningful ? "info.main" : "warning.main" }}>
                          {f.meaningful ? "Graph confirms" : "Graph route flagged"}
                        </Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 12.5, lineHeight: 1.5 }}>{f.statement}</Typography>
                      {f.note && <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{f.note}</Typography>}
                    </Stack>
                  ))}
                </Block>
              )}

              <Block title={`EVIDENCE · ${claim.sources.length}`}>
                {claim.sources.length
                  ? <Stack spacing={1}>{claim.sources.map((s, i) => renderSource(s, i))}</Stack>
                  : <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>No quote is attached to this claim.</Typography>}
              </Block>
            </>
          )}
        </Box>
      </Box>
    </Stack>
  );
}

/** Evidence map — design D2 for claims: which documents carry which claims,
 *  quotes counted per cell and coloured by stance, with the document mix and
 *  the stance mix beside it. */
function EvidenceMap({ claims, onPick }: { claims: EvidenceClaim[]; onPick: (i: number) => void }) {
  const theme = useTheme();
  const p = usePremium();
  const { docs, cells } = useMemo(() => {
    const byDoc: Record<string, number> = {};
    const cells: Record<string, { sup: number; opp: number; ctx: number }> = {};
    claims.forEach((c, i) => c.sources.forEach((s) => {
      byDoc[s.doc] = (byDoc[s.doc] ?? 0) + 1;
      const k = `${i}|${s.doc}`;
      cells[k] ??= { sup: 0, opp: 0, ctx: 0 };
      if (s.stance === "supports") cells[k].sup++; else if (s.stance === "opposes") cells[k].opp++; else cells[k].ctx++;
    }));
    const docs = Object.keys(byDoc).sort((a, b) => byDoc[b] - byDoc[a] || a.localeCompare(b)).map((d) => ({ doc: d, n: byDoc[d] }));
    return { docs, cells };
  }, [claims]);

  const all = claims.flatMap((c) => c.sources);
  const stance = [
    { k: "supports", l: "Supporting", n: all.filter((s) => s.stance === "supports").length, c: p.accent },
    { k: "opposes", l: "Opposing", n: all.filter((s) => s.stance === "opposes").length, c: theme.palette.error.main },
    { k: "context", l: "Context", n: all.filter((s) => s.stance === "context").length, c: theme.palette.text.disabled },
  ];
  const flags: Record<string, number> = {};
  all.forEach((s) => s.provenance.forEach((f) => { flags[f] = (flags[f] ?? 0) + 1; }));
  const unverified = all.filter((s) => s.verified === false).length;
  const max = Math.max(1, ...docs.map((d) => d.n));
  const short = (d: string) => d.replace(/\s*\((pdf|docx|pptx|xlsx|md|html)\)$/i, "");

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.45fr) minmax(0, 1fr)" } }}>
        <Section title="Documents behind the answer" hint={`${docs.length} documents · ${all.length} quotes`}>
          <Stack spacing={1}>
            {docs.map((d) => (
              <Box key={d.doc} title={d.doc} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px 28px", gap: 1.25, alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{short(d.doc)}</Typography>
                <Box sx={{ height: 10, bgcolor: "action.hover" }}><Box sx={{ height: 10, width: `${(d.n / max) * 100}%`, bgcolor: p.dark ? theme.palette.text.secondary : p.band }} /></Box>
                <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{d.n}</Typography>
              </Box>
            ))}
          </Stack>
        </Section>
        <Section title="What the quotes do">
          <Stack spacing={1}>
            {stance.map((s) => (
              <Box key={s.k} sx={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr) 28px", gap: 1.25, alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5 }}>{s.l}</Typography>
                <Box sx={{ height: 10, bgcolor: "action.hover" }}><Box sx={{ height: 10, width: `${(s.n / Math.max(1, all.length)) * 100}%`, bgcolor: s.c }} /></Box>
                <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{s.n}</Typography>
              </Box>
            ))}
          </Stack>
          <Typography component="h3" sx={{ fontSize: 15, fontWeight: 600, mt: 2.5, mb: 1 }}>Reliability flags</Typography>
          <Stack spacing={0.75}>
            <Typography sx={{ fontSize: 12.5 }}>
              <Box component="span" sx={{ fontFamily: MONO, color: unverified ? "error.main" : "text.secondary", mr: 1 }}>{unverified}</Box>
              quote{unverified === 1 ? "" : "s"} not found in the chunk named — discarded from the score
            </Typography>
            {Object.entries(flags).map(([f, n]) => (
              <Typography key={f} sx={{ fontSize: 12.5 }}>
                <Box component="span" sx={{ fontFamily: MONO, color: "warning.main", mr: 1 }}>{n}</Box>{f.replace(/_/g, " ")}
              </Typography>
            ))}
            {!Object.keys(flags).length && <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>No source carries a provenance warning.</Typography>}
          </Stack>
        </Section>
      </Box>

      <Section pad={false} title="Claims × documents"
               hint={<span>Quotes per cell · <Box component="span" sx={{ color: p.accent }}>supporting</Box> · <Box component="span" sx={{ color: "error.main" }}>opposing</Box> · context in grey</span>}>
        <Box sx={{ overflowX: "auto", px: 2.5, pb: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: `52px minmax(240px, 1fr) repeat(${docs.length}, minmax(72px, 110px))`,
                     columnGap: 0.75, alignItems: "center", minWidth: 320 + docs.length * 80 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", alignSelf: "end", pb: 0.75 }}>#</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", alignSelf: "end", pb: 0.75 }}>Claim</Typography>
            {docs.map((d) => (
              <Typography key={d.doc} title={d.doc} sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textAlign: "center", lineHeight: 1.3,
                                                         alignSelf: "end", pb: 0.75, px: 0.25, overflowWrap: "anywhere",
                                                         display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {short(d.doc)}
              </Typography>
            ))}
            {claims.map((c, i) => [
              <ButtonBase key={`${i}-id`} onClick={() => onPick(i)}
                          sx={{ justifyContent: "flex-start", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent, py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch" }}>
                C{i + 1}
              </ButtonBase>,
              <Typography key={`${i}-t`} title={c.text}
                          sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", py: 1, borderTop: 1, borderColor: "divider",
                                alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                {c.text}
              </Typography>,
              ...docs.map((d) => {
                const cell = cells[`${i}|${d.doc}`];
                const n = cell ? cell.sup + cell.opp + cell.ctx : 0;
                const hue = !cell ? "transparent" : cell.opp ? theme.palette.error.main : cell.sup ? p.accent : theme.palette.text.disabled;
                return (
                  <Box key={`${i}-${d.doc}`} sx={{ py: 0.5, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                    <Box title={cell ? `${cell.sup} supporting · ${cell.opp} opposing · ${cell.ctx} context` : undefined}
                         sx={{ height: 32, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "2px",
                               fontFamily: MONO, fontSize: 13, fontWeight: 600,
                               bgcolor: cell ? alpha(hue, Math.min(0.85, 0.2 + n * 0.2)) : "transparent",
                               color: n >= 3 ? (p.dark ? p.onAccent : "#ffffff") : "text.primary" }}>
                      {n || ""}
                    </Box>
                  </Box>
                );
              }),
            ])}
          </Box>
        </Box>
      </Section>
    </Stack>
  );
}
