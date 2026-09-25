/** Failure analysis — "What goes wrong, and on which subjects?"
 *
 *  The view no evaluation tool surveyed has, because it reads the judge's own
 *  working: the document list is built from per-excerpt verdicts and the
 *  invented-claims list from per-claim ones. Every mark opens the answers
 *  behind it, and every answer opens the judge's working for it.
 */
import {
  Box, Chip, Collapse, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type {
  ClaimGroup, FailureType, QualityExplorer, QualityPoint, QualitySubject,
} from "../../api";
import { failureColour, Quadrant, SubjectBubbles } from "./charts";
import { Empty, Panel } from "./parts";

export type Drill = {
  title: string;
  detail?: string;
  runIds: string[];
  /** Which metric an opened answer should show first. */
  focus?: string;
};

/** The metric that explains each failure type best, for the drawer to open on. */
export const FOCUS: Record<FailureType["key"], string> = {
  safety: "harmfulness",
  wrong_sources: "context_relevance",
  buried: "context_precision",
  ignored: "context_utilization",
  invented: "faithfulness",
  off_question: "answer_relevancy",
};

function ClaimRow({ group, onOpen }: { group: ClaimGroup; onOpen: () => void }) {
  const theme = useTheme();
  return (
    <Box
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      sx={{
        border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25, cursor: "pointer",
        display: "grid", gap: 0.4,
        "&:hover, &:focus-visible": { borderColor: theme.palette.error.main, outline: "none" },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{group.label}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "error.main", flexShrink: 0 }}>
          {group.count} claim{group.count === 1 ? "" : "s"} · {group.run_ids.length} answer{group.run_ids.length === 1 ? "" : "s"}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 12.5, fontStyle: "italic", color: "text.secondary" }}>“{group.example}”</Typography>
      {group.reason && (
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Judge: {group.reason}</Typography>
      )}
    </Box>
  );
}

export default function ExplorerView({ data, onDrill, onPoint }: {
  data: QualityExplorer;
  onDrill: (d: Drill) => void;
  onPoint: (p: QualityPoint) => void;
}) {
  const theme = useTheme();
  const [failure, setFailure] = useState<FailureType["key"] | "">("");
  const [rulesOpen, setRulesOpen] = useState(false);

  if (!data.points.length) {
    return (
      <Panel title="Nothing to explore yet">
        <Empty>No scored answers in this window. Widen the window, or ask a few questions on the Ask page.</Empty>
      </Panel>
    );
  }

  const byFailure = (key: FailureType["key"]) => data.points.filter((p) => p.failure === key);
  const pickFailure = (key: FailureType["key"]) => {
    setFailure(key === failure ? "" : key);
    const hits = byFailure(key);
    const type = data.failures.find((f) => f.key === key)!;
    if (hits.length) {
      onDrill({ title: type.label, detail: type.means, runIds: hits.map((p) => p.run_id), focus: FOCUS[key] });
    }
  };
  const pickSubject = (s: QualitySubject) => onDrill({
    title: s.label, detail: `${s.n} question${s.n === 1 ? "" : "s"} · e.g. “${s.example}”`,
    runIds: s.run_ids, focus: s.failure ? FOCUS[s.failure] : "faithfulness",
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Chip size="small" label={`All · ${data.points.length}`} variant={failure ? "outlined" : "filled"}
              color={failure ? "default" : "primary"} onClick={() => setFailure("")} />
        {data.failures.map((f) => (
          <Tooltip key={f.key} title={`${f.means}. Rule: ${f.rule}. Fix: ${f.fix}.`}>
            <Chip
              size="small"
              label={`${f.label} · ${f.count}`}
              variant={failure === f.key ? "filled" : "outlined"}
              disabled={!f.count}
              onClick={() => pickFailure(f.key)}
              sx={{
                borderColor: alpha(failureColour(theme, f.key), 0.6),
                ...(failure === f.key && { bgcolor: alpha(failureColour(theme, f.key), 0.2) }),
              }}
            />
          </Tooltip>
        ))}
      </Stack>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "2fr 3fr" } }}>
        <Panel title="Where each answer went wrong" hint="one dot per answer · click to open">
          <Quadrant points={data.points} line={data.line} onPick={onPoint} selected={failure} />
        </Panel>
        <Panel title="Subjects, sized by questions, coloured by quality" hint="grouped by meaning">
          {data.subjects.length ? (
            <>
              <SubjectBubbles subjects={data.subjects} onPick={pickSubject} />
              <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1 }}>
                Questions grouped by meaning with bge-m3, the model the corpus is indexed with.
                Names are the words that set each group apart. Click one to read its answers.
              </Typography>
            </>
          ) : (
            <Empty>{data.subjects_error || "Too few questions to group."}</Empty>
          )}
        </Panel>
      </Box>

      {/* Documents have a tab of their own now: Source documents. */}
      <Box>
        <Panel title="Invented claims, grouped" hint={data.claim_count ? `${data.claim_count} unsupported claims` : undefined}>
          {data.claims.length ? (
            <Stack spacing={1}>
              {data.claims.map((g) => (
                <ClaimRow key={g.id} group={g} onOpen={() => onDrill({
                  title: g.label, detail: `${g.count} unsupported claim${g.count === 1 ? "" : "s"} like “${g.example}”`,
                  runIds: g.run_ids, focus: "faithfulness",
                })} />
              ))}
            </Stack>
          ) : (
            <Empty>
              {data.claims_error || "No claim in this window was judged unsupported — or the answers were scored before claim-level verdicts were kept. Re-score an answer to fill them in."}
            </Empty>
          )}
        </Panel>
      </Box>

      <Panel
        title="How an answer is given a failure type"
        actions={
          <Box component="button" onClick={() => setRulesOpen((o) => !o)}
               sx={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "primary.main" }}>
            {rulesOpen ? "Hide" : "Show"} the rules
            <ChevronDown size={14} style={{ transform: rulesOpen ? "rotate(180deg)" : "none" }} />
          </Box>
        }
        pad={false}
      >
        <Collapse in={rulesOpen}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Failure type</TableCell><TableCell>Rule</TableCell>
                <TableCell>What it usually means</TableCell><TableCell>Where to fix it</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.failures.map((f) => (
                <TableRow key={f.key}>
                  <TableCell sx={{ fontWeight: 600 }}>{f.label}</TableCell>
                  <TableCell sx={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{f.rule}</TableCell>
                  <TableCell>{f.means}</TableCell>
                  <TableCell>{f.fix}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography sx={{ fontSize: 12, color: "text.secondary", p: 2, pt: 1 }}>
            Applied in this order; the first that matches wins. A rule whose score is missing is
            skipped rather than failed. Stated arithmetic, not a model's opinion, so anyone can
            check why an answer landed where it did.
          </Typography>
        </Collapse>
      </Panel>
    </Stack>
  );
}
