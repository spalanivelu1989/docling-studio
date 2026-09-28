/** The Evaluation tab of the Evidence Agent and the Fit-Gap Copilot: the run's
 *  own quality scores (agent_eval.py), grouped under the five agent metrics.
 *
 *  Every score is counted from something the run already checked -- quote
 *  verification, the quality gates, the claim lineage, the guardrails -- so it
 *  costs no model call. Each row says what was measured, the value, the target
 *  it is read against and what it found. Two rules, as on the Ask page's
 *  scorecard:
 *
 *  1. A score that has nothing to measure is absent, not zero. A run that made
 *     no web query has no web-query adherence, and the tab says so rather than
 *     show 0% or 100%.
 *
 *  2. What these scores cannot tell you is listed at the foot of the tab.
 *     Whether a quote really supports its claim, and whether the answer is the
 *     right one, need a judge or a reference answer; leaving them out silently
 *     would let a clean sheet here read as "the answer is right".
 */
import { Box, Chip, Paper, Stack, Tooltip, Typography, alpha, useTheme } from "@mui/material";
import { CircleAlert, CircleCheck, CircleMinus, CircleX } from "lucide-react";

import type { AgentEvaluation, AgentScore } from "../api";

const RADIUS = "4px";
const GRID = "minmax(160px, 220px) 84px 84px 86px minmax(0, 1fr)";

/** The five metrics, in the order they are read, with what each asks. */
const METRICS: { name: string; asks: string }[] = [
  { name: "Groundedness", asks: "Is every statement backed by a quote that exists in the source?" },
  { name: "Tool call accuracy", asks: "Did the agent call the right tools, without errors or waste?" },
  { name: "Task success", asks: "Did the run finish with a result, and how much did the gates repair?" },
  { name: "Topic adherence", asks: "Did the work stay on the subject it was given?" },
  { name: "Guardrails", asks: "Did the scope, web and contact-detail rules hold?" },
];

function shown(s: AgentScore): string {
  if (s.kind === "boolean") return s.value ? "Yes" : "No";
  if (s.kind === "share") return `${Math.round(s.value * 100)}%`;
  return String(Math.round(s.value));
}

function bound(s: AgentScore, v: number): string {
  const n = s.kind === "share" ? `${Math.round(v * 100)}%` : String(v);
  return `${s.good === "min" ? "≥" : "≤"} ${n}`;
}

function target(s: AgentScore): string {
  if (!s.good) return "—";
  if (s.kind === "boolean") return s.target ? "Yes" : "No";
  return bound(s, s.target);
}

type Status = "pass" | "watch" | "below" | null;

/** Runs scored before the Watch level carry only `passed`. */
function statusOf(s: AgentScore): Status {
  if (s.status !== undefined) return s.status;
  return s.passed === null ? null : s.passed ? "pass" : "below";
}

function Result({ status }: { status: Status }) {
  const theme = useTheme();
  if (status === null) {
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "text.disabled" }}>
        <CircleMinus size={14} /><Typography sx={{ fontSize: 12 }}>Info</Typography>
      </Stack>
    );
  }
  const look = {
    pass: { colour: theme.palette.success.main, icon: <CircleCheck size={14} />, word: "Pass" },
    watch: { colour: theme.palette.warning.main, icon: <CircleAlert size={14} />, word: "Watch" },
    below: { colour: theme.palette.error.main, icon: <CircleX size={14} />, word: "Below" },
  }[status];
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: look.colour }}>
      {look.icon}
      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{look.word}</Typography>
    </Stack>
  );
}

function Row({ s }: { s: AgentScore }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: GRID, columnGap: 2, alignItems: "center",
               px: 2, py: 0.9, borderTop: 1, borderColor: "divider" }}>
      <Tooltip placement="top-start" title={
        <Box sx={{ py: 0.5, maxWidth: 320, fontSize: 11.5 }}>
          {s.description}
          <Box sx={{ mt: 0.6, opacity: 0.7, fontFamily: "ui-monospace, monospace" }}>{s.name}</Box>
        </Box>
      }>
        <Typography sx={{ fontSize: 13, fontWeight: 500, cursor: "help" }}>{s.label}</Typography>
      </Tooltip>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {shown(s)}
      </Typography>
      <Box>
        <Typography sx={{ fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
          {target(s)}
        </Typography>
        {s.watch != null && (
          <Typography sx={{ fontSize: 10.5, color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
            watch {bound(s, s.watch)}
          </Typography>
        )}
      </Box>
      <Result status={statusOf(s)} />
      <Typography sx={{ fontSize: 12, color: "text.secondary", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.comment}>
        {s.comment}
      </Typography>
    </Box>
  );
}

export default function AgentEvaluationView({ evaluation, running, agent }: {
  evaluation: AgentEvaluation | Record<string, never> | null | undefined;
  running?: boolean;
  agent: "evidence" | "rollout";
}) {
  const theme = useTheme();
  const scores = evaluation && "scores" in evaluation ? evaluation.scores : [];

  if (!scores.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: RADIUS }}>
        <Typography sx={{ fontSize: 13.5, color: "text.secondary" }}>
          {running
            ? "The evaluation appears when the run finishes."
            : "This run was recorded before evaluation was kept. Run it again to see its scores."}
        </Typography>
      </Paper>
    );
  }

  const ev = evaluation as AgentEvaluation;
  const statuses = scores.map(statusOf);
  const below = statuses.filter((s) => s === "below").length;
  const watch = statuses.filter((s) => s === "watch").length;
  const headline = below ? theme.palette.error.main
    : watch ? theme.palette.warning.main : theme.palette.success.main;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ px: 2.5, py: 2, borderRadius: RADIUS,
                                      borderLeft: `4px solid ${headline}` }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}
               sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
              {ev.judged
                ? `${ev.passed} of ${ev.judged} checks met their target`
                  + (watch ? ` · ${watch} to watch` : "")
                : "No check with a target applies to this run"}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.5 }}>
              Counted from the run's own checks: no judge model, so it costs nothing and runs on
              every {agent === "evidence" ? "investigation" : "analysis"}.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {METRICS.map(({ name, asks }) => {
        const rows = scores.filter((s) => s.metric === name);
        if (!rows.length) return null;
        const judged = rows.filter((s) => statusOf(s) !== null);
        const failed = judged.filter((s) => statusOf(s) === "below").length;
        const watching = judged.filter((s) => statusOf(s) === "watch").length;
        return (
          <Paper key={name} variant="outlined" sx={{ borderRadius: RADIUS, overflow: "hidden" }}>
            <Stack direction="row" spacing={1.5}
                   sx={{ px: 2, py: 1.25, alignItems: "center",
                         bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{name}</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{asks}</Typography>
              </Box>
              {judged.length > 0 && (
                <Chip size="small" variant="outlined"
                      color={failed ? "error" : watching ? "warning" : "success"}
                      label={failed ? `${failed} below target`
                        : watching ? `${watching} to watch` : "All on target"}
                      sx={{ height: 22, fontSize: 11 }} />
              )}
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Box sx={{ minWidth: 640 }}>
                <Box sx={{ display: "grid", gridTemplateColumns: GRID, columnGap: 2, px: 2, py: 0.6,
                           borderTop: 1, borderColor: "divider" }}>
                  {["Check", "Value", "Target", "Result", "Detail"].map((h) => (
                    <Typography key={h} sx={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4,
                                              textTransform: "uppercase", color: "text.disabled" }}>
                      {h}
                    </Typography>
                  ))}
                </Box>
                {rows.map((s) => <Row key={s.name} s={s} />)}
              </Box>
            </Box>
          </Paper>
        );
      })}

      <Typography sx={{ fontSize: 12, color: "text.secondary", px: 0.5 }}>
        Not measured here: whether each quote really supports its claim, and whether the
        {agent === "evidence" ? " answer" : " analysis"} matches a known-correct one. Those need a
        judge model or a reference answer.
        {agent === "rollout" && " The workshop's accept and reject decisions are the running check on the second."}
      </Typography>
    </Stack>
  );
}
