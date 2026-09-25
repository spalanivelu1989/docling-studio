/** How good was that answer? — the Ragas judges, read back onto the Ask page,
 *  as an evaluation table: one row per judge with its score, a bullet bar
 *  against the threshold, a result word and what the judge actually found.
 *  The same analytical-list idiom as the RAG Metrics page, so an answer reads
 *  the same here as it does there.
 *
 *  The panel sits between the answer and the sources, which is the order it is
 *  meant to be read in: here is the answer, here is how well it holds up, here
 *  is what it was built from.
 *
 *  Three rules run through the whole of it, and each one exists because the
 *  opposite would quietly mislead:
 *
 *  1. A missing score is NOT a zero. A judge that timed out, and a judge that
 *     found nothing to like, are opposite facts, and the difference between
 *     them is the difference between "our scoring broke" and "this answer is
 *     bad". Anything null renders as an em-dash with a reason, never as 0.00.
 *
 *  2. Correctness and Context Recall are listed, greyed, even though a live
 *     question can never score them. Leaving them out would let a reader
 *     believe the rows on screen are the whole of what can be known; listing
 *     them as "needs a reference answer" says where the rest lives.
 *
 *  3. The overall number carries its arithmetic in a tooltip — the weights
 *     used, the judges dropped, the cap if one applied. A single headline
 *     figure that cannot be taken apart is a figure nobody can argue with,
 *     and one nobody will trust twice.
 */
import {
  Alert, Box, Button, CircularProgress, Paper, Stack, Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import type { Theme } from "@mui/material/styles";
import { useState } from "react";

import type { AskEvaluation, EvaluationStatus, MetricScore } from "../api";
import MetricDetailDrawer from "./MetricDetailDrawer";
import { Bullet, statusOf } from "./quality/charts";
import { finding } from "./quality/findings";

/** The bands every score widget in this app already uses (ConfidenceMeter in
 *  FitGapPage, ScoreChip in EvidencePage). Kept identical so that 0.72 means
 *  the same shade of the same thing wherever it appears, and read off the
 *  palette rather than written as hexes so the dark theme stays Frappe. */
function band(theme: Theme, value: number) {
  return value >= 0.7 ? theme.palette.success.main
    : value >= 0.4 ? theme.palette.warning.main
      : theme.palette.error.main;
}

/** What each judge is actually asking. Shown on hover, because "context
 *  utilization 0.62" is not a sentence anyone can act on without it. */
const EXPLAINS: Record<string, string> = {
  faithfulness:
    "Every claim in the answer, checked against the excerpts. 1.0 means nothing "
    + "was asserted that the excerpts do not support. This is the hallucination "
    + "detector, and it carries the most weight in the overall score.",
  answer_relevancy:
    "Whether the answer is an answer to the question that was asked. The judge "
    + "invents the questions this answer would fit and measures how close they "
    + "sit to the real one, in the corpus's own embedding space.",
  context_precision:
    "Whether the excerpts that mattered were ranked near the top. A low score "
    + "with a good answer means retrieval got lucky rather than got it right.",
  context_relevance:
    "Whether the retrieved excerpts bear on the question at all. Independent of "
    + "what the answer says, so it isolates retrieval from generation.",
  context_utilization:
    "How much of what was retrieved the answer actually used. Low here with "
    + "high precision means the model ignored good material.",
  coherence: "Whether the answer follows one line and its parts agree.",
  conciseness: "Whether everything the answer says is doing work.",
  context_recall:
    "Whether retrieval found everything the reference answer needed. Needs a "
    + "reference, so it is measured on the evaluation set, never on live questions.",
  correctness:
    "The answer against a known-correct one. Needs a reference, so it is "
    + "measured on the evaluation set, never on live questions.",
  harmfulness: "Content that would be a problem even if it were true.",
  maliciousness: "Content that looks designed to deceive or manipulate.",
  toxicity: "Abusive language aimed at a person or group.",
  bias: "Unfounded generalisation, or one side of a contested matter as fact.",
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
};


const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RADIUS = "4px";
/** The threshold every score is read against; the same line the RAG Metrics
 *  page draws, from the same bands as `band`. */
const LINE = 0.7;
const GRID = "180px 60px 150px 116px minmax(0, 1fr) 56px";

/** One judge, as a table row. The whole row opens the judge's working. */
function Row({ name, metric, weight, absent, onOpen }: {
  name: string; metric?: MetricScore; weight?: number; absent?: boolean; onOpen?: () => void;
}) {
  const theme = useTheme();
  const value = metric?.value ?? null;
  const st = statusOf(value);
  const colour = value === null ? theme.palette.text.disabled : band(theme, value);
  const result = value === null ? null : value >= LINE ? "Pass" : "Below";
  return (
    <Box
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        display: "grid", gridTemplateColumns: GRID, columnGap: 2, alignItems: "center",
        px: 2, minHeight: 38, borderBottom: 1, borderColor: "divider",
        cursor: onOpen ? "pointer" : "default", color: absent ? "text.secondary" : "text.primary",
        "&:hover": onOpen ? { bgcolor: "action.hover" } : undefined,
        "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      }}
    >
      <Tooltip placement="top-start" title={
        <Box sx={{ py: 0.5, maxWidth: 320, fontSize: 11.5 }}>
          {EXPLAINS[name] || name}
          {metric?.reason && <Box sx={{ mt: 0.6, opacity: 0.85, fontStyle: "italic" }}>“{metric.reason}”</Box>}
        </Box>
      }>
        <Typography component="span" sx={{ fontSize: 13, color: absent ? "text.secondary" : "primary.main", width: "fit-content" }}>
          {TITLES[name] || name}
        </Typography>
      </Tooltip>
      <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, textAlign: "right" }}>
        {value === null ? "—" : value.toFixed(2)}
      </Typography>
      {value === null ? (
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>—</Typography>
      ) : (
        <Bullet value={value} line={LINE} width={140} />
      )}
      {value === null ? (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
          {absent ? "Needs reference" : "Not assessable"}
        </Typography>
      ) : (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", color: colour, fontSize: 12.5, fontWeight: 500 }}>
          <Box sx={{ width: 8, height: 8, bgcolor: colour, borderRadius: st.key === "pass" ? "50%" : 0 }} />
          <span>{result}</span>
        </Stack>
      )}
      <Typography sx={{ fontSize: 12.5, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {absent ? "Measured on the evaluation set, against a known-correct answer." : finding(name, metric)}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", textAlign: "right" }}>
        {weight === undefined ? "—" : weight.toFixed(2)}
      </Typography>
    </Box>
  );
}

/** The headline number, with the whole of its arithmetic one hover away. */
function Overall({ value, terms }: { value: number; terms: AskEvaluation["terms"] }) {
  const theme = useTheme();
  const colour = band(theme, value);
  const weights = Object.entries(terms?.weights || {});
  return (
    <Tooltip
      title={
        <Box sx={{ py: 0.5, maxWidth: 340 }}>
          <Box sx={{ fontSize: 11.5, mb: 0.6 }}>
            A weighted mean of the judges that returned:
          </Box>
          {weights.map(([name, weight]) => (
            <Box key={name} sx={{ fontSize: 11.5, mb: 0.25 }}>
              <b style={{ fontFamily: "ui-monospace, monospace" }}>
                ×{weight.toFixed(2)}
              </b>{" "}
              {TITLES[name] || name}
            </Box>
          ))}
          {!weights.length && <Box sx={{ fontSize: 11.5 }}>no weights recorded</Box>}
          {!!terms?.dropped?.length && (
            <Box sx={{ fontSize: 11.5, mt: 0.6, opacity: 0.85 }}>
              Left out because they did not return, and renormalised rather than
              counted as zero: {terms.dropped.join(", ")}.
            </Box>
          )}
          {terms?.capped && (
            <Box sx={{ fontSize: 11.5, mt: 0.6, opacity: 0.85 }}>
              Capped at {terms.cap?.toFixed(2)} because{" "}
              {(terms.flagged || []).join(" and ")} flagged this answer.
            </Box>
          )}
        </Box>
      }
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", cursor: "help" }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Overall</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: 18, fontWeight: 500 }}>{value.toFixed(2)}</Typography>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: colour }}>{statusOf(value).label}</Typography>
      </Stack>
    </Tooltip>
  );
}

function Shell({ meta, actions, children }: {
  meta?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: RADIUS }}>
      <Stack direction="row" spacing={2} useFlexGap sx={{
        alignItems: "center", flexWrap: "wrap", px: 2, py: 1, minHeight: 46,
        borderBottom: 1, borderColor: "divider",
      }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 600 }}>Evaluation</Typography>
        {actions}
        <Box sx={{ flex: 1 }} />
        {meta && (
          <Typography sx={{ fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
            {meta}
          </Typography>
        )}
      </Stack>
      {children}
    </Paper>
  );
}

const buttonSx = { textTransform: "none", borderRadius: RADIUS, fontSize: 12.5, py: 0.25 } as const;

export default function QualityScorecard({
  evaluation, status, onRescore, busy, sources,
}: {
  evaluation: AskEvaluation | null;
  /** From /api/rag/status, so an absent scorecard can say why. */
  status?: EvaluationStatus;
  onRescore?: () => void;
  busy?: boolean;
  /** So a per-excerpt verdict can name the document it was about. */
  sources?: { n: number; title: string }[];
}) {
  const theme = useTheme();
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const state = evaluation?.status ?? "none";
  const metrics = evaluation?.metrics || {};
  const online = status?.online?.length
    ? status.online
    : ["faithfulness", "answer_relevancy", "context_precision",
       "context_relevance", "context_utilization", "coherence", "conciseness"];
  const referenceOnly = status?.reference_only || ["context_recall", "correctness"];
  // Not filtered on what has arrived: while scoring is still running there are
  // no metrics yet, and the panel would announce seven judges and then show
  // nine.
  const safetyJudges = status?.safety || ["harmfulness", "maliciousness"];

  const rescore = onRescore && (
    <Button size="small" variant="outlined" startIcon={<RefreshCw size={13} />} onClick={onRescore}
            disabled={busy || state === "running"} sx={buttonSx}>
      Score again
    </Button>
  );

  // Scoring is switched off, or cannot run at all. Say which, rather than
  // showing an empty panel and leaving the reader to guess whether the answer
  // was unscoreable or nothing ever looked at it.
  if (status && !status.available && state === "none") {
    return (
      <Shell>
        <Alert severity="info" variant="outlined" sx={{ border: 0, px: 2 }}>
          {status.detail || "Answers are not being scored on this machine."}
        </Alert>
      </Shell>
    );
  }

  if (state === "none" || state === "running") {
    return (
      <Shell meta={state === "running" ? evaluation?.judge_model : undefined}
             actions={<Box sx={{ ml: "auto" }}>{rescore}</Box>}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", px: 2, py: 1.5 }}>
          {state === "running" && <CircularProgress size={16} />}
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
            {state === "running"
              ? `Scoring this answer against the excerpts it was written from — ${online.length + safetyJudges.length} judges, usually under a minute.`
              : "This answer has not been scored."}
          </Typography>
        </Stack>
      </Shell>
    );
  }

  if (state === "skipped" || state === "failed" || state === "abandoned") {
    return (
      <Shell actions={<Box sx={{ ml: "auto" }}>{rescore}</Box>}>
        <Alert
          severity={state === "skipped" ? "info" : "warning"}
          variant="outlined"
          sx={{ border: 0, px: 2 }}
        >
          {evaluation?.error
            || (state === "abandoned"
              ? "Scoring started and never reported — the server was probably restarted."
              : "Scoring did not finish.")}
        </Alert>
      </Shell>
    );
  }

  const flagged = (evaluation?.safety ?? 1) < 1;
  const partial = (evaluation?.terms?.dropped || []).length;
  const weights = evaluation?.terms?.weights || {};
  const safetyScored = safetyJudges.filter((n) => metrics[n]);

  return (
    <Shell
      meta={[
        evaluation?.judge_model,
        `${online.length + safetyJudges.length} judges`,
        evaluation?.seconds ? `${evaluation.seconds.toFixed(0)} s` : "",
        evaluation?.scores_pushed ? `${evaluation.scores_pushed} scores in Langfuse` : "",
      ].filter(Boolean).join(" · ")}
      actions={
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Box sx={{ width: "1px", height: 18, bgcolor: "divider" }} />
          {evaluation?.overall !== null && evaluation?.overall !== undefined && (
            <Overall value={evaluation.overall} terms={evaluation.terms} />
          )}
          <Box sx={{ ml: 1 }} />
          {rescore}
        </Stack>
      }
    >
      {flagged && (
        <Alert severity="warning" variant="outlined" sx={{ m: 2, mb: 0, borderRadius: RADIUS }}>
          {(evaluation?.terms?.flagged || []).join(" and ")} flagged this answer,
          so its overall score is capped at {evaluation?.terms?.cap?.toFixed(2)}.
          The quality judges below are unaffected and still read normally.
        </Alert>
      )}

      <Box sx={{ overflowX: "auto" }}>
        <Box sx={{ minWidth: 760 }}>
          <Box sx={{
            display: "grid", gridTemplateColumns: GRID, columnGap: 2, px: 2, py: 0.9,
            bgcolor: alpha(theme.palette.text.primary, 0.03), borderBottom: 1, borderColor: "divider",
            "& > *": { fontSize: 11.5, fontWeight: 600, color: "text.secondary" },
          }}>
            <span>Metric</span>
            <Box component="span" sx={{ textAlign: "right" }}>Score</Box>
            <span>vs threshold {LINE.toFixed(2)}</span>
            <span>Result</span>
            <span>Finding</span>
            <Box component="span" sx={{ textAlign: "right" }}>Weight</Box>
          </Box>
          {online.map((name) => (
            <Row key={name} name={name} metric={metrics[name]} weight={weights[name]}
                 onOpen={() => setOpenMetric(name)} />
          ))}
          <Box
            role="button" tabIndex={0}
            onClick={() => safetyScored.length && setOpenMetric(safetyScored[0])}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && safetyScored.length) {
                e.preventDefault();
                setOpenMetric(safetyScored[0]);
              }
            }}
            sx={{
              display: "grid", gridTemplateColumns: GRID, columnGap: 2, alignItems: "center",
              px: 2, minHeight: 38, borderBottom: 1, borderColor: "divider", cursor: "pointer",
              "&:hover": { bgcolor: "action.hover" },
              "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
            }}
          >
            <Typography component="span" sx={{ fontSize: 13, color: "primary.main" }}>Safety</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, textAlign: "right" }}>
              {flagged ? "flag" : "0 flags"}
            </Typography>
            <span />
            <Stack direction="row" spacing={0.75} sx={{
              alignItems: "center", fontSize: 12.5, fontWeight: 500,
              color: flagged ? theme.palette.error.main : theme.palette.success.main,
            }}>
              <Box sx={{ width: 8, height: 8, bgcolor: "currentColor", borderRadius: flagged ? 0 : "50%" }} />
              <span>{flagged ? "Flagged" : "Pass"}</span>
            </Stack>
            <Typography sx={{ fontSize: 12.5, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {flagged
                ? `Flagged by ${(evaluation?.terms?.flagged || []).join(" and ")}; worth a person's read.`
                : `No harmful or malicious content (${safetyScored.length || safetyJudges.length} judges).`}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", textAlign: "right" }}>cap</Typography>
          </Box>
          {referenceOnly.map((name) => (
            <Row key={name} name={name} metric={metrics[name]} absent
                 onOpen={() => setOpenMetric(name)} />
          ))}
        </Box>
      </Box>

      <Typography sx={{ display: "block", px: 2, py: 1.25, fontSize: 12, color: "text.secondary" }}>
        {partial > 0 || evaluation?.error
          ? (evaluation?.error
            || `${partial} judge${partial === 1 ? "" : "s"} did not return; the overall score was renormalised over the rest rather than counting them as zero. `)
          : ""}
        Context recall and correctness need a known-correct answer, which a live question does not have;
        they are scored on the evaluation set with <code>python evaluation.py experiment</code>.
        Select a row to read the judge's working.
      </Typography>

      {/* Beside the page rather than over it, and the metric is switched from
          inside the drawer rather than by closing it. The safety judges are in
          the switcher too even though they have no row of their own -- their
          rubric and reasoning are the most likely thing to be questioned. */}
      <MetricDetailDrawer
        open={!!openMetric}
        metric={openMetric || ""}
        evaluation={evaluation}
        sources={sources}
        onClose={() => setOpenMetric(null)}
        onPick={setOpenMetric}
        available={[...online, ...referenceOnly,
                    ...safetyJudges.filter((n) => metrics[n])]}
      />
    </Shell>
  );
}
