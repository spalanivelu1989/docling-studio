/** Brief — design B: the same analysis told as a boardroom deliverable. One
 *  number, set large; what was found, in prose; the decisions as a timeline
 *  of the workshop they fill; where it diverges; what to watch. Built for a
 *  screen shared with a steering committee, where the Summary's density is
 *  the wrong register. */
import { Box, ButtonBase, Stack, Typography, useTheme } from "@mui/material";
import type { ReactNode } from "react";

import type { RolloutAnalysis, RolloutScores, RolloutSubject } from "../../api";
import { MONO, RADIUS, SERIF, ratingColour, usePremium } from "./premium";

function Row({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  const p = usePremium();
  return (
    <Box sx={{ display: "grid", gap: { xs: 2, md: 6 }, gridTemplateColumns: { xs: "1fr", md: "260px minmax(0, 1fr)" }, py: 4.5,
               borderTop: 1, borderColor: "divider" }}>
      <Stack spacing={1}>
        <Typography sx={{ fontSize: 12, letterSpacing: "0.12em", fontWeight: 600, color: p.accent }}>{label}</Typography>
        <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.55 }}>{note}</Typography>
      </Stack>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export default function BriefView({ analysis, scores, subject, country, onGap }: {
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  country: string;
  onGap: (gapId: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  const c = scores.counts;
  const total = scores.agenda.reduce((n, a) => n + a.minutes, 0);
  const stats = [
    { v: scores.harmonization_potential === null ? "—" : `${scores.harmonization_potential}%`, l: "standardisation outlook" },
    { v: String(c.deviations), l: `deviations, ${c.by_materiality?.High ?? 0} of them high materiality` },
    { v: String(scores.agenda.length), l: "decisions for the workshop" },
    { v: String(c.fit_areas), l: "areas that already fit the template" },
  ];

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, overflow: "hidden", bgcolor: "background.paper" }}>
      <Box sx={{ bgcolor: p.band, color: p.bandText, px: { xs: 3, md: 7 }, py: { xs: 4, md: 5.5 }, display: "grid", gap: 6,
                 gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.25fr) minmax(0, 1fr)" } }}>
        <Stack spacing={2.25}>
          <Typography sx={{ fontSize: 12, letterSpacing: "0.14em", fontWeight: 600, color: p.accentOnBand }}>
            FIT-TO-STANDARD{country ? ` · ${country.toUpperCase()}` : ""} · {subject.label.toUpperCase()}
          </Typography>
          <Stack direction="row" spacing={2.5} sx={{ alignItems: "flex-end" }}>
            <Typography sx={{ fontFamily: SERIF, fontSize: { xs: 80, md: 112 }, lineHeight: 0.9, fontWeight: 600 }}>
              {scores.gt_alignment === null ? "—" : scores.gt_alignment}
            </Typography>
            <Stack spacing={0.5} sx={{ pb: 1.25 }}>
              <Typography sx={{ fontFamily: SERIF, fontSize: 22 }}>out of 100</Typography>
              <Typography sx={{ fontSize: 14, color: p.bandSoft }}>alignment with the Global Template</Typography>
            </Stack>
          </Stack>
          {scores.gt_band && (
            <Typography sx={{ fontFamily: SERIF, fontSize: 22, color: p.amberOnBand }}>{scores.gt_band}.</Typography>
          )}
        </Stack>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1px", bgcolor: p.bandLine,
                   border: `1px solid ${p.bandLine}`, alignSelf: "end" }}>
          {stats.map((s) => (
            <Stack key={s.l} spacing={0.75} sx={{ bgcolor: p.band, px: 2.75, py: 2.5 }}>
              <Typography sx={{ fontFamily: SERIF, fontSize: 38, fontWeight: 600, lineHeight: 1 }}>{s.v}</Typography>
              <Typography sx={{ fontSize: 13, color: p.bandSoft }}>{s.l}</Typography>
            </Stack>
          ))}
        </Box>
      </Box>

      <Box sx={{ px: { xs: 3, md: 7 }, pb: 2 }}>
        <Row label="WHAT WE FOUND"
             note={`From ${subject.label === "Country As-Is" ? "the country's" : "the"} process read step by step against the template, its workshop minutes and the BPML hierarchy.`}>
          <Typography sx={{ fontFamily: SERIF, fontSize: { xs: 18, md: 22 }, lineHeight: 1.55 }}>{analysis.headline}</Typography>
        </Row>

        {scores.agenda.length > 0 && (
          <Row label="THE DECISIONS" note={`${scores.agenda.length} items for the workshop, legal and control blockers first. ${total} minutes in total.`}>
            <Box sx={{ display: "flex", height: 36, gap: "3px" }}>
              {scores.agenda.map((a) => {
                const heavy = a.materiality === "High" || a.materiality === "Critical";
                return (
                  <ButtonBase key={a.gap_id} onClick={() => onGap(a.gap_id)} title={`${a.gap_id} · ${a.minutes} min`}
                              sx={{ flex: `${a.minutes} 1 0`, bgcolor: heavy ? "text.primary" : "action.selected",
                                    color: heavy ? "background.paper" : "text.primary", fontFamily: MONO, fontSize: 11.5 }}>
                    {a.gap_id}
                  </ButtonBase>
                );
              })}
            </Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", mt: 0.75 }}>
              {["0′", `${Math.round(total / 2)}′`, `${total}′`].map((t) => (
                <Typography key={t} sx={{ fontFamily: MONO, fontSize: 11, color: "text.secondary" }}>{t}</Typography>
              ))}
            </Stack>
            <Box sx={{ mt: 2 }}>
              {scores.agenda.map((a) => (
                <ButtonBase key={a.gap_id} onClick={() => onGap(a.gap_id)}
                            sx={{ display: "grid", width: "100%", textAlign: "left", alignItems: "baseline", py: 1.75,
                                  borderTop: 1, borderColor: "divider", columnGap: 2,
                                  gridTemplateColumns: { xs: "34px 1fr 44px", md: "34px 72px minmax(0, 1fr) 240px 48px" },
                                  "&:hover .topic": { textDecoration: "underline" } }}>
                  <Typography sx={{ fontFamily: SERIF, fontSize: 22, color: p.accent }}>{a.position}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12.5, color: "text.secondary", display: { xs: "none", md: "block" } }}>{a.gap_id}</Typography>
                  <Typography className="topic" sx={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.45 }}>{a.topic}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary", display: { xs: "none", md: "block" } }}>{a.owner.slice(0, 2).join(" · ")}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12.5, textAlign: "right" }}>{a.minutes}′</Typography>
                </ButtonBase>
              ))}
            </Box>
          </Row>
        )}

        <Row label="WHERE IT DIVERGES" note="Seven dimensions, rated 0–4 against the template, weighted into the score.">
          <Box sx={{ display: "grid", gap: 5, gridTemplateColumns: { xs: "1fr", md: subject.localization ? "minmax(0, 1fr) 320px" : "1fr" } }}>
            <Stack spacing={1.25}>
              {scores.dimensions.map((d) => (
                <Box key={d.dimension} title={d.note}
                     sx={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 40px", gap: 1.75, alignItems: "center" }}>
                  <Typography sx={{ fontSize: 13.5 }}>{d.label}</Typography>
                  <Box sx={{ height: 14, bgcolor: "action.selected", position: "relative" }}>
                    <Box sx={{ position: "absolute", inset: 0, width: `${((d.rating ?? 0) / 4) * 100}%`,
                               bgcolor: ratingColour(theme, p.accent, d.rating) }} />
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: 13, textAlign: "right" }}>{d.rating ?? "—"}/4</Typography>
                </Box>
              ))}
            </Stack>
            {subject.localization && (
              <Stack spacing={1.25} sx={{ borderLeft: { md: 1 }, borderColor: "divider", pl: { md: 3.5 } }}>
                <Typography sx={{ fontSize: 12, letterSpacing: "0.12em", fontWeight: 600, color: "warning.main" }}>
                  {country ? `${country.toUpperCase()} ` : ""}WATCHLIST
                </Typography>
                {analysis.localization.map((l, i) => (
                  <Typography key={i} sx={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4 }}>{l.topic}</Typography>
                ))}
                {!analysis.localization.length && (
                  <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Nothing statutory interacts with this process.</Typography>
                )}
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {c.localization_confirmed} of {analysis.localization.length} confirmed with a statutory source.
                </Typography>
              </Stack>
            )}
          </Box>
        </Row>
      </Box>
    </Box>
  );
}
