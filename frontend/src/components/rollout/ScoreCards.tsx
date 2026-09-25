/** The five headline numbers of a run, each as a card: the figure, a bar, the
 *  band it falls in, and two or three lines of analysis saying what produced
 *  it. The analysis is read off the run's own ratings and register -- never a
 *  model's opinion -- so every line can be checked against the tab the card
 *  opens. */
import { alpha, Box, ButtonBase, Stack, Typography, useTheme, type Theme } from "@mui/material";
import type { ReactNode } from "react";

import type { RolloutAnalysis, RolloutScores, RolloutSubject } from "../../api";
import { materialityColour, usePremium } from "./premium";

const MATERIALITIES = ["Critical", "High", "Medium", "Low", "Informational"];

// Dispositions that take the deviation away, and those that keep it.
const ABSORBED = new Set(["ADOPT_GT", "CONFIGURE_STANDARD", "ADOPT_SAP_BP", "USE_SAP_LOCALIZATION", "RETIRE_LEGACY"]);
const LOCAL = new Set(["RETAIN_LOCAL_EXCEPTION", "EXTEND_STANDARD"]);

/** A 0–100 score as a colour, on the same cut points as the bands. */
function scoreColour(theme: Theme, accent: string, v: number | null): string {
  if (v === null) return theme.palette.text.disabled;
  return v >= 75 ? theme.palette.success.main : v >= 60 ? accent : v >= 40 ? theme.palette.warning.main : theme.palette.error.main;
}

const pts = (n: number) => `${Math.abs(n).toFixed(1)} pts`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Card({ label, value, unit, colour, bar, band, lines, onOpen, open }: {
  label: string;
  value: string;
  unit?: string;
  colour: string;
  /** 0–100 for a score bar, or a ready-made bar. */
  bar: number | null | ReactNode;
  band: string;
  lines: ReactNode[];
  onOpen: () => void;
  open: string;
}) {
  return (
    <ButtonBase onClick={onOpen} aria-label={`${label}: ${value}${unit ?? ""}. ${open}`}
                sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left",
                      bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: "10px",
                      px: 2.5, pt: 2.25, pb: 2, minWidth: 0, transition: "border-color .15s, box-shadow .15s",
                      "&:hover": { borderColor: colour, boxShadow: `0 4px 16px ${alpha(colour, 0.12)}` },
                      "&:hover .open": { color: colour },
                      "&:focus-visible": { outline: `2px solid ${colour}`, outlineOffset: 2 } }}>
      {/* Two lines reserved, so the figures line up when one label wraps. */}
      <Typography sx={{ fontSize: 12, letterSpacing: "0.08em", color: "text.secondary", textTransform: "uppercase",
                        lineHeight: 1.45, minHeight: { xl: "2.9em" } }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", mt: 1 }}>
        <Typography sx={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: colour, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        {unit && <Typography sx={{ fontSize: 16, fontWeight: 600, color: colour }}>{unit}</Typography>}
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        {typeof bar === "number" || bar === null ? (
          <Box sx={{ height: 6, borderRadius: 3, bgcolor: alpha(colour, 0.15), overflow: "hidden" }}>
            <Box sx={{ height: "100%", width: `${Math.max(0, Math.min(100, bar ?? 0))}%`, bgcolor: colour, borderRadius: 3 }} />
          </Box>
        ) : bar}
      </Box>
      <Typography sx={{ fontSize: 13, color: "text.primary", mt: 1.25, lineHeight: 1.45, minHeight: "2.9em" }}>{band || "—"}</Typography>

      <Box sx={{ borderTop: 1, borderColor: "divider", mt: 1.5, pt: 1.5, flex: 1 }}>
        <Stack component="ul" spacing={0.9} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {lines.map((l, i) => (
            <Stack component="li" key={i} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: colour, flex: "none", transform: "translateY(-2px)" }} />
              <Typography sx={{ fontSize: 12.5, color: "text.secondary", lineHeight: 1.5 }}>{l}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
      <Typography className="open" sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", mt: 1.5, transition: "color .15s" }}>
        {open} →
      </Typography>
    </ButtonBase>
  );
}

const B = ({ children }: { children: ReactNode }) => (
  <Box component="strong" sx={{ color: "text.primary", fontWeight: 600 }}>{children}</Box>
);

export default function ScoreCards({ analysis, scores, subject, types, onTab }: {
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  /** Deviation type code → "Label — description", from the vocabularies. */
  types: Record<string, string>;
  onTab: (tab: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  const devs = analysis.deviations;
  const c = scores.counts;
  const gt = scores.gt_alignment;
  const typeName = (code: string) => (types[code] ?? code).split(" — ")[0].split(" / ")[0];

  // --- alignment to the Global Template
  const rated = scores.dimensions.filter((d) => d.percent !== null).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
  const gtLines: ReactNode[] = [];
  if (rated.length) gtLines.push(<>Weakest: <B>{rated[0].label}</B> at {rated[0].percent}%</>);
  if (rated.length > 1) gtLines.push(<>Strongest: <B>{rated[rated.length - 1].label}</B> at {rated[rated.length - 1].percent}%</>);
  gtLines.push(<><B>{plural(c.fit_areas, "step")}</B> already fit the template as {c.fit_areas === 1 ? "it is" : "they are"}</>);

  // --- harmonization potential
  const absorbed = devs.filter((d) => ABSORBED.has(d.candidate_disposition)).length;
  const local = devs.filter((d) => LOCAL.has(d.candidate_disposition)).length;
  const undecided = devs.filter((d) => d.candidate_disposition === "REQUIRES_DECISION").length;
  const redesign = devs.filter((d) => d.candidate_disposition === "REDESIGN_GT").length;
  const hLines: ReactNode[] = devs.length ? [
    <><B>{absorbed} of {devs.length}</B> deviations can be absorbed by the template or SAP standard</>,
    ...(local ? [<><B>{local}</B> look like a lasting local need</>] : []),
    ...(redesign ? [<><B>{redesign}</B> point to a template change</>] : []),
    ...(undecided ? [<><B>{undecided}</B> still need a decision before they can be judged</>] : []),
  ].slice(0, 3) : ["No deviations, so there is nothing to harmonise."];

  // --- localization-adjusted
  const adj = scores.localization_adjusted;
  // The same deviations scoring.py sets aside: confirmed statutory or
  // SAP-delivered. A suspected one is shown, and not counted.
  const mandatory = devs.filter((d) => d.localization_state === "CONFIRMED_STATUTORY" || d.localization_state === "SAP_DELIVERED").length;
  const suspected = devs.filter((d) => d.localization_state === "SUSPECTED").length;
  const lBand = !subject.localization ? "Not applicable"
    : `${plural(mandatory, "deviation")} set aside as legally required`;
  const lLines: ReactNode[] = !subject.localization
    ? ["This run has no country, so no divergence is set aside as legally required."]
    : adj === null || gt === null
      ? ["Not assessable: the template alignment could not be rated."]
      : [
          adj - gt >= 0.05
            ? <><B>+{pts(adj - gt)}</B> over template alignment, once legally required divergence is set aside</>
            : <>Same as template alignment: <B>no deviation</B> is confirmed as legally required</>,
          <><B>{mandatory} of {devs.length}</B> deviations are confirmed statutory or SAP-delivered localization ({scores.localization_share}% of the weighted divergence)</>,
          ...(suspected ? [<><B>{suspected}</B> more {suspected === 1 ? "is" : "are"} suspected, and not counted until confirmed</>] : []),
        ];

  // --- SAP Best Practice
  const bp = scores.sap_bp_alignment;
  const closer = devs.filter((d) => d.sap_bp_fit_rating !== null && d.sap_bp_fit_rating > d.gt_fit_rating).length;
  const bpRated = scores.sap_bp_dimensions.filter((d) => d.percent !== null).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
  const bpLines: ReactNode[] = bp === null
    // The agent's own sap_bp_note is written for the Dimensions tab, where
    // there is room for it; the card says the outcome.
    ? (subject.score_b
        ? ["Not rated in this run: no SAP Best Practice source was scored.",
           "The reason is recorded on the Dimensions tab."]
        : ["Not reported: SAP Best Practice is the subject of this run."])
    : [
        gt === null || Math.abs(bp - gt) < 0.05
          ? <>In line with template alignment</>
          : bp > gt
            ? <><B>{pts(bp - gt)} above</B> template alignment: the country is closer to SAP standard than to the template</>
            : <><B>{pts(gt - bp)} below</B> template alignment: the country departs further from SAP standard</>,
        <><B>{plural(closer, "deviation")}</B> where the country is closer to SAP than the template is</>,
        ...(bpRated.length ? [<>Weakest against SAP: <B>{bpRated[0].label}</B> at {bpRated[0].percent}%</>] : []),
      ];

  // --- deviations
  const byType = Object.entries(c.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const high = (c.by_materiality?.High ?? 0) + (c.by_materiality?.Critical ?? 0);
  const must = c.workshop?.MUST_DISCUSS ?? 0;
  const confirm = c.workshop?.CONFIRM ?? 0;
  const dLines: ReactNode[] = devs.length ? [
    <>Most frequent: <B>{typeName(byType[0][0])}</B> ({byType[0][1]}){byType[1] ? <>, {typeName(byType[1][0])} ({byType[1][1]})</> : null}</>,
    <>Workshop: <B>{plural(must, "decision")}</B> · {c.workshop_minutes} min</>,
    <><B>{confirm}</B> to confirm without discussion</>,
  ] : [`No material difference from the Global Template was found.`];
  const materialityBar = (
    <Box sx={{ display: "flex", gap: "2px", height: 6, borderRadius: 3, overflow: "hidden", bgcolor: "action.hover" }}>
      {MATERIALITIES.map((m) => {
        const n = c.by_materiality?.[m] ?? 0;
        return n ? <Box key={m} title={`${m}: ${n}`} sx={{ flex: `${n} 1 0`, bgcolor: materialityColour(theme, m),
                                                          opacity: m === "Low" || m === "Informational" ? 0.45 : 1 }} /> : null;
      })}
    </Box>
  );

  const gtColour = scoreColour(theme, p.accent, gt);
  const bpColour = scoreColour(theme, p.accent, bp);
  const pct = (v: number | null) => (v === null ? "—" : v.toFixed(1));

  return (
    <Box sx={{ display: "grid", gap: 2, mb: 3,
               gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))", xl: "repeat(5, minmax(0, 1fr))" } }}>
      <Card label="Alignment to the Global Template" value={pct(gt)} unit={gt === null ? undefined : "%"} colour={gtColour} bar={gt}
            band={scores.gt_band} lines={gtLines} onOpen={() => onTab("dimensions")} open="Open dimensions" />
      <Card label="Harmonization potential" value={pct(scores.harmonization_potential)}
            unit={scores.harmonization_potential === null ? undefined : "%"}
            colour={scores.harmonization_potential === null ? theme.palette.text.disabled : theme.palette.info.main}
            bar={scores.harmonization_potential} band={scores.harmonization_band} lines={hLines}
            onOpen={() => onTab("deviations")} open="Open deviations" />
      <Card label="Localization-adjusted" value={pct(adj)} unit={adj === null ? undefined : "%"}
            colour={scoreColour(theme, p.accent, adj)} bar={adj}
            band={lBand}
            lines={lLines} onOpen={() => onTab("localization")} open="Open localization" />
      <Card label="SAP Best Practice" value={pct(bp)} unit={bp === null ? undefined : "%"} colour={bpColour} bar={bp}
            band={bp === null ? "Not assessable" : scores.sap_bp_band} lines={bpLines}
            onOpen={() => onTab("dimensions")} open="Open dimensions" />
      <Card label="Deviations" value={String(c.deviations ?? devs.length)}
            colour={high ? theme.palette.error.main : devs.length ? theme.palette.warning.main : theme.palette.success.main}
            bar={materialityBar} band={`${high} high or critical · ${must} must discuss`} lines={dLines}
            onOpen={() => onTab("deviations")} open="Open the register" />
    </Box>
  );
}

