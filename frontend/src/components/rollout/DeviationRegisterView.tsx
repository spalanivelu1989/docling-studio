/** Deviations — design D1: the register as a filterable table with the chosen
 *  deviation open in an inspector beside it, and design D2's risk view one
 *  toggle away. The inspector carries everything the old card did: both
 *  sides, impact, the decision with its options, the evidence, what is still
 *  open. */
import {
  Box, Button, ButtonBase, FormControlLabel, InputAdornment, Radio, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography, useTheme,
} from "@mui/material";
import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Deviation, RolloutEvidence, RolloutDecision, RolloutSubject } from "../../api";
import { DecisionButtons, StatusText, latest, type OnDecide } from "./decision";
import DeviationRiskView from "./DeviationRiskView";
import { OUTLOOK, outlookOf } from "./outlook";
import MaterialityPill from "./MaterialityPill";
import { BUCKET_LABEL, DISPOSITION_LABEL, MONO, RADIUS, idColumn, ranked, usePremium } from "./premium";

const LETTERS = "ABCDEFGH";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25} sx={{ px: 2.75, py: 2, borderTop: 1, borderColor: "divider" }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "text.secondary" }}>{title}</Typography>
      {children}
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

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function DeviationRegisterView({
  deviations, subject, types, dispositions, states, decisions, reviewer, deciding, onDecide, focusGap, renderEvidence, fileStem,
}: {
  deviations: Deviation[];
  subject: RolloutSubject;
  types: Record<string, string>;
  dispositions: Record<string, string>;
  states: Record<string, string>;
  decisions: Record<string, RolloutDecision[]>;
  reviewer: string;
  deciding: Record<string, string>;
  onDecide?: OnDecide;
  /** A gap to open, when the reader arrives from another tab. */
  focusGap?: string;
  renderEvidence: (ev: RolloutEvidence) => ReactNode;
  fileStem: string;
}) {
  const theme = useTheme();
  const p = usePremium();
  const [view, setView] = useState<"register" | "risk">("register");
  const [q, setQ] = useState("");
  const [mat, setMat] = useState("All");
  const [bucket, setBucket] = useState("All");
  const [status, setStatus] = useState("All");
  const all = useMemo(() => ranked(deviations), [deviations]);
  const [sel, setSel] = useState(all[0]?.gap_id ?? "");
  const [choice, setChoice] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!focusGap || !deviations.some((d) => d.gap_id === focusGap)) return;
    setView("register"); setSel(focusGap); setQ(""); setMat("All"); setBucket("All"); setStatus("All");
  }, [focusGap, deviations]);

  const decidedOf = (d: Deviation) => !!latest(decisions[d.gap_id]);
  const rows = all.filter((d) => {
    if (mat !== "All" && d.materiality !== mat) return false;
    if (bucket !== "All" && d.workshop_bucket !== bucket) return false;
    if (status === "Open" && decidedOf(d)) return false;
    if (status === "Decided" && !decidedOf(d)) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      const hay = [d.gap_id, d.exact_difference, d.as_is_step_id, d.gt_step_ref, d.dimension, d.primary_type, d.as_is_statement, d.gt_statement]
        .join(" ").toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });

  const count = (f: (d: Deviation) => boolean) => all.filter(f).length;
  const mats = ["Critical", "High", "Medium", "Low", "Informational"].filter((m) => all.some((d) => d.materiality === m));
  const buckets = ["MUST_DISCUSS", "CONFIRM", "NO_WORKSHOP_TIME"].filter((b) => all.some((d) => d.workshop_bucket === b));
  const gap = all.find((d) => d.gap_id === sel) ?? null;

  const exportCsv = () => {
    const head = ["gap_id", "materiality", "primary_type", "dimension", "workshop", "gt_fit", "sap_bp_fit", "harmonisation", "disposition",
                  "as_is_step", "template_step", "finding", "status", "decided_by"];
    const lines = rows.map((d) => {
      const last = latest(decisions[d.gap_id]);
      return [d.gap_id, d.materiality, d.primary_type, d.dimension, d.workshop_bucket, d.gt_fit_rating, d.sap_bp_fit_rating ?? "", d.harmonization_potential,
              d.candidate_disposition, d.as_is_step_id, d.gt_step_ref, d.exact_difference, last?.verdict ?? "open", last?.reviewer ?? ""]
        .map(csvCell).join(",");
    });
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${fileStem}-deviations.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const fitColour = (r: number) => r <= 1 ? theme.palette.error.main : r === 2 ? theme.palette.warning.main : p.accent;
  // Why an SAP fit is blank: the agent found the point outside the SAP
  // documents and said so, or no SAP passage was ever quoted for it (runs
  // before the rule, where the quality gate removed the rating).
  const sapBlank = (d: Deviation) => d.sap_bp_reference?.trim()
    ? { short: "Not covered", why: d.sap_bp_reference.trim() }
    : { short: "Not rated", why: "Not rated: no SAP Best Practice passage was quoted for this deviation." };
  // An SAP Best Practice fit column only where the run can have one.
  const sapCol = !!subject.score_b;
  const grid = `${idColumn(all.map((d) => d.gap_id))} minmax(0, 1fr) 44px 64px ${sapCol ? "64px " : ""}96px 104px 76px`;
  // Four segments and "n/4"; null (no SAP source quoted) is a dash, not a 0.
  const fitCell = (r: number | null, what: string, blank?: string) => (
    <Stack spacing={0.5} title={r === null ? blank ?? `Not rated against ${what}` : `Fit with ${what} ${r}/4`}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "2px", mt: 0.5 }}>
        {[1, 2, 3, 4].map((i) => (
          <Box key={i} sx={{ height: 8, bgcolor: r !== null && i <= r ? fitColour(r) : "action.selected" }} />
        ))}
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{r === null ? "—" : `${r}/4`}</Typography>
    </Stack>
  );

  const toolbar = (
    <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, px: 2, py: 1.5,
               display: "flex", alignItems: "center", gap: 2.5, flexWrap: "wrap" }}>
      <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="View"
                         sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 13, px: 1.75, py: 0.5, borderRadius: RADIUS } }}>
        <ToggleButton value="register">Register</ToggleButton>
        <ToggleButton value="risk">Risk view</ToggleButton>
      </ToggleButtonGroup>
      {view === "register" ? (
        <>
          <TextField size="small" placeholder="ID, finding or step" value={q} onChange={(e) => setQ(e.target.value)}
                     slotProps={{ htmlInput: { "aria-label": "Search deviations" },
                                  input: { startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> } }}
                     sx={{ width: 220, "& .MuiInputBase-input": { fontSize: 13, py: 0.8 }, "& .MuiOutlinedInput-root": { borderRadius: RADIUS } }} />
          <Chips label="Materiality" value={mat} onChange={setMat}
                 options={[{ v: "All", label: "All", n: all.length }, ...mats.map((m) => ({ v: m, label: m, n: count((d) => d.materiality === m) }))]} />
          <Chips label="Workshop" value={bucket} onChange={setBucket}
                 options={[{ v: "All", label: "All", n: all.length },
                           ...buckets.map((b) => ({ v: b, label: BUCKET_LABEL[b] ?? b, n: count((d) => d.workshop_bucket === b) }))]} />
          <Chips label="Status" value={status} onChange={setStatus}
                 options={[{ v: "All", label: "All", n: all.length }, { v: "Open", label: "Open", n: count((d) => !decidedOf(d)) },
                           { v: "Decided", label: "Decided", n: count(decidedOf) }]} />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{rows.length} of {all.length} shown</Typography>
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
                  sx={{ textTransform: "none", borderRadius: RADIUS }}>Export CSV</Button>
        </>
      ) : (
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          {all.length} deviations · {count((d) => d.materiality === "High" || d.materiality === "Critical")} high ·{" "}
          {count((d) => d.workshop_bucket === "MUST_DISCUSS")} need floor time · {count(decidedOf)} decided. Click any GAP to open it in the register.
        </Typography>
      )}
    </Box>
  );

  if (!all.length) {
    return (
      <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
        No material deviation was found between the {subject.label} and the Global Template.
      </Typography>
    );
  }

  if (view === "risk") {
    return (
      <Stack spacing={2}>
        {toolbar}
        <DeviationRiskView deviations={all} decisions={decisions} types={types} dispositions={dispositions}
                           onPick={(id) => { setSel(id); setView("register"); setQ(""); setMat("All"); setBucket("All"); setStatus("All"); }} />
      </Stack>
    );
  }

  const agendaOptions = gap?.decision_options ?? [];
  const loc = gap && gap.localization_state !== "NOT_LOCALIZATION" ? states[gap.localization_state] ?? gap.localization_state : "";

  return (
    <Stack spacing={2}>
      {toolbar}
      <Box sx={{ display: "grid", gap: 2.5, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 460px" } }}>
        <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, overflowX: "auto", minWidth: 0 }}>
          <Box sx={{ minWidth: sapCol ? 790 : 720 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, px: 2.25, py: 1.1, bgcolor: "action.hover",
                       borderBottom: 1, borderColor: "divider", "& > *": { fontSize: 12, fontWeight: 600, color: "text.secondary" } }}>
              <span>ID</span><span>Finding</span><span>Type</span><span>GT fit</span>{sapCol && <span>SAP fit</span>}<span>Materiality</span><span>Workshop</span><span>Status</span>
            </Box>
            {rows.map((d) => {
              const on = d.gap_id === sel;
              const must = d.workshop_bucket === "MUST_DISCUSS";
              return (
                <ButtonBase key={d.gap_id} id={`gap-${d.gap_id}`} onClick={() => setSel(d.gap_id)} aria-pressed={on}
                            sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, alignItems: "start", width: "100%", textAlign: "left",
                                  px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider", scrollMarginTop: 80,
                                  bgcolor: on ? "action.selected" : "transparent", boxShadow: on ? `inset 3px 0 0 ${p.accent}` : "none",
                                  "&:hover": { bgcolor: on ? "action.selected" : "action.hover" } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent }}>{d.gap_id}</Typography>
                  <Stack spacing={0.4} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.45 }}>{d.exact_difference}</Typography>
                    <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                      <Box component="span" sx={{ textTransform: "capitalize" }}>{d.dimension}</Box>
                      {d.as_is_step_id ? ` · ${subject.label} ${d.as_is_step_id}` : ""} · {DISPOSITION_LABEL[d.candidate_disposition] ?? d.candidate_disposition}
                    </Typography>
                  </Stack>
                  <Tooltip title={types[d.primary_type] ?? d.primary_type}>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{d.primary_type}</Typography>
                  </Tooltip>
                  {fitCell(d.gt_fit_rating, "the Global Template")}
                  {sapCol && fitCell(d.sap_bp_fit_rating, "SAP Best Practice", sapBlank(d).why)}
                  <Box><MaterialityPill value={d.materiality} /></Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: must ? 600 : 400, color: must ? "text.primary" : "text.secondary" }}>
                    {BUCKET_LABEL[d.workshop_bucket] ?? d.workshop_bucket}
                  </Typography>
                  <StatusText decision={latest(decisions[d.gap_id])} size={12.5} />
                </ButtonBase>
              );
            })}
            {!rows.length && (
              <Typography sx={{ fontSize: 13, color: "text.secondary", p: 3 }}>No deviation matches these filters.</Typography>
            )}
          </Box>
        </Box>

        <Box component="aside" aria-label="Deviation detail"
             sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS,
                   position: { lg: "sticky" }, top: { lg: 16 }, maxHeight: { lg: "calc(100vh - 32px)" }, overflowY: { lg: "auto" } }}>
          {gap ? (
            <>
              <Stack spacing={1.25} sx={{ px: 2.75, pt: 2.25, pb: 2 }}>
                <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: p.accent }}>{gap.gap_id}</Typography>
                  <MaterialityPill value={gap.materiality} />
                  {[gap.primary_type, ...gap.secondary_types].map((t, i) => (
                    <Tooltip key={t} title={types[t] ?? t}>
                      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: i ? "text.disabled" : "text.secondary" }}>{t}</Typography>
                    </Tooltip>
                  ))}
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>· {BUCKET_LABEL[gap.workshop_bucket] ?? gap.workshop_bucket}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <StatusText decision={latest(decisions[gap.gap_id])} size={12} />
                </Stack>
                <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, lineHeight: 1.45 }}>{gap.exact_difference}</Typography>
                {loc && <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "info.main" }}>{loc}</Typography>}
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: `repeat(${subject.score_b ? 4 : 3}, minmax(0, 1fr))` },
                           border: 1, borderColor: "divider", borderRadius: RADIUS }}>
                  {[
                    { l: "GT fit", v: `${gap.gt_fit_rating}/4`, mono: true },
                    // Null is "no SAP source was read", not a mismatch, so it is a dash.
                    ...(subject.score_b ? [{ l: "SAP BP fit", v: gap.sap_bp_fit_rating === null ? "—" : `${gap.sap_bp_fit_rating}/4`, mono: true,
                                             note: gap.sap_bp_fit_rating === null ? sapBlank(gap).short : undefined }] : []),
                    // Computed from the disposition, localization state and GT fit; the
                    // working is shown so a reader can check it. Older runs carry the
                    // agent's own figure and say so.
                    { l: "Standardisation outlook", v: OUTLOOK[outlookOf(gap)].label, mono: false,
                      note: `${gap.harmonization_potential}% · ${gap.harmonization_terms?.formula
                        ?? "agent's estimate (run predates the computed rule)"}` },
                    { l: "Evidence confidence", v: gap.evidence_confidence, mono: false },
                  ].map((k, i) => (
                    <Stack key={k.l} spacing={0.25} sx={{ px: 1.5, py: 1.1, borderLeft: i ? 1 : 0, borderColor: "divider" }}>
                      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{k.l}</Typography>
                      <Typography sx={{ fontFamily: k.mono ? MONO : undefined, fontSize: k.mono ? 18 : 15, fontWeight: 500 }}>{k.v}</Typography>
                      {"note" in k && k.note && <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{k.note}</Typography>}
                    </Stack>
                  ))}
                </Box>
              </Stack>

              <Block title="COMPARISON">
                <Stack spacing={0.5}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "warning.main" }}>
                    {subject.label}{gap.as_is_step_id ? ` · ${gap.as_is_step_id}` : ""}
                  </Typography>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.55 }}>{gap.as_is_statement || "—"}</Typography>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: p.accent }}>
                    Global Template{gap.gt_step_ref ? ` · ${gap.gt_step_ref}` : ""}
                  </Typography>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.55 }}>{gap.gt_statement || "—"}</Typography>
                </Stack>
                {(gap.sap_bp_reference || (subject.score_b && gap.sap_bp_fit_rating === null)) && (
                  <Stack spacing={0.5}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>SAP Best Practice</Typography>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.55 }}>{gap.sap_bp_reference || sapBlank(gap).why}</Typography>
                  </Stack>
                )}
              </Block>

              {gap.impacts.length > 0 && (
                <Block title="MATERIAL IMPACT">
                  {gap.impacts.map((im) => (
                    <Box key={im.area} sx={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr) 30px", gap: 0.5, columnGap: 1.25, alignItems: "center" }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{im.area}</Typography>
                      <Box sx={{ height: 8, bgcolor: "action.hover" }}>
                        <Box sx={{ height: 8, width: `${im.score * 20}%`,
                                   bgcolor: im.score >= 4 ? "error.main" : im.score === 3 ? "warning.main" : "text.disabled" }} />
                      </Box>
                      <Typography sx={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>{im.score}/5</Typography>
                      <Typography sx={{ gridColumn: "2 / -1", fontSize: 12, color: "text.secondary", lineHeight: 1.45 }}>{im.note}</Typography>
                    </Box>
                  ))}
                </Block>
              )}

              <Block title={`DECISION · PROPOSED: ${(DISPOSITION_LABEL[gap.candidate_disposition] ?? gap.candidate_disposition).toUpperCase()}`}>
                {dispositions[gap.candidate_disposition] && (
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{dispositions[gap.candidate_disposition]}</Typography>
                )}
                {gap.decision_question && (
                  <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{gap.decision_question}</Typography>
                )}
                {agendaOptions.length > 0 && (
                  <Box role="radiogroup" aria-label="Options" sx={{ display: "grid", gap: 0.5 }}>
                    {agendaOptions.map((o, j) => (
                      <FormControlLabel key={j} sx={{ m: 0, alignItems: "flex-start", "& .MuiRadio-root": { pt: 0.25, pl: 0 } }}
                        control={<Radio size="small" checked={choice[gap.gap_id] === j}
                                        onChange={() => setChoice((c) => ({ ...c, [gap.gap_id]: j }))} />}
                        label={
                          <Stack direction="row" spacing={1}>
                            <Typography sx={{ fontFamily: MONO, fontWeight: 600, color: p.accent, fontSize: 12.5 }}>{LETTERS[j]}</Typography>
                            <Typography sx={{ fontSize: 12.5, lineHeight: 1.5 }}>{o}</Typography>
                          </Stack>
                        } />
                    ))}
                  </Box>
                )}
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {gap.decision_owner.length ? `Owners: ${gap.decision_owner.join(", ")} · ` : ""}
                  {gap.workshop_minutes || 10} min · confidence {gap.evidence_confidence.toLowerCase()}
                </Typography>
                <DecisionButtons gapId={gap.gap_id} reviewer={reviewer} deciding={deciding} onDecide={onDecide}
                                 decisions={decisions[gap.gap_id]} option={choice[gap.gap_id]} />
                {(decisions[gap.gap_id] ?? []).length > 1 && (
                  <Stack spacing={0.5}>
                    {(decisions[gap.gap_id] ?? []).slice(0, -1).reverse().map((d) => (
                      <Typography key={d.id} sx={{ fontSize: 12, color: "text.secondary" }}>
                        Earlier: {d.verdict} by {d.reviewer}{d.decided_at ? ` · ${new Date(d.decided_at).toLocaleString()}` : ""}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Block>

              {gap.evidence.length > 0 && (
                <Block title={`EVIDENCE · ${gap.evidence.length}`}>
                  <Box>{gap.evidence.map((e, i) => <Box key={i}>{renderEvidence(e)}</Box>)}</Box>
                </Block>
              )}

              {(gap.open_questions.length > 0 || gap.standard_options_considered.length > 0) && (
                <Block title="STILL OPEN">
                  {gap.open_questions.map((oq, i) => (
                    <Typography key={i} sx={{ fontSize: 13, lineHeight: 1.5 }}>{oq}</Typography>
                  ))}
                  {gap.standard_options_considered.length > 0 && (
                    <Stack spacing={0.4}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>Standard options weighed first</Typography>
                      {gap.standard_options_considered.map((o, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5, lineHeight: 1.5 }}>· {o}</Typography>
                      ))}
                    </Stack>
                  )}
                </Block>
              )}
            </>
          ) : (
            <Typography sx={{ fontSize: 13, color: "text.secondary", p: 3 }}>Choose a deviation to see its detail.</Typography>
          )}
        </Box>
      </Box>
    </Stack>
  );
}
