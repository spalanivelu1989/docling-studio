/** View 4 · Judge trust — "Can we believe these scores?"
 *
 *  Every other number in the workspace is a model's opinion. This view is
 *  where that opinion is checked: against people (a review queue and the
 *  agreement they produce), against itself (the same answer scored twice --
 *  measured rather than assumed, since this Anthropic SDK exposes no
 *  temperature and the judge runs at default sampling), and against its twin
 *  (the two context-relevance judges, whose ratings are already kept apart).
 */
import { Alert, Box, Paper, Stack, Typography, useTheme } from "@mui/material";
import { ArrowRight } from "lucide-react";

import type { JudgeQueueItem, JudgeTrust } from "../../api";
import { AgreementMatrix, Meter } from "./charts";
import { Empty, Panel } from "./parts";

function Figure({ label, value, detail, colour }: {
  label: string; value: string; detail: string; colour?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 0.5, alignContent: "start" }}>
      <Typography sx={{ fontSize: 11, color: "text.secondary", textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, color: colour, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{detail}</Typography>
    </Paper>
  );
}

const KIND_LABEL: Record<JudgeQueueItem["kind"], string> = {
  disagree: "Judge and reviewer disagree",
  relevance_split: "The two relevance judges disagree",
  unstable: "Scored differently twice",
  sample: "Random sample",
};

export default function JudgeView({ data, onReview }: {
  data: JudgeTrust;
  onReview: (runId: string) => void;
}) {
  const theme = useTheme();
  const a = data.agreement;
  const kappaColour = a.kappa === null ? undefined
    : a.kappa >= 0.6 ? theme.palette.success.main
      : a.kappa >= 0.4 ? theme.palette.warning.main : theme.palette.error.main;
  const unstableShare = data.stability.rescored ? data.stability.unstable / data.stability.rescored : 0;
  const warnings = [
    a.kappa !== null && a.kappa < 0.6 && `Agreement with reviewers is ${a.kappa.toFixed(2)}, below 0.6 — the judge's verdicts should not be relied on without a person looking.`,
    data.stability.rescored >= 5 && unstableShare > 0.2 && `${Math.round(unstableShare * 100)}% of re-scored answers moved by ${data.unstable_above} or more — scores from this judge are not repeatable enough to compare single answers.`,
    data.dropped_rate !== null && data.dropped_rate > 0.1 && `${Math.round(data.dropped_rate * 100)}% of judge calls did not return — overall scores are being averaged over fewer judges than they should.`,
  ].filter(Boolean) as string[];

  if (!data.scored) {
    return <Panel title="Nothing to check yet"><Empty>No answers have been scored.</Empty></Panel>;
  }

  return (
    <Stack spacing={2}>
      {warnings.map((w) => <Alert key={w} severity="warning" variant="outlined">{w}</Alert>)}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
        <Figure
          label="Agreement with people"
          value={a.kappa !== null ? `κ ${a.kappa.toFixed(2)}` : `${a.reviews} / ${a.min_reviews}`}
          colour={kappaColour}
          detail={a.kappa !== null
            ? `Cohen's kappa over ${a.reviews} reviewed answers · raw agreement ${Math.round((a.raw ?? 0) * 100)}%`
            : `reviews so far — agreement is reported from ${a.min_reviews}, because a figure over fewer is noise`}
        />
        <Figure
          label="Same answer, scored twice"
          value={data.stability.median !== null ? `± ${data.stability.median.toFixed(2)}` : "—"}
          detail={data.stability.rescored
            ? `median change in faithfulness over ${data.stability.rescored} re-scored answer${data.stability.rescored === 1 ? "" : "s"} · ${data.stability.unstable} moved ${data.unstable_above}+`
            : "no answer has been scored twice yet — run python evaluation.py rescore --sample 10"}
        />
        <Figure
          label="Judges that did not return"
          value={data.dropped_rate === null ? "—" : `${(data.dropped_rate * 100).toFixed(1)}%`}
          colour={data.dropped_rate !== null && data.dropped_rate > 0.1 ? theme.palette.error.main : undefined}
          detail="of all judge calls — left out of the overall score rather than counted as zero"
        />
        <Figure
          label="The two relevance judges"
          value={data.relevance.rate === null ? "—" : `${Math.round(data.relevance.rate * 100)}%`}
          detail={data.relevance.pairs
            ? `give the same rating, over ${data.relevance.pairs} answers`
            : "no answer has both ratings kept yet — they are kept from now on"}
        />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "2fr 3fr" } }}>
        <Panel title="Judge's faithfulness vs a reviewer's verdict" hint="answers per cell">
          {a.reviews ? (
            <AgreementMatrix matrix={a.matrix} buckets={a.buckets} />
          ) : (
            <Empty>
              No answer has a reviewer's verdict yet. Open any answer in the queue, read it against
              its excerpts, and choose Grounded, Partly or Not grounded — this grid fills as you do.
            </Empty>
          )}
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1 }}>
            Rows are the judge's score cut into three; columns are a reviewer's verdict. The
            diagonal is agreement. The top-right cell is the costly one: the judge called an answer
            grounded and a person did not.
          </Typography>
        </Panel>
        <Panel title="Review queue" hint="disagreements first, then a weekly sample">
          {data.queue.length ? data.queue.map((q) => {
            const colour = q.severity === "bad" ? theme.palette.error.main
              : q.severity === "warn" ? theme.palette.warning.main : theme.palette.divider;
            return (
              <Box key={q.run_id} role="button" tabIndex={0} onClick={() => onReview(q.run_id)}
                   onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReview(q.run_id); } }}
                   sx={{
                     display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 1.5, py: 1, px: 1, mx: -1,
                     borderRadius: 1, cursor: "pointer", alignItems: "center",
                     "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" },
                   }}>
                <Box sx={{ alignSelf: "stretch", borderRadius: 2, bgcolor: colour }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{KIND_LABEL[q.kind]}</Typography>
                  <Typography sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{q.detail}</Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "primary.main", fontSize: 12 }}>
                  Review <ArrowRight size={14} />
                </Stack>
              </Box>
            );
          }) : <Empty>Every scored answer has a reviewer's verdict.</Empty>}
        </Panel>
      </Box>

      <Panel title="Judges that did not return, by metric">
        {data.dropped.map((d) => (
          <Box key={d.metric} sx={{ display: "grid", gridTemplateColumns: "180px 1fr 110px", gap: 1.5, alignItems: "center", py: 0.6 }}>
            <Typography sx={{ fontSize: 13 }}>{d.metric.replace(/_/g, " ")}</Typography>
            <Meter value={d.rate} colour={d.rate > 0.1 ? theme.palette.error.main : theme.palette.warning.main} />
            <Typography sx={{ fontSize: 12, color: "text.secondary", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {d.lost} of {d.tried}
            </Typography>
          </Box>
        ))}
        <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1 }}>
          Judge models in use: {data.judge_models.join(", ") || "—"}. A judge that did not return is
          left out of an answer's overall score, and the other weights are renormalised.
        </Typography>
      </Panel>
    </Stack>
  );
}
