/** Facilitator mode — design W2: one decision at a time, full screen, for the
 *  screen shared in the workshop room. The question set large, the options as
 *  cards to point at, both sides of the difference beside it, and the agenda
 *  along the bottom with the time each item was given. */
import { Box, ButtonBase, Dialog, Stack, Typography } from "@mui/material";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import type { RolloutAnalysis, RolloutDecision, RolloutScores, RolloutSubject } from "../../api";
import { VERDICT_LABEL, latest, type OnDecide, type Verdict } from "./decision";
import { MONO, SERIF, usePremium } from "./premium";
import { optionComment } from "./WorkshopAgendaView";

const LETTERS = "ABCDEFGH";

function BandAction({ children, onClick, primary, disabled, tone }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; tone?: string;
}) {
  const p = usePremium();
  return (
    <ButtonBase onClick={onClick} disabled={disabled}
                sx={{ height: 40, px: 2.25, borderRadius: "4px", fontSize: 14, fontWeight: primary ? 600 : 500, whiteSpace: "nowrap",
                      bgcolor: primary ? p.accentOnBand : "transparent", color: primary ? p.onAccent : tone ?? p.bandText,
                      border: `1px solid ${primary ? p.accentOnBand : p.bandLine}`, opacity: disabled ? 0.45 : 1,
                      "&:focus-visible": { outline: `2px solid ${p.accentOnBand}`, outlineOffset: 2 } }}>
      {children}
    </ButtonBase>
  );
}

export default function FacilitatorView({
  open, start, onClose, analysis, scores, subject, country, decisions, reviewer, onReviewer, deciding, onDecide,
}: {
  open: boolean;
  start: number;
  onClose: () => void;
  analysis: RolloutAnalysis;
  scores: RolloutScores;
  subject: RolloutSubject;
  country: string;
  decisions: Record<string, RolloutDecision[]>;
  reviewer: string;
  onReviewer: (name: string) => void;
  deciding: Record<string, string>;
  onDecide?: OnDecide;
}) {
  const p = usePremium();
  const agenda = scores.agenda;
  const [idx, setIdx] = useState(start);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  const [ticking, setTicking] = useState(false);

  useEffect(() => { if (open) setIdx(start); }, [open, start]);
  const a = agenda[Math.min(idx, agenda.length - 1)];
  // A new item gets its own allotment; the clock never carries over.
  useEffect(() => { if (a) { setLeft(a.minutes * 60); setTicking(false); } }, [a]);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!a) return null;
  const dev = analysis.deviations.find((d) => d.gap_id === a.gap_id);
  const options = a.options.length ? a.options : dev?.decision_options ?? [];
  const gt = dev?.evidence.find((e) => e.side === "template");
  const asIs = dev?.evidence.find((e) => e.side !== "template");
  const last = latest(decisions[a.gap_id]);
  const named = !!reviewer.trim();
  const busy = !!deciding[a.gap_id];
  const go = (i: number) => setIdx(Math.max(0, Math.min(agenda.length - 1, i)));
  const record = (v: Verdict) => onDecide?.(a.gap_id, v, optionComment(options, choice[a.gap_id]));
  const over = left === 0;
  const panel = { bgcolor: p.bandRaised, border: `1px solid ${p.bandLine}`, borderRadius: "6px", p: 2, display: "flex", flexDirection: "column", gap: 1 } as const;
  const kicker = { fontSize: 12, fontWeight: 600, letterSpacing: "0.1em" } as const;

  return (
    <Dialog fullScreen open={open} onClose={onClose} aria-label="Facilitator mode"
            slotProps={{ paper: { sx: { bgcolor: p.band, color: p.bandText, backgroundImage: "none" } } }}
            onKeyDown={(e) => {
              if ((e.target as HTMLElement).tagName === "INPUT") return;
              if (e.key === "ArrowRight") go(idx + 1);
              if (e.key === "ArrowLeft") go(idx - 1);
            }}>
      <Stack direction="row" spacing={3} sx={{ alignItems: "center", px: { xs: 2, md: 5 }, minHeight: 64, borderBottom: `1px solid ${p.bandLine}`, flexShrink: 0, flexWrap: "wrap", py: 1 }}>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 220 }}>
          <Typography sx={{ fontSize: 12, color: p.bandMuted }}>
            Fit-to-Standard workshop · {analysis.template_process ? analysis.template_process.split(" (")[0] : subject.label}{country ? ` — ${country}` : ""}
          </Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Decision {a.position} of {agenda.length}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography component="label" htmlFor="facilitator-name" sx={{ fontSize: 12, color: named ? p.bandMuted : p.amberOnBand }}>Deciding as</Typography>
          <Box component="input" id="facilitator-name" value={reviewer} placeholder="Your name"
               onChange={(e: ChangeEvent<HTMLInputElement>) => onReviewer(e.target.value)}
               sx={{ height: 32, width: 160, px: 1.25, fontSize: 13, fontFamily: "inherit", color: p.bandText, bgcolor: "transparent",
                     border: `1px solid ${p.bandLine}`, borderRadius: "4px", "&::placeholder": { color: p.bandMuted } }} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }} aria-live="polite">
          <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, color: over && ticking ? p.amberOnBand : p.bandText }}>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </Typography>
          <Typography sx={{ fontSize: 12, color: p.bandMuted }}>of {a.minutes} min</Typography>
        </Stack>
        <BandAction onClick={() => setTicking((t) => !t)}>{ticking ? "Pause" : left < a.minutes * 60 ? "Resume" : "Start timer"}</BandAction>
        <BandAction onClick={onClose}>Exit</BandAction>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", gap: { xs: 3, lg: 6 }, px: { xs: 2, md: 6 }, py: 4,
                 gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 440px" }, alignItems: "start" }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Typography sx={{ ...kicker, color: p.accentOnBand }}>
            DECISION {String(a.position).padStart(2, "0")} · {a.gap_id} · {a.primary_type} · {a.materiality.toUpperCase()} MATERIALITY
          </Typography>
          <Typography component="h1" sx={{ fontFamily: SERIF, fontSize: { xs: 24, md: 32 }, fontWeight: 500, lineHeight: 1.3 }}>{a.topic}</Typography>
          <Typography sx={{ fontSize: 16, lineHeight: 1.55, color: p.bandSoft }}>{a.why}</Typography>
          <Box role="radiogroup" aria-label="Options" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
            {options.map((o, j) => {
              const on = choice[a.gap_id] === j;
              return (
                <ButtonBase key={j} role="radio" aria-checked={on}
                            onClick={() => setChoice((c) => ({ ...c, [a.gap_id]: j }))}
                            sx={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-start", gap: 1.75, p: 2, minHeight: 88,
                                  textAlign: "left", borderRadius: "6px", bgcolor: on ? p.bandPicked : p.bandRaised,
                                  border: `1px solid ${on ? p.accentOnBand : p.bandLine}`,
                                  "&:focus-visible": { outline: `2px solid ${p.accentOnBand}`, outlineOffset: 2 } }}>
                  <Box component="span" sx={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center",
                                              justifyContent: "center", fontFamily: MONO, fontSize: 14, fontWeight: 600,
                                              ...(on ? { bgcolor: p.accentOnBand, color: p.onAccent } : { border: `1px solid ${p.accentOnBand}`, color: p.accentOnBand }) }}>
                    {LETTERS[j]}
                  </Box>
                  <Typography sx={{ fontSize: 15, lineHeight: 1.45 }}>{o}</Typography>
                </ButtonBase>
              );
            })}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 13, color: p.bandMuted, mr: 0.5 }}>Decision owners in the room</Typography>
            {a.owner.map((o) => (
              <Box key={o} component="span" sx={{ fontSize: 13, px: 1.25, py: 0.5, border: `1px solid ${p.bandLine}`, borderRadius: "3px" }}>{o}</Box>
            ))}
          </Stack>
          {last && (
            <Typography sx={{ fontSize: 14, color: p.accentOnBand }}>
              {VERDICT_LABEL[last.verdict]} by {last.reviewer}{last.comment ? ` — ${last.comment}` : ""}
            </Typography>
          )}
        </Stack>

        {dev && (
          <Stack spacing={1.75}>
            <Box sx={panel}>
              <Typography sx={{ ...kicker, color: p.accentOnBand }}>GLOBAL TEMPLATE</Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.5 }}>{dev.gt_statement}</Typography>
              {gt && (
                <>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: p.bandSoft, bgcolor: p.band, p: 1.25, borderRadius: "3px", overflowWrap: "anywhere" }}>
                    “{gt.quote}”
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: p.bandMuted }}>{gt.doc}</Typography>
                </>
              )}
            </Box>
            <Box sx={panel}>
              <Typography sx={{ ...kicker, color: p.amberOnBand }}>{subject.label.toUpperCase()}{dev.as_is_step_id ? ` · ${dev.as_is_step_id}` : ""}</Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.5 }}>{dev.as_is_statement}</Typography>
              {asIs && <Typography sx={{ fontSize: 12, color: p.bandMuted }}>{asIs.doc}</Typography>}
            </Box>
            {dev.impacts.length > 0 && (
              <Box sx={panel}>
                <Typography sx={{ ...kicker, color: p.bandMuted }}>IMPACT IF LEFT AS IT IS</Typography>
                {dev.impacts.map((im) => (
                  <Box key={im.area} title={im.note} sx={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr) 32px", gap: 1.25, alignItems: "center" }}>
                    <Typography sx={{ fontSize: 13 }}>{im.area}</Typography>
                    <Box sx={{ height: 8, bgcolor: p.bandLine }}>
                      <Box sx={{ height: 8, width: `${im.score * 20}%`, bgcolor: im.score >= 4 ? p.amberOnBand : p.accentOnBand }} />
                    </Box>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12, color: p.bandSoft, textAlign: "right" }}>{im.score}/5</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Box>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ borderTop: `1px solid ${p.bandLine}`, px: { xs: 2, md: 6 }, py: 2, flexShrink: 0, alignItems: { md: "center" } }}>
        <Box component="nav" aria-label="Agenda" sx={{ display: "flex", gap: 0.75, flex: 1, minWidth: 0 }}>
          {agenda.map((s, i) => {
            const on = i === idx;
            const done = !!latest(decisions[s.gap_id]);
            return (
              <ButtonBase key={s.gap_id} onClick={() => go(i)} aria-current={on ? "step" : undefined}
                          title={`${s.gap_id} · ${s.minutes} min${done ? " · decided" : ""}`}
                          sx={{ flex: `${s.minutes} 1 0`, minWidth: 0, height: 44, flexDirection: "column", alignItems: "flex-start", justifyContent: "center",
                                px: 1.25, borderRadius: "4px", overflow: "hidden",
                                ...(on ? { bgcolor: p.accentOnBand, color: p.onAccent, border: `1px solid ${p.accentOnBand}` }
                                  : done ? { bgcolor: p.bandPicked, color: p.bandText, border: `1px solid ${p.bandLine}` }
                                    : { color: p.bandSoft, border: `1px solid ${p.bandLine}` }) }}>
                <Typography noWrap sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, maxWidth: "100%" }}>{s.gap_id}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: 11.5, opacity: 0.75 }}>{done ? "decided" : `${s.minutes}′`}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <BandAction onClick={() => go(idx - 1)} disabled={idx === 0}>Previous</BandAction>
          {onDecide && (
            <>
              <BandAction primary disabled={!named || busy} onClick={() => record("accept")}>
                {deciding[a.gap_id] === "accept" ? "Saving…"
                  : choice[a.gap_id] === undefined ? "Accept" : `Accept option ${LETTERS[choice[a.gap_id]]}`}
              </BandAction>
              <BandAction disabled={!named || busy} tone={p.amberOnBand} onClick={() => record("defer")}>Defer</BandAction>
              <BandAction disabled={!named || busy} onClick={() => record("reject")}>Reject</BandAction>
            </>
          )}
          <BandAction onClick={() => go(idx + 1)} disabled={idx === agenda.length - 1}>Next decision</BandAction>
        </Stack>
      </Stack>
    </Dialog>
  );
}
