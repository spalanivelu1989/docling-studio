/** Workshop agenda — design W1: the agenda as a run-of-show. Each decision
 *  holds a slot measured from the start of the workshop, the one being taken
 *  is open with its options, and the rail says who has to be in the room and
 *  what can be confirmed without floor time. */
import {
  Box, Button, ButtonBase, Checkbox, Collapse, FormControlLabel, Link, Radio, Stack, Typography, useTheme,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import type { Deviation, RolloutAnalysis, RolloutDecision, RolloutScores, RolloutSubject } from "../../api";
import { DecisionButtons, StatusText, latest, useVerdictColour, type OnDecide } from "./decision";
import MaterialityPill from "./MaterialityPill";
import { MONO, RADIUS, usePremium } from "./premium";
import { Section } from "./SummaryView";

export const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const LETTERS = "ABCDEFGH";

/** "Option B: …" -- what a chosen option is recorded as, beside the verdict. */
export const optionComment = (options: string[], i: number | undefined) =>
  i === undefined || !options[i] ? undefined : `Option ${LETTERS[i]}: ${options[i]}`;

export default function WorkshopAgendaView({
  analysis, scores, subject, types, states, decisions, reviewer, deciding, onDecide, onOpenGap, onFacilitate,
}: {
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  types: Record<string, string>;
  states: Record<string, string>;
  decisions: Record<string, RolloutDecision[]>;
  reviewer: string;
  deciding: Record<string, string>;
  onDecide?: OnDecide;
  onOpenGap: (gapId: string) => void;
  onFacilitate: (index: number) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  const colour = useVerdictColour();
  const agenda = scores.agenda;
  const devOf = useMemo(() => Object.fromEntries(analysis.deviations.map((d) => [d.gap_id, d])), [analysis]);

  const slots = useMemo(() => {
    let t = 0;
    return agenda.map((a) => { const start = t; t += a.minutes; return { start, end: t }; });
  }, [agenda]);
  const total = slots.length ? slots[slots.length - 1].end : 0;

  const firstOpen = agenda.find((a) => !latest(decisions[a.gap_id]))?.gap_id ?? agenda[0]?.gap_id ?? "";
  const [open, setOpen] = useState(firstOpen);
  const [choice, setChoice] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    document.getElementById(`agenda-${open}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open]);

  const tally = { accept: 0, defer: 0, reject: 0, open: 0 };
  for (const a of agenda) {
    const v = latest(decisions[a.gap_id])?.verdict;
    tally[v ?? "open"]++;
  }
  const decidedCount = agenda.length - tally.open;
  const minutesLeft = agenda.reduce((n, a) => n + (latest(decisions[a.gap_id]) ? 0 : a.minutes), 0);

  const roster = useMemo(() => {
    const by: Record<string, { role: string; minutes: number; items: string[] }> = {};
    for (const a of agenda) for (const o of a.owner) {
      by[o] ??= { role: o, minutes: 0, items: [] };
      by[o].minutes += a.minutes; by[o].items.push(a.gap_id);
    }
    return Object.values(by).sort((x, y) => y.minutes - x.minutes || x.role.localeCompare(y.role));
  }, [agenda]);

  const confirm = analysis.deviations.filter((d) => d.workshop_bucket === "CONFIRM");
  const noTime = analysis.deviations.filter((d) => d.workshop_bucket === "NO_WORKSHOP_TIME");
  const pending = confirm.filter((d) => !latest(decisions[d.gap_id]));
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [showFit, setShowFit] = useState(false);
  const tickedPending = pending.filter((d) => ticked.has(d.gap_id));

  const confirmSelected = () => {
    if (!onDecide) return;
    for (const d of tickedPending) onDecide(d.gap_id, "accept", "Confirmed without discussion (batch)");
    setTicked(new Set());
  };

  if (!agenda.length) {
    return (
      <Section title="Workshop agenda">
        <Typography sx={{ fontSize: 13.5 }}>
          Nothing needs floor time. Every difference between the {subject.label} and the Global Template is either a
          fit or can be confirmed without discussion.
        </Typography>
      </Section>
    );
  }

  const legend = [
    { c: p.band, l: "High materiality" },
    { c: theme.palette.action.disabled, l: "Medium or lower" },
    { c: p.accent, l: "Decided (coloured by verdict)" },
  ];

  return (
    <Box sx={{ display: "grid", gap: 3, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 360px" } }}>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, px: 3, py: 2.5 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "flex-start" } }}>
            <Stack spacing={0.5} sx={{ flex: 1 }}>
              <Typography component="h2" sx={{ fontSize: 18, fontWeight: 600 }}>Workshop run-of-show</Typography>
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                {agenda.length} decision{agenda.length === 1 ? "" : "s"} · {Math.floor(total / 60) ? `${Math.floor(total / 60)} h ` : ""}
                {total % 60} min of floor time · legal and localization blockers first, then controls, then the rest by materiality
              </Typography>
            </Stack>
            <Button variant="contained" disableElevation onClick={() => onFacilitate(Math.max(0, agenda.findIndex((a) => a.gap_id === open)))}
                    sx={{ textTransform: "none", borderRadius: RADIUS, bgcolor: p.accent, color: p.dark ? p.onAccent : "#ffffff",
                          "&:hover": { bgcolor: p.accent, filter: "brightness(1.08)" }, whiteSpace: "nowrap" }}>
              Start facilitating
            </Button>
          </Stack>
          <Box sx={{ display: "flex", gap: "3px", height: 44, mt: 2 }}>
            {agenda.map((a) => {
              const v = latest(decisions[a.gap_id])?.verdict;
              const heavy = a.materiality === "High" || a.materiality === "Critical";
              const bg = v ? colour(v) : heavy ? p.band : theme.palette.action.disabledBackground;
              const fg = v || heavy ? (v ? (p.dark ? p.onAccent : "#ffffff") : p.bandText) : theme.palette.text.primary;
              return (
                <ButtonBase key={a.gap_id} onClick={() => setOpen(a.gap_id)} title={`${a.gap_id} · ${a.minutes} min${v ? ` · ${v}` : ""}`}
                            sx={{ flex: `${a.minutes} 1 0`, minWidth: 0, flexDirection: "column", alignItems: "flex-start", justifyContent: "center",
                                  px: 1, bgcolor: bg, color: fg, overflow: "hidden",
                                  outline: open === a.gap_id ? `2px solid ${p.accent}` : "none", outlineOffset: 2 }}>
                  <Typography noWrap sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, maxWidth: "100%" }}>{a.gap_id}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 11.5, opacity: 0.8 }}>{a.minutes}′</Typography>
                </ButtonBase>
              );
            })}
          </Box>
          <Stack direction="row" sx={{ justifyContent: "space-between", mt: 0.75 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <Typography key={f} sx={{ fontFamily: MONO, fontSize: 11.5, color: "text.secondary" }}>{clock(Math.round(total * f))}</Typography>
            ))}
          </Stack>
          <Stack direction="row" spacing={2.5} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
            {legend.map((l) => (
              <Stack key={l.l} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <Box sx={{ width: 10, height: 10, bgcolor: l.c }} />
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{l.l}</Typography>
              </Stack>
            ))}
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Times are from the start of the workshop.</Typography>
          </Stack>
        </Box>

        {agenda.map((a, i) => {
          const d: Deviation | undefined = devOf[a.gap_id];
          const expanded = open === a.gap_id;
          const options = a.options.length ? a.options : d?.decision_options ?? [];
          const last = latest(decisions[a.gap_id]);
          const loc = a.localization_state !== "NOT_LOCALIZATION" ? states[a.localization_state] ?? a.localization_state : "";
          return (
            <Box key={a.gap_id} id={`agenda-${a.gap_id}`}
                 sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "80px minmax(0, 1fr)" }, scrollMarginTop: 16 }}>
              <Stack spacing={0.25} sx={{ pt: { sm: 2 } }} direction={{ xs: "row", sm: "column" }} useFlexGap>
                <Typography sx={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, mr: { xs: 1, sm: 0 } }}>{clock(slots[i].start)}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", alignSelf: { xs: "center", sm: "auto" } }}>to {clock(slots[i].end)}</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary", mt: { sm: 0.5 }, ml: { xs: 1, sm: 0 }, alignSelf: { xs: "center", sm: "auto" } }}>{a.minutes} min</Typography>
              </Stack>
              <Box component="article"
                   sx={{ bgcolor: "background.paper", borderRadius: RADIUS, minWidth: 0, border: 1,
                         borderColor: expanded ? p.accent : "divider", boxShadow: expanded ? `0 0 0 3px ${theme.palette.action.selected}` : "none" }}>
                <ButtonBase onClick={() => setOpen(expanded ? "" : a.gap_id)} aria-expanded={expanded}
                            sx={{ display: "block", width: "100%", textAlign: "left", px: 2.75, pt: 2.25, pb: expanded ? 1 : 2.25 }}>
                  <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{String(a.position).padStart(2, "0")}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: p.accent }}>{a.gap_id}</Typography>
                    <MaterialityPill value={a.materiality} />
                    <Typography sx={{ fontSize: 12, color: "text.secondary" }} title={types[a.primary_type]}>
                      {a.primary_type} · {(types[a.primary_type] ?? "").split(" — ")[0]}
                    </Typography>
                    {loc && (
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "info.main" }}>{loc}</Typography>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <StatusText decision={last} size={12} />
                  </Stack>
                  <Typography component="h3" sx={{ fontSize: 16, fontWeight: 600, lineHeight: 1.45, mt: 1 }}>{a.topic}</Typography>
                  <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.55, mt: 0.75 }}>{a.why}</Typography>
                  {!expanded && (
                    <Stack direction="row" spacing={2} useFlexGap sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider", flexWrap: "wrap" }}>
                      <Typography sx={{ fontSize: 12.5, color: "text.secondary", flex: 1 }}>{a.owner.join(" · ")}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{options.length} options</Typography>
                      <Typography sx={{ fontSize: 12.5, color: p.accent, fontWeight: 500 }}>Open</Typography>
                    </Stack>
                  )}
                </ButtonBase>
                <Collapse in={expanded} unmountOnExit>
                  <Stack spacing={1.5} sx={{ px: 2.75, pb: 2.5 }}>
                    {options.length > 0 && (
                      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, display: "grid", gap: 1 }}>
                        <Typography component="legend" sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", mb: 1 }}>
                          Options on the table
                        </Typography>
                        {options.map((o, j) => (
                          <FormControlLabel key={j} value={j}
                            control={<Radio size="small" checked={choice[a.gap_id] === j}
                                            onChange={() => setChoice((c) => ({ ...c, [a.gap_id]: j }))} />}
                            label={
                              <Stack direction="row" spacing={1.25}>
                                <Typography sx={{ fontFamily: MONO, fontWeight: 600, color: p.accent, fontSize: 13 }}>{LETTERS[j]}</Typography>
                                <Typography sx={{ fontSize: 13.5, lineHeight: 1.45 }}>{o}</Typography>
                              </Stack>
                            }
                            sx={{ m: 0, alignItems: "flex-start", border: 1, borderRadius: RADIUS, pr: 1.5, py: 0.5,
                                  borderColor: choice[a.gap_id] === j ? p.accent : "divider",
                                  "& .MuiRadio-root": { pt: 0.5 } }} />
                        ))}
                      </Box>
                    )}
                    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap
                           sx={{ pt: 1.5, borderTop: 1, borderColor: "divider", alignItems: { md: "center" }, flexWrap: "wrap" }}>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", flex: 1 }}>
                        <Typography sx={{ fontSize: 12, color: "text.secondary", mr: 0.5 }}>Decision owners</Typography>
                        {a.owner.map((o) => (
                          <Box key={o} component="span" sx={{ fontSize: 12, px: 1, py: 0.35, border: 1, borderColor: "divider", borderRadius: "3px" }}>{o}</Box>
                        ))}
                      </Stack>
                      <Link component="button" onClick={() => onOpenGap(a.gap_id)} sx={{ fontSize: 13 }}>Open deviation</Link>
                    </Stack>
                    <DecisionButtons gapId={a.gap_id} reviewer={reviewer} deciding={deciding} onDecide={onDecide}
                                     decisions={decisions[a.gap_id]} comment={optionComment(options, choice[a.gap_id])} />
                  </Stack>
                </Collapse>
              </Box>
            </Box>
          );
        })}
        {noTime.length > 0 && (
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", pl: { sm: 12 } }}>
            {noTime.length} further difference{noTime.length === 1 ? " needs" : "s need"} no workshop time; see the Deviations tab.
          </Typography>
        )}
      </Stack>

      <Stack spacing={2} sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>
        <Section title="Decision progress">
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Typography sx={{ fontFamily: MONO, fontSize: 30, fontWeight: 500, lineHeight: 1 }}>{decidedCount}</Typography>
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>of {agenda.length} decided · {minutesLeft} min to go</Typography>
          </Stack>
          <Box sx={{ display: "flex", height: 8, mt: 1.5, bgcolor: "action.hover" }}>
            {(["accept", "defer", "reject"] as const).map((v) => (
              <Box key={v} sx={{ flex: `${tally[v]} 1 0`, bgcolor: colour(v) }} />
            ))}
            <Box sx={{ flex: `${tally.open} 1 0` }} />
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, columnGap: 2, mt: 1.5 }}>
            {([["accept", "Accepted"], ["defer", "Deferred"], ["reject", "Rejected"], ["open", "Open"]] as const).map(([k, l]) => (
              <Stack key={k} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Box sx={{ width: 10, height: 10, bgcolor: k === "open" ? "action.disabled" : colour(k) }} />
                <Typography sx={{ fontSize: 12.5, flex: 1 }}>{l}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: 12.5 }}>{tally[k]}</Typography>
              </Stack>
            ))}
          </Box>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1.5 }}>
            Each verdict is recorded against the name in Deciding as, with the option chosen.
          </Typography>
        </Section>

        <Section title="Who needs to be in the room" hint={`${roster.length} roles`}>
          {roster.map((r, i) => (
            <Box key={r.role} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 0.75, columnGap: 1.5, py: 1.1,
                                    borderTop: i ? 1 : 0, borderColor: "divider" }}>
              <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{r.role}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{r.minutes} min</Typography>
              <Stack direction="row" useFlexGap sx={{ gridColumn: "1 / -1", flexWrap: "wrap", gap: 0.5 }}>
                {r.items.map((g) => (
                  <ButtonBase key={g} onClick={() => setOpen(g)}
                              sx={{ fontFamily: MONO, fontSize: 12, color: p.accent, bgcolor: "action.selected", px: 0.75, borderRadius: "2px" }}>
                    {g}
                  </ButtonBase>
                ))}
              </Stack>
            </Box>
          ))}
        </Section>

        {(confirm.length > 0 || analysis.fit_areas.length > 0) && (
          <Section title="Batch-confirm, no floor time" hint={`${pending.length} of ${confirm.length} open`}>
            {confirm.map((d, i) => {
              const last = latest(decisions[d.gap_id]);
              return (
                <Box key={d.gap_id} sx={{ display: "grid", gridTemplateColumns: "30px 58px minmax(0, 1fr)", alignItems: "start", py: 0.75,
                                          borderTop: i ? 1 : 0, borderColor: "divider" }}>
                  {last ? <Box /> : (
                    <Checkbox size="small" sx={{ p: 0.25 }} checked={ticked.has(d.gap_id)}
                              slotProps={{ input: { "aria-label": `Confirm ${d.gap_id}` } }}
                              onChange={(e) => setTicked((t) => {
                                const n = new Set(t); if (e.target.checked) n.add(d.gap_id); else n.delete(d.gap_id); return n;
                              })} />
                  )}
                  <Link component="button" onClick={() => onOpenGap(d.gap_id)}
                        sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, textAlign: "left", pt: 0.35 }}>{d.gap_id}</Link>
                  <Stack spacing={0.25} sx={{ pt: 0.25 }}>
                    <Typography sx={{ fontSize: 12.5, lineHeight: 1.45 }}>{d.exact_difference}</Typography>
                    {last && <StatusText decision={last} size={12} />}
                  </Stack>
                </Box>
              );
            })}
            {pending.length > 0 && onDecide && (
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: RADIUS }}
                          onClick={() => setTicked(new Set(ticked.size === pending.length ? [] : pending.map((d) => d.gap_id)))}>
                    {ticked.size === pending.length ? "Clear" : "Select all"}
                  </Button>
                  <Button size="small" variant="contained" disableElevation sx={{ textTransform: "none", borderRadius: RADIUS, flex: 1 }}
                          disabled={!reviewer.trim() || !tickedPending.length} onClick={confirmSelected}>
                    Confirm {tickedPending.length || ""} selected
                  </Button>
                </Stack>
                {!reviewer.trim() && <Typography sx={{ fontSize: 12, color: "error.main" }}>Name yourself in Deciding as to confirm.</Typography>}
              </Stack>
            )}
            {analysis.fit_areas.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Link component="button" onClick={() => setShowFit((v) => !v)} sx={{ fontSize: 12.5 }}>
                  {showFit ? "Hide" : "Plus"} {analysis.fit_areas.length} areas that already fit the template
                </Link>
                <Collapse in={showFit}>
                  <Stack spacing={0.75} sx={{ mt: 1 }}>
                    {analysis.fit_areas.map((f, i) => (
                      <Typography key={i} sx={{ fontSize: 12.5, lineHeight: 1.5 }}>
                        <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary", mr: 0.75 }}>{f.as_is_step_id}</Box>{f.statement}
                      </Typography>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            )}
          </Section>
        )}
      </Stack>
    </Box>
  );
}
