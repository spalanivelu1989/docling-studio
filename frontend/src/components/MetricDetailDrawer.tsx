/** One metric, opened up — what it asked, what it found, and how it counted.
 *
 *  A score of 0.00 tells you an answer is ungrounded. It does not tell you
 *  which claim was invented, and that is the only part anyone can act on. This
 *  drawer carries the judge's own working: the claims it decomposed the answer
 *  into and its verdict on each, the excerpt-by-excerpt reasoning behind a
 *  retrieval score, the questions it reverse-engineered from the answer.
 *
 *  Ragas throws all of that away -- its result object carries the number and
 *  nothing else -- so `evaluation.py` intercepts it at the judge LLM and
 *  normalises it into four shapes. This file draws those four shapes and knows
 *  nothing about Ragas.
 *
 *  It opens beside the page rather than over it, and the metric is switched
 *  from inside the drawer rather than by closing it, which is the pattern the
 *  Ask RAG history viewer set and the three run-history panels follow.
 */
import {
  Alert, Box, Chip, Divider, Drawer, IconButton, Stack, Tooltip, Typography,
  alpha, useTheme,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { Check, Minus, Quote, X } from "lucide-react";
import type { ReactNode } from "react";

import type { AskEvaluation, MetricScore, MetricWorking } from "../api";

function band(theme: Theme, value: number) {
  return value >= 0.7 ? theme.palette.success.main
    : value >= 0.4 ? theme.palette.warning.main
      : theme.palette.error.main;
}

/** What the judge was asked to do, in enough detail to argue with the answer.
 *  Longer than the tooltip on the tile, because there is room here. */
const METHOD: Record<string, string> = {
  faithfulness:
    "The answer is broken into individual claims, and each claim is checked "
    + "against the retrieved excerpts on its own. The score is the share of "
    + "claims the excerpts support. A claim the excerpts neither support nor "
    + "contradict still counts against it: the question is whether this corpus "
    + "backs the answer, not whether the answer is true in general.",
  answer_relevancy:
    "The judge reads the answer and writes the questions it would be a good "
    + "answer to. Those are embedded with the same model the corpus is "
    + "indexed with, and compared to the question actually asked. A low score "
    + "means the answer drifted — it may still be correct about something else.",
  context_precision:
    "Each retrieved excerpt is judged separately: was it useful in arriving at "
    + "this answer? The score weights those verdicts by rank, so a useful "
    + "excerpt ranked eighth is worth less than one ranked first. It measures "
    + "the ordering, not just the selection.",
  context_relevance:
    "Two independent judges, with different prompts, each rate the whole "
    + "retrieved set against the question: 0 not relevant, 1 partly, 2 "
    + "relevant. The score is the mean of the two, halved. It says nothing "
    + "about the answer, so it isolates retrieval from generation.",
  context_utilization:
    "The same per-excerpt judgement as context precision, but asking what the "
    + "answer actually drew on rather than what was relevant. High precision "
    + "with low utilization means good material was retrieved and ignored.",
  coherence:
    "A rubric judge: whether the answer follows one line, whether its parts "
    + "agree with each other, and whether a reader could follow it once.",
  conciseness:
    "A rubric judge: whether everything the answer says is doing work. It is "
    + "told not to reward brevity that leaves the question half-answered.",
  context_recall:
    "Whether the retrieval found everything a known-correct answer needed. "
    + "Needs a reference answer, so it is measured over the evaluation set and "
    + "never on a live question.",
  correctness:
    "The answer compared against a known-correct one, by claim overlap and by "
    + "semantic similarity. Needs a reference answer, so it is measured over "
    + "the evaluation set and never on a live question.",
  harmfulness:
    "Whether the content would be a problem even if every word of it were "
    + "true. Factual accuracy is explicitly not its concern — that is measured "
    + "four times over by the judges above, and an earlier version of this "
    + "rubric that asked about consequences simply flagged every hallucination.",
  maliciousness:
    "Whether the answer looks designed to deceive or manipulate. Intent, not "
    + "accuracy: an answer that is confidently wrong is mistaken, not malicious.",
  toxicity: "Whether the answer contains abusive language aimed at a person or group.",
  bias: "Whether the answer generalises without grounds, or presents a contested matter as settled.",
};

const TITLES: Record<string, string> = {
  faithfulness: "Faithfulness",
  answer_relevancy: "Answer relevancy",
  context_precision: "Context precision",
  context_relevance: "Context relevance",
  context_utilization: "Context utilization",
  coherence: "Coherence",
  conciseness: "Conciseness",
  context_recall: "Context recall",
  correctness: "Correctness",
  harmfulness: "Harmfulness",
  maliciousness: "Maliciousness",
  toxicity: "Toxicity",
  bias: "Bias",
};

/** A verdict line: a tick or a cross, the thing judged, and why. */
function Verdict({ ok, text, reason, lead }: {
  ok: boolean; text: string; reason?: string; lead?: string;
}) {
  const theme = useTheme();
  const colour = ok ? theme.palette.success.main : theme.palette.error.main;
  return (
    <Stack direction="row" spacing={1.25} sx={{ py: 1.1 }}>
      <Box sx={{
        flexShrink: 0, width: 20, height: 20, borderRadius: "50%", mt: 0.1,
        display: "grid", placeItems: "center",
        bgcolor: alpha(colour, 0.16), color: colour,
      }}>
        {ok ? <Check size={12} /> : <X size={12} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {lead && (
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "text.disabled",
                            textTransform: "uppercase", letterSpacing: ".06em" }}>
            {lead}
          </Typography>
        )}
        <Typography sx={{ fontSize: 13, lineHeight: 1.5 }}>{text}</Typography>
        {reason && (
          <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: "text.secondary", mt: 0.4 }}>
            {reason}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/** The judge's working, whichever of the four shapes it came back in. */
function Working({ working, sources }: {
  working?: MetricWorking; sources?: { n: number; title: string }[];
}) {
  const theme = useTheme();
  const kind = (working as { kind?: string } | undefined)?.kind;
  if (!kind) return null;
  const items = (working as { items: unknown[] }).items || [];

  if (kind === "claims") {
    const claims = items as { text: string; supported: boolean; reason: string }[];
    const held = claims.filter((c) => c.supported).length;
    return (
      <Section
        title="Every claim, checked separately"
        meta={`${held} of ${claims.length} supported by the excerpts`}
      >
        {claims.map((c, i) => (
          <Verdict key={i} ok={c.supported} text={c.text} reason={c.reason} />
        ))}
      </Section>
    );
  }

  if (kind === "excerpts") {
    const rows = items as { n: number | null; useful: boolean; reason: string }[];
    const used = rows.filter((r) => r.useful).length;
    const title = (n: number | null) =>
      sources?.find((s) => s.n === n)?.title;
    return (
      <Section title="Excerpt by excerpt" meta={`${used} of ${rows.length} counted as useful`}>
        {rows.map((r, i) => (
          <Verdict
            key={i}
            ok={r.useful}
            lead={r.n ? `Excerpt ${r.n}${title(r.n) ? ` · ${title(r.n)}` : ""}`
              : "Excerpt not identified"}
            text={r.reason}
          />
        ))}
      </Section>
    );
  }

  if (kind === "questions") {
    const rows = items as { text: string; noncommittal: boolean }[];
    return (
      <Section
        title="The questions this answer would fit"
        meta="Written by the judge from the answer alone, then compared to what was actually asked"
      >
        {rows.map((q, i) => (
          <Stack key={i} direction="row" spacing={1.25} sx={{ py: 1 }}>
            <Box sx={{ flexShrink: 0, color: "text.disabled", mt: 0.3 }}>
              <Quote size={13} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, lineHeight: 1.5, fontStyle: "italic" }}>
                {q.text}
              </Typography>
              {q.noncommittal && (
                <Typography sx={{ fontSize: 12, color: "warning.main", mt: 0.3 }}>
                  The judge read this as evasive, which drags the score down on its own.
                </Typography>
              )}
            </Box>
          </Stack>
        ))}
      </Section>
    );
  }

  if (kind === "ratings") {
    const rows = items as { judge: number; rating: number | null; of: number; label: string }[];
    return (
      <Section
        title="Two judges, one rating each"
        meta="Different prompts over the whole retrieved set; the score is their mean, halved"
      >
        {rows.map((r, i) => {
          const share = r.rating === null ? 0 : r.rating / (r.of || 2);
          const colour = band(theme, share);
          return (
            <Stack key={i} direction="row" spacing={1.5}
                   sx={{ py: 1, alignItems: "center" }}>
              <Typography sx={{ fontSize: 12, color: "text.secondary", minWidth: 62 }}>
                Judge {r.judge}
              </Typography>
              <Box sx={{
                px: 0.8, py: 0.2, borderRadius: 0.75, fontSize: 12, fontWeight: 800,
                bgcolor: alpha(colour, 0.14), color: colour,
                fontVariantNumeric: "tabular-nums",
              }}>
                {r.rating ?? "—"} / {r.of}
              </Box>
              <Typography sx={{ fontSize: 13 }}>{r.label}</Typography>
            </Stack>
          );
        })}
      </Section>
    );
  }
  return null;
}

function Section({ title, meta, children }: {
  title: string; meta?: string; children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
        {title}
      </Typography>
      {meta && (
        <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.5 }}>
          {meta}
        </Typography>
      )}
      <Divider sx={{ my: 1 }} />
      {children}
    </Box>
  );
}

export default function MetricDetailDrawer({
  open, metric, evaluation, sources, onClose, onPick, available, context, footer,
}: {
  open: boolean;
  /** Which metric is showing. */
  metric: string;
  evaluation: AskEvaluation | null;
  /** So an excerpt verdict can name the document it was about. */
  sources?: { n: number; title: string }[];
  onClose: () => void;
  onPick: (name: string) => void;
  /** Every metric the scorecard is showing, in its order, for the switcher. */
  available: string[];
  /** Under the title: which answer this is. The Ask page needs none -- the
   *  answer is on screen beside it -- but the quality dashboard does. */
  context?: ReactNode;
  /** After the working: the dashboard puts a reviewer's verdict here. */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const score: MetricScore | undefined = evaluation?.metrics?.[metric];
  const value = score?.value ?? null;
  const colour = value === null ? theme.palette.text.disabled : band(theme, value);
  const weight = evaluation?.terms?.weights?.[metric];
  const overall = evaluation?.overall ?? null;
  const weightTotal = Object.values(evaluation?.terms?.weights || {})
    .reduce((a, b) => a + b, 0);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" } },
        paper: {
          sx: {
            width: { xs: "100%", sm: 520, md: 580 },
            display: "flex",
            flexDirection: "column",
          },
        },
      }}
    >
      <Box sx={{ p: 2.5, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
              Quality metric
            </Typography>
            <Typography sx={{ fontSize: 19, fontWeight: 700, mt: 0.25 }}>
              {TITLES[metric] || metric}
            </Typography>
          </Box>
          <Typography sx={{
            fontSize: 34, fontWeight: 800, lineHeight: 1, color: colour,
            fontVariantNumeric: "tabular-nums",
          }}>
            {value === null ? "—" : value.toFixed(2)}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close metric detail">
            <X size={16} />
          </IconButton>
        </Stack>

        {context && <Box sx={{ mt: 1.25 }}>{context}</Box>}

        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1.5 }}>
          {available.map((name) => (
            <Chip
              key={name}
              size="small"
              label={TITLES[name] || name}
              variant={name === metric ? "filled" : "outlined"}
              color={name === metric ? "primary" : "default"}
              onClick={() => onPick(name)}
              sx={{ height: 22, fontSize: 10.5, fontWeight: 600, borderRadius: 1 }}
            />
          ))}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
        <Stack spacing={2.5}>
          {score?.error && (
            <Alert severity="warning" variant="outlined">
              This judge did not return: {score.error}
            </Alert>
          )}
          {value === null && !score?.error && (
            <Alert severity="info" variant="outlined">
              Not measured here. This metric needs a known-correct answer to
              compare against, and a live question has none — it is scored over
              the evaluation set instead.
            </Alert>
          )}

          <Section title="How it is measured">
            <Typography sx={{ fontSize: 13, lineHeight: 1.65 }}>
              {METHOD[metric] || "No description recorded for this metric."}
            </Typography>
          </Section>

          {score?.reason && (
            <Section title="The judge's reasoning">
              <Typography sx={{ fontSize: 13, lineHeight: 1.65, fontStyle: "italic" }}>
                “{score.reason}”
              </Typography>
            </Section>
          )}

          <Working working={score?.working} sources={sources} />

          <Section title="What it contributes">
            {weight === undefined ? (
              <Stack direction="row" spacing={1.25} sx={{ py: 0.5, alignItems: "center" }}>
                <Box sx={{ color: "text.disabled" }}><Minus size={14} /></Box>
                <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                  Not part of the overall score
                  {score && value === null
                    ? " — it did not return, so the other judges' weights were "
                      + "renormalised rather than counting this as zero."
                    : metric === "harmfulness" || metric === "maliciousness"
                      || metric === "toxicity" || metric === "bias"
                      ? ". Safety judges gate the overall score rather than "
                        + "feeding into it: one flag caps the total."
                      : "."}
                </Typography>
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, lineHeight: 1.65 }}>
                Weighted <b>{weight.toFixed(2)}</b> of {weightTotal.toFixed(2)}
                {value !== null && (
                  <> — contributing <b>{((weight * value) / (weightTotal || 1)).toFixed(3)}</b>{" "}
                    to the overall score of {overall?.toFixed(2) ?? "—"}.</>
                )}
              </Typography>
            )}
          </Section>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            {evaluation?.judge_model && (
              <Tooltip title="The model that judged this answer">
                <Chip size="small" variant="outlined" label={evaluation.judge_model}
                      sx={{ height: 22, fontSize: 10.5 }} />
              </Tooltip>
            )}
            {score?.seconds !== undefined && (
              <Chip size="small" variant="outlined" label={`${score.seconds}s`}
                    sx={{ height: 22, fontSize: 10.5 }} />
            )}
            {evaluation?.ragas_version && (
              <Chip size="small" variant="outlined" label={`ragas ${evaluation.ragas_version}`}
                    sx={{ height: 22, fontSize: 10.5 }} />
            )}
          </Stack>

          {footer}
        </Stack>
      </Box>
    </Drawer>
  );
}
