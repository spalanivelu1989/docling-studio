/** Facilitator mode — design W2: one decision at a time, full screen, for the
 *  screen shared in the workshop room. The question set large, the options as
 *  cards to point at, both sides of the difference beside it, and the agenda
 *  along the bottom with the time each item was given.
 *
 *  Answers given here are drafts until the room reaches the end and presses
 *  Submit, which saves the whole sitting to the workshop record in one go --
 *  so a mis-click mid-workshop is corrected by going back, not by a second
 *  row in the permanent record. */
import { alpha, Box, ButtonBase, Dialog, Stack, Typography, useTheme } from "@mui/material";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import type { RolloutAnalysis, RolloutDecision, RolloutScores, RolloutSubject } from "../../api";
import { VERDICT_LABEL, latest, needsRationale, type Verdict } from "./decision";
import OutcomeDownloads from "./OutcomeDownloads";
import { MONO, SERIF, usePremium } from "./premium";

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

/** One answer given in the room, not yet saved. */
export interface WorkshopDraft { verdict?: Verdict; option?: number; rationale: string }

const EMPTY: WorkshopDraft = { rationale: "" };

/** Why an answer cannot be submitted yet, or null when it can. */
export function draftProblem(d: WorkshopDraft | undefined): string | null {
  if (!d?.verdict) return "Not answered";
  if (needsRationale(d.verdict) && !d.rationale.trim()) return "Needs a rationale";
  return null;
}

export default function FacilitatorView({
  open, start, onClose, analysis, scores, subject, country, decisions, reviewer, onReviewer, attendees, onAttendees,
  drafts, onDraft, onSubmit, runId,
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
  /** Who is in the room, comma-separated; saved with the sitting. */
  attendees: string;
  onAttendees: (names: string) => void;
  drafts: Record<string, WorkshopDraft>;
  onDraft: (gapId: string, draft: WorkshopDraft) => void;
  /** Saves every draft; resolves to how many were saved and the session. Absent when read-only. */
  onSubmit?: () => Promise<{ saved: number; session: string }>;
  runId?: string | null;
}) {
  const f = useFacilitatorColours();
  const agenda = scores.agenda;
  const [idx, setIdx] = useState(start);
  const [left, setLeft] = useState(0);
  const [ticking, setTicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  // What was submitted, for the confirmation: the page clears its drafts once saved.
  const [sent, setSent] = useState<Record<string, WorkshopDraft> | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => { if (open) { setIdx(start); setSaved(null); setSent(null); setSubmitError(""); } }, [open, start]);
  // One past the last decision is the review screen, where Submit lives.
  const reviewing = idx >= agenda.length;
  const a = reviewing ? undefined : agenda[idx];
  // A new item gets its own allotment; the clock never carries over.
  useEffect(() => { setTicking(false); if (a) setLeft(a.minutes * 60); }, [a]);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!agenda.length) return null;
  const named = !!reviewer.trim();
  const go = (i: number) => setIdx(Math.max(0, Math.min(agenda.length, i)));
  const draft = a ? drafts[a.gap_id] ?? EMPTY : EMPTY;
  const edit = (patch: Partial<WorkshopDraft>) => a && onDraft(a.gap_id, { ...draft, ...patch });
  // Choosing a verdict moves on: the room answers, the screen turns the page.
  const answer = (v: Verdict) => { edit({ verdict: v }); go(idx + 1); };
  const shown = saved !== null && sent ? sent : drafts;
  const problems = agenda.map((s) => draftProblem(shown[s.gap_id]));
  const open_ = problems.filter(Boolean).length;
  const ready = named && open_ === 0 && !submitting && saved === null;

  async function submit() {
    if (!onSubmit || !ready) return;
    setSubmitting(true); setSubmitError("");
    const snapshot = drafts;
    try {
      const out = await onSubmit();
      setSent(snapshot);
      setSessionId(out.session);
      setSaved(out.saved);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const panel = { bgcolor: f.raised, border: `1px solid ${f.line}`, borderRadius: "6px", p: 2, display: "flex", flexDirection: "column", gap: 1 } as const;
  const kicker = { fontSize: 12, fontWeight: 600, letterSpacing: "0.1em" } as const;
  const field = { height: 32, px: 1.25, fontSize: 13, fontFamily: "inherit", color: f.text, bgcolor: "transparent",
                  border: `1px solid ${f.line}`, borderRadius: "4px", "&::placeholder": { color: f.muted } } as const;
  const summary = (d: WorkshopDraft | undefined, options: string[]) => !d?.verdict ? "" :
    `${VERDICT_LABEL[d.verdict]}${d.option !== undefined && options[d.option] ? ` · option ${LETTERS[d.option]}: ${options[d.option]}` : ""}`;

  return (
    <Dialog fullScreen open={open} onClose={onClose} aria-label="Facilitator mode"
            slotProps={{ paper: { sx: { bgcolor: f.bg, color: f.text, backgroundImage: "none" } } }}
            onKeyDown={(e) => {
              if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
              if (e.key === "ArrowRight") go(idx + 1);
              if (e.key === "ArrowLeft") go(idx - 1);
            }}>
      <Stack direction="row" spacing={3} sx={{ alignItems: "center", px: { xs: 2, md: 5 }, minHeight: 64, borderBottom: `1px solid ${f.line}`, flexShrink: 0, flexWrap: "wrap", py: 1 }}>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 220 }}>
          <Typography sx={{ fontSize: 12, color: f.muted }}>
            Fit-to-Standard workshop · {analysis.template_process ? analysis.template_process.split(" (")[0] : subject.label}{country ? ` — ${country}` : ""}
          </Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
            {a ? `Decision ${a.position} of ${agenda.length}` : "Review and submit"}
            <Box component="span" sx={{ fontWeight: 400, color: f.muted, ml: 1.5, fontSize: 13 }}>
              {saved !== null ? `${saved} saved` : `${agenda.length - open_} of ${agenda.length} answered`}
            </Box>
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography component="label" htmlFor="facilitator-name" sx={{ fontSize: 12, color: named ? f.muted : f.amber }}>Facilitator</Typography>
          <Box component="input" id="facilitator-name" value={reviewer} placeholder="Your name"
               onChange={(e: ChangeEvent<HTMLInputElement>) => onReviewer(e.target.value)} sx={{ ...field, width: 160 }} />
          <Typography component="label" htmlFor="facilitator-attendees" sx={{ fontSize: 12, color: f.muted }}>In the room</Typography>
          <Box component="input" id="facilitator-attendees" value={attendees} placeholder="Names, comma-separated"
               title="Saved with this sitting's decisions"
               onChange={(e: ChangeEvent<HTMLInputElement>) => onAttendees(e.target.value)} sx={{ ...field, width: 220 }} />
        </Stack>
        {a && (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }} aria-live="polite">
              <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, color: left === 0 && ticking ? f.amber : f.text }}>
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
              </Typography>
              <Typography sx={{ fontSize: 12, color: f.muted }}>of {a.minutes} min</Typography>
            </Stack>
            <BandAction onClick={() => setTicking((t) => !t)}>{ticking ? "Pause" : left < a.minutes * 60 ? "Resume" : "Start timer"}</BandAction>
          </>
        )}
        <BandAction onClick={onClose}>Exit</BandAction>
      </Stack>

      {/* Called, not mounted: a component declared in here would remount on
          every keystroke and take the focus out of the rationale box. */}
      {a ? question() : review()}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ borderTop: `1px solid ${f.line}`, px: { xs: 2, md: 6 }, py: 2, flexShrink: 0, alignItems: { md: "center" } }}>
        <Box component="nav" aria-label="Agenda" sx={{ display: "flex", gap: 0.75, flex: 1, minWidth: 0 }}>
          {agenda.map((s, i) => {
            const on = i === idx;
            const done = !problems[i];
            return (
              <ButtonBase key={s.gap_id} onClick={() => go(i)} aria-current={on ? "step" : undefined} disabled={saved !== null}
                          title={`${s.gap_id} · ${s.minutes} min${done ? " · answered" : ""}`}
                          sx={{ flex: `${s.minutes} 1 0`, minWidth: 0, height: 44, flexDirection: "column", alignItems: "flex-start", justifyContent: "center",
                                px: 1.25, borderRadius: "4px", overflow: "hidden",
                                ...(on ? { bgcolor: f.accent, color: f.onAccent, border: `1px solid ${f.accent}` }
                                  : done ? { bgcolor: f.picked, color: f.text, border: `1px solid ${f.line}` }
                                    : { color: f.soft, border: `1px solid ${f.line}` }) }}>
                <Typography noWrap sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, maxWidth: "100%" }}>{s.gap_id}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: 11.5, opacity: 0.75 }}>{done ? "answered" : `${s.minutes}′`}</Typography>
              </ButtonBase>
            );
          })}
          <ButtonBase onClick={() => go(agenda.length)} aria-current={reviewing ? "step" : undefined}
                      sx={{ flex: "0 0 auto", height: 44, px: 1.75, borderRadius: "4px", fontSize: 13, fontWeight: 600,
                            ...(reviewing ? { bgcolor: f.accent, color: f.onAccent, border: `1px solid ${f.accent}` }
                              : { color: f.accent, border: `1px solid ${f.accent}` }) }}>
            Review
          </ButtonBase>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <BandAction onClick={() => go(idx - 1)} disabled={idx === 0 || saved !== null}>Previous</BandAction>
          {a && onSubmit && (
            <>
              <BandAction primary onClick={() => answer("accept")}>
                {draft.option === undefined ? "Accept" : `Accept option ${LETTERS[draft.option]}`}
              </BandAction>
              <BandAction disabled={!draft.rationale.trim()} tone={f.amber} onClick={() => answer("defer")}>Defer</BandAction>
              <BandAction disabled={!draft.rationale.trim()} onClick={() => answer("reject")}>Reject</BandAction>
            </>
          )}
          {a ? (
            <BandAction onClick={() => go(idx + 1)}>{idx === agenda.length - 1 ? "Review answers" : "Next decision"}</BandAction>
          ) : onSubmit && saved === null ? (
            <BandAction primary disabled={!ready} onClick={() => void submit()}>
              {submitting ? "Submitting…" : `Submit ${agenda.length} decisions`}
            </BandAction>
          ) : (
            <BandAction primary onClick={onClose}>Exit workshop</BandAction>
          )}
        </Stack>
      </Stack>
    </Dialog>
  );

  function question() {
    const item = a!;
    const dev = analysis.deviations.find((d) => d.gap_id === item.gap_id);
    const options = item.options.length ? item.options : dev?.decision_options ?? [];
    const gt = dev?.evidence.find((e) => e.side === "template");
    const asIs = dev?.evidence.find((e) => e.side !== "template");
    const last = latest(decisions[item.gap_id]);
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", gap: { xs: 3, lg: 6 }, px: { xs: 2, md: 6 }, py: 4,
                 gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 440px" }, alignItems: "start" }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Typography sx={{ ...kicker, color: f.accent }}>
            DECISION {String(item.position).padStart(2, "0")} · {item.gap_id} · {item.primary_type} · {item.materiality.toUpperCase()} MATERIALITY
          </Typography>
          <Typography component="h1" sx={{ fontFamily: SERIF, fontSize: { xs: 24, md: 32 }, fontWeight: 500, lineHeight: 1.3 }}>{item.topic}</Typography>
          <Typography sx={{ fontSize: 16, lineHeight: 1.55, color: f.soft }}>{item.why}</Typography>
          <Box role="radiogroup" aria-label="Options" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
            {options.map((o, j) => {
              const on = draft.option === j;
              return (
                <ButtonBase key={j} role="radio" aria-checked={on}
                            onClick={() => edit({ option: on ? undefined : j })}
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
            {item.owner.map((o) => (
              <Box key={o} component="span" sx={{ fontSize: 13, px: 1.25, py: 0.5, border: `1px solid ${f.line}`, borderRadius: "3px" }}>{o}</Box>
            ))}
          </Stack>
          {onSubmit && (
            <Stack spacing={0.75}>
              <Typography component="label" htmlFor="facilitator-rationale" sx={{ fontSize: 13, color: f.muted }}>
                Rationale — why the room decided this (needed to defer or reject)
              </Typography>
              <Box component="textarea" id="facilitator-rationale" rows={2} maxLength={2000} value={draft.rationale}
                   onChange={(e: ChangeEvent<HTMLTextAreaElement>) => edit({ rationale: e.target.value })}
                   sx={{ width: "100%", p: 1.25, fontSize: 14, lineHeight: 1.5, fontFamily: "inherit", color: f.text, bgcolor: f.raised,
                         border: `1px solid ${f.line}`, borderRadius: "4px", resize: "vertical" }} />
            </Stack>
          )}
          {draft.verdict && (
            <Typography sx={{ fontSize: 14, color: f.accent }}>
              This sitting: {summary(draft, options)} — not saved until you submit
            </Typography>
          )}
          {last && (
            <Typography sx={{ fontSize: 13, color: f.muted }}>
              Already on record: {VERDICT_LABEL[last.verdict]} by {last.reviewer}{last.comment ? ` — ${last.comment}` : ""}
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
    );
  }

  function review() {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: { xs: 2, md: 6 }, py: 4 }}>
        <Stack spacing={2} sx={{ maxWidth: 1100 }}>
          <Typography component="h1" sx={{ fontFamily: SERIF, fontSize: { xs: 24, md: 30 }, fontWeight: 500 }}>
            {saved !== null ? "All responses are saved" : "Review the room's answers"}
          </Typography>
          <Typography sx={{ fontSize: 15, color: f.soft, lineHeight: 1.55 }}>
            {saved !== null
              ? `All ${saved} responses are saved. You may now exit the workshop window.`
              : open_ > 0
                ? `${open_} of ${agenda.length} still need an answer. Select one to go back to it.`
                : !named ? "Name the facilitator above, then submit."
                  : "Everything has an answer. Submit saves them all together; until then nothing is recorded."}
          </Typography>
          {saved !== null && runId && sessionId && <OutcomeDownloads runId={runId} session={sessionId} variant="buttons" />}
          {submitError && (
            <Typography role="alert" sx={{ fontSize: 14, color: f.amber }}>Not saved: {submitError}</Typography>
          )}
          <Box sx={{ border: `1px solid ${f.line}`, borderRadius: "6px", overflow: "hidden" }}>
            {agenda.map((s, i) => {
              const d = shown[s.gap_id];
              const dev = analysis.deviations.find((x) => x.gap_id === s.gap_id);
              const options = s.options.length ? s.options : dev?.decision_options ?? [];
              const problem = problems[i];
              return (
                <ButtonBase key={s.gap_id} onClick={() => go(i)} disabled={saved !== null}
                            sx={{ width: "100%", display: "grid", gridTemplateColumns: { xs: "1fr", md: "150px minmax(0, 1fr) minmax(0, 1fr)" },
                                  gap: { xs: 0.5, md: 2 }, p: 1.75, textAlign: "left", alignItems: "start",
                                  borderTop: i ? `1px solid ${f.line}` : "none", bgcolor: problem ? "transparent" : f.raised }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: f.accent }}>{s.gap_id}</Typography>
                  <Typography sx={{ fontSize: 14, lineHeight: 1.45 }}>{s.topic}</Typography>
                  <Box>
                    {problem ? (
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: f.amber }}>{problem}</Typography>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{summary(d, options)}</Typography>
                        {d?.rationale.trim() && <Typography sx={{ fontSize: 13, color: f.soft, lineHeight: 1.45 }}>{d.rationale.trim()}</Typography>}
                      </>
                    )}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
        </Stack>
      </Box>
    );
  }
}
