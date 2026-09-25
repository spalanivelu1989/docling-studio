/** Process alignment — design C: the subject's process, step by step, with
 *  what the comparison found against each step, and the chosen finding open
 *  beside it.
 *
 *  The register lists deviations; this shows where in the process they sit,
 *  which is the question a process owner asks first. A step is marked from
 *  the analysis itself -- a fit area or a deviation naming its step id -- and
 *  a finding that names a range of steps, or none, is listed under the table
 *  rather than smeared across every step it spans.
 */
import { Box, Button, ButtonBase, Link, Stack, Typography, useTheme } from "@mui/material";
import { useMemo, useState } from "react";

import type { AsIsModel, Deviation, RolloutAnalysis, RolloutDecision, RolloutScores, RolloutSubject } from "../../api";
import { BUCKET_LABEL, MONO, RADIUS, materialityColour, stepsOf, usePremium } from "./premium";

type Mark = "fit" | "partial" | "dev" | "none";

export default function ProcessAlignmentView({
  asis, analysis, scores, subject, decisions, reviewer, deciding, onDecide, onOpenGap,
}: {
  asis: AsIsModel;
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  decisions: Record<string, RolloutDecision[]>;
  reviewer: string;
  deciding: Record<string, string>;
  onDecide?: (gapId: string, verdict: "accept" | "reject" | "defer") => void;
  onOpenGap: (gapId: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();

  const { byStep, fitByStep, spanning } = useMemo(() => {
    const byStep: Record<string, Deviation[]> = {};
    const fitByStep: Record<string, string[]> = {};
    const spanning: Deviation[] = [];
    for (const d of analysis.deviations) {
      const s = stepsOf(d.as_is_step_id);
      if (!s.ids.length) { spanning.push(d); continue; }
      for (const id of s.ids) (byStep[id] ??= []).push(d);
    }
    for (const f of analysis.fit_areas) {
      for (const id of stepsOf(f.as_is_step_id).ids) (fitByStep[id] ??= []).push(f.statement);
    }
    return { byStep, fitByStep, spanning };
  }, [analysis]);

  const firstGap = analysis.deviations.find((d) => stepsOf(d.as_is_step_id).ids.length)?.gap_id
    ?? analysis.deviations[0]?.gap_id ?? "";
  const [picked, setPicked] = useState<{ step?: string; gap?: string }>({ gap: firstGap });

  const colour: Record<Mark, string> = {
    fit: p.accent, partial: theme.palette.warning.main, dev: theme.palette.error.main, none: theme.palette.action.disabled,
  };
  const label: Record<Mark, string> = {
    fit: "Fits the template", partial: "Fits, with a deviation", dev: "Deviation", none: "Not mapped",
  };
  const markOf = (id: string): Mark => {
    const f = !!fitByStep[id], d = !!byStep[id];
    return f && d ? "partial" : f ? "fit" : d ? "dev" : "none";
  };
  const counts = asis.steps.reduce((acc, s) => ({ ...acc, [markOf(s.step_id)]: (acc[markOf(s.step_id)] ?? 0) + 1 }),
                                   {} as Record<Mark, number>);

  const gap = analysis.deviations.find((d) => d.gap_id === picked.gap) ?? null;
  const fitStep = !gap && picked.step ? picked.step : null;
  const agenda = gap ? scores.agenda.find((a) => a.gap_id === gap.gap_id) : undefined;
  const past = gap ? decisions[gap.gap_id] ?? [] : [];
  const last = past[past.length - 1];
  const grid = "58px 6px minmax(0, 1fr) 190px 150px";

  return (
    <Box sx={{ display: "grid", gap: 3, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 440px" } }}>
      <Stack spacing={1.5} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={2.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          {(["fit", "partial", "dev", "none"] as Mark[]).map((m) => (
            <Stack key={m} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 12, height: 12, bgcolor: colour[m] }} />
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{label[m]}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 12.5 }}>{counts[m] ?? 0}</Typography>
            </Stack>
          ))}
        </Stack>
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, bgcolor: "background.paper", overflowX: "auto" }}>
          <Box sx={{ minWidth: 640 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, px: 1.5, py: 1, borderBottom: 1, borderColor: "divider",
                       bgcolor: "action.hover", "& > *": { fontSize: 11.5, fontWeight: 600, color: "text.secondary" } }}>
              <span>Step</span><span /><span>{subject.label} ({asis.steps.length} steps, in order)</span><span>Actor</span><span>Findings</span>
            </Box>
            {asis.steps.map((s) => {
              const m = markOf(s.step_id);
              const devs = byStep[s.step_id] ?? [];
              const on = gap ? devs.some((d) => d.gap_id === gap.gap_id) : fitStep === s.step_id;
              return (
                <ButtonBase key={s.step_id} aria-pressed={on}
                            onClick={() => setPicked(devs.length ? { gap: devs[0].gap_id, step: s.step_id } : { step: s.step_id })}
                            sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, alignItems: "center", width: "100%",
                                  textAlign: "left", px: 1.5, minHeight: 38, borderBottom: 1, borderColor: "divider",
                                  bgcolor: on ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{s.step_id}</Typography>
                  <Box sx={{ height: 26, bgcolor: colour[m] }} title={label[m]} />
                  <Typography sx={{ fontSize: 13, fontWeight: devs.length ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={s.name}>{s.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={s.actor}>{s.actor || "—"}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 500,
                                    color: devs.length ? "error.main" : m === "fit" ? p.accent : "text.disabled" }}>
                    {devs.length ? devs.map((d) => d.gap_id).join("  ") : m === "fit" ? "fits" : "—"}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
        {spanning.length > 0 && (
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", px: 0.5 }}>
            Not tied to one step:{" "}
            {spanning.map((d, i) => (
              <span key={d.gap_id}>
                {i ? ", " : ""}
                <Link component="button" onClick={() => setPicked({ gap: d.gap_id })} sx={{ fontFamily: MONO, fontSize: 12.5 }}>{d.gap_id}</Link>
                {d.as_is_step_id && !/^n\/?a$/i.test(d.as_is_step_id) ? ` (${d.as_is_step_id})` : ""}
              </span>
            ))}.
          </Typography>
        )}
      </Stack>

      <Box component="aside" aria-label="Selected finding"
           sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, bgcolor: "background.paper", p: 2.75,
                 position: { lg: "sticky" }, top: { lg: 16 }, display: "flex", flexDirection: "column", gap: 2 }}>
        {gap ? (
          <>
            <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: p.accent }}>{gap.gap_id}</Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: materialityColour(theme, gap.materiality) }}>
                {gap.materiality} materiality
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {gap.primary_type} · {gap.dimension}{gap.as_is_step_id ? ` · ${gap.as_is_step_id}` : ""}
              </Typography>
            </Stack>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4 }}>{gap.exact_difference}</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, border: 1, borderColor: "divider" }}>
              <Stack spacing={0.75} sx={{ p: 1.5, borderRight: { sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: "divider" }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "text.secondary" }}>{subject.label.toUpperCase()}</Typography>
                <Typography sx={{ fontSize: 12.5, lineHeight: 1.55 }}>{gap.as_is_statement || "—"}</Typography>
              </Stack>
              <Stack spacing={0.75} sx={{ p: 1.5, bgcolor: "action.hover" }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: p.accent }}>GLOBAL TEMPLATE</Typography>
                <Typography sx={{ fontSize: 12.5, lineHeight: 1.55 }}>{gap.gt_statement || "—"}</Typography>
              </Stack>
            </Box>
            {gap.impacts.length > 0 && (
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>Impact</Typography>
                {gap.impacts.map((im) => (
                  <Box key={im.area} sx={{ display: "grid", gridTemplateColumns: "140px 36px minmax(0, 1fr)", gap: 1, alignItems: "baseline" }}>
                    <Typography sx={{ fontSize: 12.5 }}>{im.area}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500,
                                      color: im.score >= 4 ? "error.main" : im.score >= 3 ? "warning.main" : "text.primary" }}>{im.score}/5</Typography>
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{im.note}</Typography>
                  </Box>
                ))}
              </Stack>
            )}
            {(agenda || gap.decision_question) && (
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>
                  Workshop question{agenda ? ` · ${agenda.minutes} min` : ""} · {BUCKET_LABEL[gap.workshop_bucket] ?? gap.workshop_bucket}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.45 }}>{agenda?.topic || gap.decision_question}</Typography>
                {(agenda?.options ?? gap.decision_options).length > 0 && (
                  <Box component="ol" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.5 }}>
                    {(agenda?.options ?? gap.decision_options).map((o, i) => (
                      <Typography key={i} component="li" sx={{ fontSize: 12.5 }}>{o}</Typography>
                    ))}
                  </Box>
                )}
              </Stack>
            )}
            {gap.decision_owner.length > 0 && (
              <Typography sx={{ fontSize: 12.5 }}>
                <Box component="span" sx={{ color: "text.secondary" }}>Decision owners </Box>{gap.decision_owner.join(" · ")}
              </Typography>
            )}
            <Stack spacing={1} sx={{ borderTop: 1, borderColor: "divider", pt: 1.75 }}>
              {last && (
                <Typography sx={{ fontSize: 12.5 }}>
                  <b>{last.verdict === "accept" ? "Accepted" : last.verdict === "reject" ? "Rejected" : "Deferred"}</b> by {last.reviewer}
                  {past.length > 1 ? ` (${past.length} verdicts)` : ""}
                </Typography>
              )}
              {onDecide ? (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                  {(["accept", "defer", "reject"] as const).map((v) => (
                    <Button key={v} size="small" variant={v === "accept" ? "contained" : "outlined"} disableElevation
                            disabled={!reviewer.trim() || !!deciding[gap.gap_id]}
                            onClick={() => onDecide(gap.gap_id, v)}
                            sx={{ textTransform: "none", borderRadius: RADIUS, minWidth: 76 }}>
                      {deciding[gap.gap_id] === v ? "Saving…" : v[0].toUpperCase() + v.slice(1)}
                    </Button>
                  ))}
                  {!reviewer.trim() && (
                    <Typography sx={{ fontSize: 12, color: "error.main" }}>Name yourself above to decide.</Typography>
                  )}
                </Stack>
              ) : null}
              <Link component="button" onClick={() => onOpenGap(gap.gap_id)} sx={{ fontSize: 12.5, alignSelf: "flex-start" }}>
                Open with its evidence in the Deviations tab
              </Link>
            </Stack>
          </>
        ) : fitStep ? (
          <>
            <Typography sx={{ fontFamily: MONO, fontSize: 13, color: "text.secondary" }}>{fitStep}</Typography>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
              {asis.steps.find((s) => s.step_id === fitStep)?.name}
            </Typography>
            {(fitByStep[fitStep] ?? []).length ? (
              fitByStep[fitStep].map((t, i) => (
                <Typography key={i} sx={{ fontSize: 13, lineHeight: 1.55 }}>
                  <Box component="span" sx={{ color: p.accent, fontWeight: 600 }}>Fits. </Box>{t}
                </Typography>
              ))
            ) : (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                The comparison neither matched this step to the template nor raised a deviation on it.
              </Typography>
            )}
          </>
        ) : (
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Choose a step to see what was found.</Typography>
        )}
      </Box>
    </Box>
  );
}
