/** Facilitator mode — design W2: one decision at a time, full screen, for the
 *  screen shared in the workshop room. The question set large, the options as
 *  cards to point at, both sides of the difference beside it, and the agenda
 *  along the bottom with the time each item was given. */
import { alpha, Box, ButtonBase, Dialog, Stack, Typography, useTheme } from "@mui/material";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import type { RolloutAnalysis, RolloutDecision, RolloutScores, RolloutSubject } from "../../api";
import { VERDICT_LABEL, latest, type OnDecide, type Verdict } from "./decision";
import { MONO, SERIF, usePremium } from "./premium";
import { optionComment } from "./WorkshopAgendaView";

const LETTERS = "ABCDEFGH";

/** The facilitator's colours: the page's own, so the room sees what the app
 *  shows -- light in the light theme, Frappé in the dark one. It used to be
 *  drawn on the header's navy band, which put a dark screen on the projector
 *  whatever the app was set to. */
function useFacilitatorColours() {
  const theme = useTheme();
  const p = usePremium();
  return {
    bg: theme.palette.background.default,
    raised: theme.palette.background.paper,
    line: theme.palette.divider,
    text: theme.palette.text.primary,
    muted: theme.palette.text.secondary,
    soft: theme.palette.text.secondary,
    accent: p.accent,
    onAccent: p.dark ? p.onAccent : theme.palette.common.white,
    amber: theme.palette.warning.main,
    picked: alpha(p.accent, 0.1),
  };
}

function BandAction({ children, onClick, primary, disabled, tone }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; tone?: string;
}) {
  const f = useFacilitatorColours();
  return (
    <ButtonBase onClick={onClick} disabled={disabled}
                sx={{ height: 40, px: 2.25, borderRadius: "4px", fontSize: 14, fontWeight: primary ? 600 : 500, whiteSpace: "nowrap",
                      bgcolor: primary ? f.accent : "transparent", color: primary ? f.onAccent : tone ?? f.text,
                      border: `1px solid ${primary ? f.accent : f.line}`, opacity: disabled ? 0.45 : 1,
                      "&:focus-visible": { outline: `2px solid ${f.accent}`, outlineOffset: 2 } }}>
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
  const f = useFacilitatorColours();
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
  const panel = { bgcolor: f.raised, border: `1px solid ${f.line}`, borderRadius: "6px", p: 2, display: "flex", flexDirection: "column", gap: 1 } as const;
  const kicker = { fontSize: 12, fontWeight: 600, letterSpacing: "0.1em" } as const;

  return (
    <Dialog fullScreen open={open} onClose={onClose} aria-label="Facilitator mode"
            slotProps={{ paper: { sx: { bgcolor: f.bg, color: f.text, backgroundImage: "none" } } }}
            onKeyDown={(e) => {
              if ((e.target as HTMLElement).tagName === "INPUT") return;
              if (e.key === "ArrowRight") go(idx + 1);
              if (e.key === "ArrowLeft") go(idx - 1);
            }}>
      <Stack direction="row" spacing={3} sx={{ alignItems: "center", px: { xs: 2, md: 5 }, minHeight: 64, borderBottom: `1px solid ${f.line}`, flexShrink: 0, flexWrap: "wrap", py: 1 }}>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 220 }}>
          <Typography sx={{ fontSize: 12, color: f.muted }}>
            Fit-to-Standard workshop · {analysis.template_process ? analysis.template_process.split(" (")[0] : subject.label}{country ? ` — ${country}` : ""}
          </Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Decision {a.position} of {agenda.length}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography component="label" htmlFor="facilitator-name" sx={{ fontSize: 12, color: named ? f.muted : f.amber }}>Deciding as</Typography>
          <Box component="input" id="facilitator-name" value={reviewer} placeholder="Your name"
               onChange={(e: ChangeEvent<HTMLInputElement>) => onReviewer(e.target.value)}
               sx={{ height: 32, width: 160, px: 1.25, fontSize: 13, fontFamily: "inherit", color: f.text, bgcolor: "transparent",
                     border: `1px solid ${f.line}`, borderRadius: "4px", "&::placeholder": { color: f.muted } }} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }} aria-live="polite">
          <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, color: over && ticking ? f.amber : f.text }}>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </Typography>
          <Typography sx={{ fontSize: 12, color: f.muted }}>of {a.minutes} min</Typography>
        </Stack>
        <BandAction onClick={() => setTicking((t) => !t)}>{ticking ? "Pause" : left < a.minutes * 60 ? "Resume" : "Start timer"}</BandAction>
        <BandAction onClick={onClose}>Exit</BandAction>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", gap: { xs: 3, lg: 6 }, px: { xs: 2, md: 6 }, py: 4,
                 gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 440px" }, alignItems: "start" }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Typography sx={{ ...kicker, color: f.accent }}>
            DECISION {String(a.position).padStart(2, "0")} · {a.gap_id} · {a.primary_type} · {a.materiality.toUpperCase()} MATERIALITY
          </Typography>
          <Typography component="h1" sx={{ fontFamily: SERIF, fontSize: { xs: 24, md: 32 }, fontWeight: 500, lineHeight: 1.3 }}>{a.topic}</Typography>
          <Typography sx={{ fontSize: 16, lineHeight: 1.55, color: f.soft }}>{a.why}</Typography>
          <Box role="radiogroup" aria-label="Options" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
            {options.map((o, j) => {
              const on = choice[a.gap_id] === j;
              return (
                <ButtonBase key={j} role="radio" aria-checked={on}
                            onClick={() => setChoice((c) => ({ ...c, [a.gap_id]: j }))}
                            sx={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-start", gap: 1.75, p: 2, minHeight: 88,
                                  textAlign: "left", borderRadius: "6px", bgcolor: on ? f.picked : f.raised,
                                  border: `1px solid ${on ? f.accent : f.line}`,
                                  "&:focus-visible": { outline: `2px solid ${f.accent}`, outlineOffset: 2 } }}>
                  <Box component="span" sx={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center",
                                              justifyContent: "center", fontFamily: MONO, fontSize: 14, fontWeight: 600,
                                              ...(on ? { bgcolor: f.accent, color: f.onAccent } : { border: `1px solid ${f.accent}`, color: f.accent }) }}>
                    {LETTERS[j]}
                  </Box>
                  <Typography sx={{ fontSize: 15, lineHeight: 1.45 }}>{o}</Typography>
                </ButtonBase>
              );
            })}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 13, color: f.muted, mr: 0.5 }}>Decision owners in the room</Typography>
            {a.owner.map((o) => (
              <Box key={o} component="span" sx={{ fontSize: 13, px: 1.25, py: 0.5, border: `1px solid ${f.line}`, borderRadius: "3px" }}>{o}</Box>
            ))}
          </Stack>
          {last && (
            <Typography sx={{ fontSize: 14, color: f.accent }}>
              {VERDICT_LABEL[last.verdict]} by {last.reviewer}{last.comment ? ` — ${last.comment}` : ""}
            </Typography>
          )}
        </Stack>

        {dev && (
          <Stack spacing={1.75}>
            <Box sx={panel}>
              <Typography sx={{ ...kicker, color: f.accent }}>GLOBAL TEMPLATE</Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.5 }}>{dev.gt_statement}</Typography>
              {gt && (
                <>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: f.soft, bgcolor: f.bg, p: 1.25, borderRadius: "3px", overflowWrap: "anywhere" }}>
                    “{gt.quote}”
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: f.muted }}>{gt.doc}</Typography>
                </>
              )}
            </Box>
            <Box sx={panel}>
              <Typography sx={{ ...kicker, color: f.amber }}>{subject.label.toUpperCase()}{dev.as_is_step_id ? ` · ${dev.as_is_step_id}` : ""}</Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.5 }}>{dev.as_is_statement}</Typography>
              {asIs && <Typography sx={{ fontSize: 12, color: f.muted }}>{asIs.doc}</Typography>}
            </Box>
            {dev.impacts.length > 0 && (
              <Box sx={panel}>
                <Typography sx={{ ...kicker, color: f.muted }}>IMPACT IF LEFT AS IT IS</Typography>
                {dev.impacts.map((im) => (
                  <Box key={im.area} title={im.note} sx={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr) 32px", gap: 1.25, alignItems: "center" }}>
                    <Typography sx={{ fontSize: 13 }}>{im.area}</Typography>
                    <Box sx={{ height: 8, bgcolor: f.line }}>
                      <Box sx={{ height: 8, width: `${im.score * 20}%`, bgcolor: im.score >= 4 ? f.amber : f.accent }} />
                    </Box>
                    <Typography sx={{ fontFamily: MONO, fontSize: 12, color: f.soft, textAlign: "right" }}>{im.score}/5</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Box>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ borderTop: `1px solid ${f.line}`, px: { xs: 2, md: 6 }, py: 2, flexShrink: 0, alignItems: { md: "center" } }}>
        <Box component="nav" aria-label="Agenda" sx={{ display: "flex", gap: 0.75, flex: 1, minWidth: 0 }}>
          {agenda.map((s, i) => {
            const on = i === idx;
            const done = !!latest(decisions[s.gap_id]);
            return (
              <ButtonBase key={s.gap_id} onClick={() => go(i)} aria-current={on ? "step" : undefined}
                          title={`${s.gap_id} · ${s.minutes} min${done ? " · decided" : ""}`}
                          sx={{ flex: `${s.minutes} 1 0`, minWidth: 0, height: 44, flexDirection: "column", alignItems: "flex-start", justifyContent: "center",
                                px: 1.25, borderRadius: "4px", overflow: "hidden",
                                ...(on ? { bgcolor: f.accent, color: f.onAccent, border: `1px solid ${f.accent}` }
                                  : done ? { bgcolor: f.picked, color: f.text, border: `1px solid ${f.line}` }
                                    : { color: f.soft, border: `1px solid ${f.line}` }) }}>
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
              <BandAction disabled={!named || busy} tone={f.amber} onClick={() => record("defer")}>Defer</BandAction>
              <BandAction disabled={!named || busy} onClick={() => record("reject")}>Reject</BandAction>
            </>
          )}
          <BandAction onClick={() => go(idx + 1)} disabled={idx === agenda.length - 1}>Next decision</BandAction>
        </Stack>
      </Stack>
    </Dialog>
  );
}
