/** Summary — design A's body: the executive summary and the deviation
 *  register on the left; dimension ratings, the workshop plan and the
 *  localization watchlist on the right. Everything a steering reader needs on
 *  one screen, each part opening the tab that holds its detail. */
import { Alert, Box, ButtonBase, Link, Stack, Typography, useTheme } from "@mui/material";
import type { ReactNode } from "react";

import type { RolloutAnalysis, RolloutScores, RolloutSubject } from "../../api";
import { BUCKET_LABEL, MONO, RADIUS, materialityColour, ranked, ratingColour, usePremium } from "./premium";

export function Section({ title, hint, children, pad = true }: {
  title: string; hint?: ReactNode; children: ReactNode; pad?: boolean;
}) {
  return (
    <Box component="section" sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS,
                                   display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", justifyContent: "space-between",
                                                 px: 2.5, pt: 2, pb: pad ? 1.25 : 1.5 }}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600 }}>{title}</Typography>
        {hint && <Typography sx={{ fontSize: 12, color: "text.secondary", textAlign: "right" }}>{hint}</Typography>}
      </Stack>
      <Box sx={{ px: pad ? 2.5 : 0, pb: pad ? 2.25 : 0 }}>{children}</Box>
    </Box>
  );
}

export default function SummaryView({ analysis, scores, subject, onGap, onTab }: {
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  onGap: (gapId: string) => void;
  onTab: (tab: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  const devs = ranked(analysis.deviations);
  const counts = scores.counts;
  const lead = scores.agenda.slice(0, 2);
  const grid = "76px minmax(0, 1fr) 44px 108px 92px 104px";

  return (
    <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) minmax(0, 1fr)" } }}>
      <Stack spacing={3} sx={{ minWidth: 0 }}>
        <Section title="Executive summary"
                 hint={analysis.template_process ? `compared against ${analysis.template_process.split(" (")[0]}` : undefined}>
          <Typography sx={{ fontSize: 14.5, lineHeight: 1.65 }}>{analysis.headline}</Typography>
          {scores.pattern && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2, fontSize: 12.5, borderRadius: RADIUS }}>{scores.pattern}</Alert>
          )}
          {lead.length > 0 && (
            <Box sx={{ display: "grid", gap: 1.5, mt: 2, gridTemplateColumns: { xs: "1fr", md: `repeat(${lead.length}, minmax(0, 1fr))` } }}>
              {lead.map((a) => (
                <ButtonBase key={a.gap_id} onClick={() => onGap(a.gap_id)}
                            sx={{ display: "block", textAlign: "left", border: 1, borderColor: "divider", borderRadius: RADIUS,
                                  p: 1.75, "&:hover": { borderColor: p.accent } }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em", color: p.accent }}>
                    DECISION {a.position} · {a.gap_id} · {a.minutes} MIN
                  </Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, mt: 0.6, lineHeight: 1.4 }}>{a.topic}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.6 }}>{a.owner.slice(0, 2).join(" · ")}</Typography>
                </ButtonBase>
              ))}
            </Box>
          )}
        </Section>

        <Section pad={false} title="Deviation register"
                 hint={`${analysis.deviations.length} deviations · ${counts.by_materiality?.High ?? 0} high · ${counts.workshop?.MUST_DISCUSS ?? 0} must discuss`}>
          {devs.length ? (
            <Box sx={{ overflowX: "auto" }}>
              <Box sx={{ minWidth: 700 }}>
                <Box sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, px: 2.5, py: 1,
                           borderTop: 1, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover",
                           "& > *": { fontSize: 11.5, fontWeight: 600, color: "text.secondary" } }}>
                  <span>ID</span><span>Finding</span><span>Type</span><span>Dimension</span><span>Materiality</span><span>Workshop</span>
                </Box>
                {devs.map((d) => {
                  const mc = materialityColour(theme, d.materiality);
                  const must = d.workshop_bucket === "MUST_DISCUSS";
                  return (
                    <ButtonBase key={d.gap_id} onClick={() => onGap(d.gap_id)}
                                sx={{ display: "grid", gridTemplateColumns: grid, columnGap: 1.75, alignItems: "center",
                                      width: "100%", textAlign: "left", px: 2.5, minHeight: 42, borderBottom: 1, borderColor: "divider",
                                      "&:hover": { bgcolor: "action.hover" } }}>
                      <Typography sx={{ fontFamily: MONO, fontSize: 12.5, color: p.accent, fontWeight: 500 }}>{d.gap_id}</Typography>
                      <Typography sx={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                  title={d.exact_difference}>{d.exact_difference}</Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{d.primary_type}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: "text.secondary", textTransform: "capitalize" }}>{d.dimension}</Typography>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", color: mc, fontWeight: 600, fontSize: 12.5 }}>
                        <Box sx={{ width: 8, height: 8, bgcolor: mc }} /><span>{d.materiality}</span>
                      </Stack>
                      <Typography sx={{ fontSize: 12, fontWeight: must ? 600 : 400, color: must ? "text.primary" : "text.secondary" }}>
                        {BUCKET_LABEL[d.workshop_bucket] ?? d.workshop_bucket}
                      </Typography>
                    </ButtonBase>
                  );
                })}
              </Box>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13, color: "text.secondary", px: 2.5, pb: 2 }}>
              No material deviation was found between the {subject.label} and the Global Template.
            </Typography>
          )}
        </Section>
      </Stack>

      <Stack spacing={3} sx={{ minWidth: 0 }}>
        <Section title="Alignment by dimension" hint={<Link component="button" onClick={() => onTab("dimensions")}>rated 0–4 · detail</Link>}>
          <Stack spacing={1.25}>
            {scores.dimensions.map((d) => {
              const c = ratingColour(theme, p.accent, d.rating);
              return (
                <Box key={d.dimension} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 104px 36px", gap: 1.25, alignItems: "center" }}
                     title={d.note}>
                  <Typography sx={{ fontSize: 12.5 }}>{d.label}</Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "3px" }}>
                    {[1, 2, 3, 4].map((i) => (
                      <Box key={i} sx={{ height: 10, bgcolor: d.rating !== null && i <= d.rating ? c : "action.selected" }} />
                    ))}
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", textAlign: "right" }}>{d.weight}%</Typography>
                </Box>
              );
            })}
          </Stack>
        </Section>

        <Section title="Workshop plan"
                 hint={<Link component="button" onClick={() => onTab("workshop")}>{scores.agenda.length} decisions · {counts.workshop_minutes} min</Link>}>
          {scores.agenda.length ? (
            <Stack spacing={1}>
              <Box sx={{ display: "flex", height: 12, gap: "2px", mb: 0.5 }}>
                {scores.agenda.map((a) => (
                  <Box key={a.gap_id} title={`${a.gap_id} · ${a.minutes} min`}
                       sx={{ flex: `${a.minutes} 1 0`, bgcolor: a.materiality === "High" || a.materiality === "Critical" ? "text.primary" : "action.disabled" }} />
                ))}
              </Box>
              {scores.agenda.map((a) => (
                <ButtonBase key={a.gap_id} onClick={() => onGap(a.gap_id)}
                            sx={{ display: "grid", gridTemplateColumns: "18px 58px minmax(0, 1fr) 36px", gap: 1, alignItems: "baseline",
                                  textAlign: "left", width: "100%", py: 0.25, "&:hover .t": { textDecoration: "underline" } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary" }}>{a.position}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, color: p.accent, fontWeight: 500 }}>{a.gap_id}</Typography>
                  <Typography className="t" sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={a.topic}>{a.topic}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", textAlign: "right" }}>{a.minutes}′</Typography>
                </ButtonBase>
              ))}
            </Stack>
          ) : (
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Nothing needs floor time.</Typography>
          )}
        </Section>

        {subject.localization && (
          <Section title="Localization watchlist"
                   hint={`${analysis.localization.length} items · ${counts.localization_confirmed} confirmed`}>
            {analysis.localization.length ? (
              <Stack>
                {analysis.localization.map((l, i) => (
                  <ButtonBase key={i} onClick={() => onTab("localization")}
                              sx={{ display: "flex", justifyContent: "space-between", gap: 1.5, py: 1, textAlign: "left",
                                    borderTop: i ? 1 : 0, borderColor: "divider" }}>
                    <Typography sx={{ fontSize: 12.5 }}>{l.topic}</Typography>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0,
                                      color: l.status === "Confirmed" ? "info.main" : l.status === "Candidate" ? "warning.main" : "text.secondary" }}>
                      {l.status}
                    </Typography>
                  </ButtonBase>
                ))}
                <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 1 }}>
                  A candidate does not raise the localization-adjusted score until it is confirmed with a source.
                </Typography>
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No localization topic interacts with this process.</Typography>
            )}
          </Section>
        )}
      </Stack>
    </Box>
  );
}
