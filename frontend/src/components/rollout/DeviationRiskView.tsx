/** Deviations, risk view — design D2: where the register's findings sit.
 *  Materiality against harmonisation potential, what kind of difference each
 *  is, and every deviation's scored impact by business area. Every GAP opens
 *  in the register. */
import { Box, ButtonBase, Stack, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemo } from "react";

import type { Deviation, RolloutDecision } from "../../api";
import { StatusText, latest } from "./decision";
import MaterialityPill from "./MaterialityPill";
import { DISPOSITION_LABEL, MONO, heatCell, idColumn, usePremium } from "./premium";
import { Section } from "./SummaryView";

const BANDS = [
  { label: "Hard to harmonise", sub: "below 60%", test: (h: number) => h < 60 },
  { label: "Partly harmonisable", sub: "60–79%", test: (h: number) => h >= 60 && h < 80 },
  { label: "Adopt the template", sub: "80% and above", test: (h: number) => h >= 80 },
];

function Bars({ rows, colour }: { rows: { key: string; label: string; n: number; title?: string }[]; colour: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Stack spacing={1}>
      {rows.map((r) => (
        <Box key={r.key} title={r.title} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 200px) minmax(0, 1fr) 24px", gap: 1.25, alignItems: "center" }}>
          <Typography sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</Typography>
          <Box sx={{ height: 10, bgcolor: "action.hover" }}>
            <Box sx={{ height: 10, width: `${(r.n / max) * 100}%`, bgcolor: colour(r.key) }} />
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{r.n}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

export default function DeviationRiskView({ deviations, decisions, types, dispositions, onPick }: {
  deviations: Deviation[];
  decisions: Record<string, RolloutDecision[]>;
  types: Record<string, string>;
  dispositions: Record<string, string>;
  onPick: (gapId: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  const error = theme.palette.error.main;
  const mats = ["Critical", "High", "Medium", "Low", "Informational"].filter((m) => deviations.some((d) => d.materiality === m));

  const tally = (key: (d: Deviation) => string) => {
    const m: Record<string, number> = {};
    for (const d of deviations) m[key(d)] = (m[key(d)] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  const { areas, rows } = useMemo(() => {
    const count: Record<string, number> = {};
    for (const d of deviations) for (const im of d.impacts) count[im.area] = (count[im.area] ?? 0) + 1;
    const areas = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).map((a) => ({ area: a, n: count[a] }));
    const peak = (d: Deviation) => Math.max(0, ...d.impacts.map((i) => i.score));
    const sum = (d: Deviation) => d.impacts.reduce((s, i) => s + i.score, 0);
    const rows = [...deviations].sort((a, b) => peak(b) - peak(a) || sum(b) - sum(a) || a.gap_id.localeCompare(b.gap_id));
    return { areas, rows };
  }, [deviations]);

  // The matrix is tinted by how much it asks of the workshop: strongest where
  // materiality is high and harmonisation hard, fading toward adopt-as-is.
  const tint = (r: number, c: number) => {
    const weight = Math.max(0, 1 - (r / Math.max(1, mats.length - 1)) * 0.5 - (c / 2) * 0.5);
    return c === 2 && r === mats.length - 1 ? alpha(p.accent, 0.12) : alpha(error, 0.03 + weight * 0.13);
  };

  const chip = (d: Deviation) => {
    const must = d.workshop_bucket === "MUST_DISCUSS";
    const v = latest(decisions[d.gap_id])?.verdict;
    return (
      <ButtonBase key={d.gap_id} onClick={() => onPick(d.gap_id)} title={`${d.exact_difference}${v ? ` · ${v}` : ""}`}
                  sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, px: 1, py: 0.6, borderRadius: "3px",
                        textDecoration: v ? "line-through" : "none",
                        ...(must ? { bgcolor: p.band, color: p.bandText } : { bgcolor: "background.paper", color: "text.primary", border: 1, borderColor: "text.disabled" }) }}>
        {d.gap_id}
      </ButtonBase>
    );
  };

  const cols = `${idColumn(deviations.map((d) => d.gap_id))} minmax(220px, 1fr) 96px repeat(${areas.length}, minmax(76px, 96px)) 76px`;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.45fr) minmax(0, 1fr)" } }}>
        <Section title="Where the deviations sit"
                 hint="Top left is what the workshop has to settle; bottom right can adopt the template">
          <Box sx={{ display: "grid", gridTemplateColumns: "84px repeat(3, minmax(0, 1fr))", gap: 0.5 }}>
            <span />
            {BANDS.map((b) => (
              <Box key={b.label} sx={{ px: 0.5, pb: 0.5 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>{b.label}</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{b.sub}</Typography>
              </Box>
            ))}
            {mats.map((m, r) => [
              <Typography key={m} sx={{ fontSize: 12.5, fontWeight: 600, pt: 1.5 }}>{m}</Typography>,
              ...BANDS.map((b, c) => (
                <Box key={`${m}-${c}`} sx={{ minHeight: 96, p: 1.25, display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 0.75,
                                            borderRadius: "3px", bgcolor: tint(r, c) }}>
                  {deviations.filter((d) => d.materiality === m && b.test(d.harmonization_potential)).map(chip)}
                </Box>
              )),
            ])}
          </Box>
          <Stack direction="row" spacing={2.5} useFlexGap sx={{ mt: 1.5, flexWrap: "wrap" }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 12, height: 12, bgcolor: p.band }} />
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Must discuss</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 12, height: 12, border: 1, borderColor: "text.disabled" }} />
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Confirm without discussion</Typography>
            </Stack>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Struck through = decided</Typography>
          </Stack>
        </Section>

        <Section title="What kind of difference">
          <Bars rows={tally((d) => d.primary_type).map(([k, n]) => ({ key: k, n, label: `${k} · ${(types[k] ?? k).split(" — ")[0]}`, title: types[k] }))}
                colour={() => p.dark ? theme.palette.text.secondary : p.band} />
          <Typography component="h3" sx={{ fontSize: 15, fontWeight: 600, mt: 2.5, mb: 1.25 }}>Proposed disposition</Typography>
          <Bars rows={tally((d) => d.candidate_disposition).map(([k, n]) => ({ key: k, n, label: DISPOSITION_LABEL[k] ?? k, title: dispositions[k] }))}
                colour={(k) => (k === "REQUIRES_DECISION" ? error : p.accent)} />
        </Section>
      </Box>

      <Section pad={false} title="Impact heat map"
               hint={
                 <Stack direction="row" spacing={0.5} component="span" sx={{ alignItems: "center", display: "inline-flex" }}>
                   <span style={{ marginRight: 4 }}>Impact 1–5</span>
                   {[1, 2, 3, 4, 5].map((v) => {
                     const h = heatCell(theme, v);
                     return <Box key={v} component="span" sx={{ width: 24, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
                                                                fontFamily: MONO, fontSize: 11.5, bgcolor: h.bg, color: h.fg }}>{v}</Box>;
                   })}
                 </Stack>
               }>
        <Box sx={{ overflowX: "auto", px: 2.5, pb: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: cols, columnGap: 0.75, rowGap: 0, alignItems: "center", minWidth: 420 + areas.length * 80 }}>
            {["ID", "Finding", "Materiality"].map((h) => (
              <Typography key={h} sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", alignSelf: "end", pb: 0.75 }}>{h}</Typography>
            ))}
            {areas.map((a) => (
              <Typography key={a.area} sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textAlign: "center", lineHeight: 1.3, alignSelf: "end", pb: 0.75, px: 0.25, overflowWrap: "anywhere", hyphens: "auto" }}>
                {a.area}
              </Typography>
            ))}
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", alignSelf: "end", pb: 0.75 }}>Status</Typography>
            {rows.map((d) => [
              <ButtonBase key={`${d.gap_id}-id`} onClick={() => onPick(d.gap_id)}
                          sx={{ justifyContent: "flex-start", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent, py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch" }}>
                {d.gap_id}
              </ButtonBase>,
              <Typography key={`${d.gap_id}-f`} title={d.exact_difference}
                          sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                {d.exact_difference}
              </Typography>,
              <Box key={`${d.gap_id}-m`} sx={{ py: 0.75, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}><MaterialityPill value={d.materiality} /></Box>,
              ...areas.map((a) => {
                const im = d.impacts.find((i) => i.area === a.area);
                const h = heatCell(theme, im?.score ?? 0);
                return (
                  <Box key={`${d.gap_id}-${a.area}`} sx={{ py: 0.5, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                    <Box title={im ? `${a.area} ${im.score}/5 — ${im.note}` : undefined}
                         sx={{ height: 34, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "2px",
                               fontFamily: MONO, fontSize: 13, fontWeight: 600, bgcolor: im ? h.bg : "transparent", color: h.fg }}>
                      {im ? im.score : ""}
                    </Box>
                  </Box>
                );
              }),
              <Box key={`${d.gap_id}-s`} sx={{ py: 1, borderTop: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", alignItems: "center" }}><StatusText decision={latest(decisions[d.gap_id])} size={12} /></Box>,
            ])}
            <Typography sx={{ gridColumn: "1 / 4", fontSize: 12, fontWeight: 600, color: "text.secondary", pt: 1.25, borderTop: 1, borderColor: "divider" }}>
              Deviations touching the area
            </Typography>
            {areas.map((a) => (
              <Typography key={`n-${a.area}`} sx={{ fontFamily: MONO, fontSize: 13, textAlign: "center", pt: 1.25, borderTop: 1, borderColor: "divider" }}>{a.n}</Typography>
            ))}
            <Box sx={{ borderTop: 1, borderColor: "divider", alignSelf: "stretch" }} />
          </Box>
        </Box>
      </Section>
    </Stack>
  );
}
