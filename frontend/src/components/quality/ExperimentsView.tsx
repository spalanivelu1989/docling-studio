/** View 3 · Experiments — "Is this change better, and what did it break?"
 *
 *  Two runs over the 27 ground-truthed questions, question by question. The
 *  only place correctness and context recall appear, because only these
 *  questions come with a known answer. Regressions sort first; each moved
 *  question says why it moved, read off the excerpts rather than asked of a
 *  model; and the configuration header shows what actually differs, because a
 *  comparison of two runs that differ in three ways cannot say which change
 *  did it.
 */
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, Link,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Typography, alpha, useTheme,
} from "@mui/material";
import { ExternalLink, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  quality, type ExperimentComparison, type ExperimentRow, type ExperimentSummary,
} from "../../api";
import { Empty, Panel } from "./parts";

const METRICS: { key: string; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "correctness", label: "Correct" },
  { key: "context_recall", label: "Complete sources" },
  { key: "faithfulness", label: "Stuck to sources" },
  { key: "context_precision", label: "Best sources first" },
];

const CONFIG_LABEL: Record<string, string> = {
  mode: "mode", k: "k", answer_model: "answer model", judge_model: "judge",
  prompt_hash: "prompt", corpus_fingerprint: "corpus", ragas_version: "ragas",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function ConfigCard({ run, differs, role }: {
  run: ExperimentComparison["base"]; differs: string[]; role: string;
}) {
  const theme = useTheme();
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 0.5, minWidth: 0 }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.2 }}>
        {role}{run.baseline ? " · accepted baseline" : ""}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{run.name}</Typography>
      <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{when(run.started_at)}</Typography>
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5 }}>
        {Object.entries(CONFIG_LABEL).map(([key, label]) => {
          const value = (run.config as Record<string, unknown>)[key];
          if (value === undefined || value === null || value === "") return null;
          const shown = typeof value === "string" && value.length > 14 ? value.slice(0, 8) : String(value);
          const hot = differs.includes(key);
          return (
            <Box key={key} sx={{
              fontSize: 11.5, px: 0.75, py: 0.2, borderRadius: 0.75,
              border: 1, borderColor: hot ? theme.palette.secondary.main : "divider",
              color: hot ? theme.palette.secondary.main : "text.secondary",
              fontWeight: hot ? 700 : 400,
            }}>
              {label} {shown}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function Stat({ label, value, pct = false, invert = false }: {
  label: string; value: number | null; pct?: boolean; invert?: boolean;
}) {
  const theme = useTheme();
  const good = value !== null && (invert ? value < 0 : value > 0);
  const flat = value === null || Math.abs(value) < 0.005;
  const colour = flat ? theme.palette.text.secondary : good ? theme.palette.success.main : theme.palette.error.main;
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 124 }}>
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 17, fontWeight: 800, color: colour, fontVariantNumeric: "tabular-nums" }}>
        {value === null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${pct ? Math.round(Math.abs(value) * 100) + "%" : Math.abs(value).toFixed(2)}`}
      </Typography>
    </Paper>
  );
}

function DeltaCell({ value }: { value: number | null | undefined }) {
  const theme = useTheme();
  if (value === null || value === undefined) return <TableCell align="right" sx={{ color: "text.disabled" }}>—</TableCell>;
  const colour = value >= 0.05 ? theme.palette.success.main : value <= -0.05 ? theme.palette.error.main : null;
  return (
    <TableCell align="right" sx={{
      fontFamily: "ui-monospace, monospace", fontSize: 12,
      ...(colour && { bgcolor: alpha(colour, 0.14), color: colour, fontWeight: 700 }),
    }}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}{Math.abs(value).toFixed(2)}
    </TableCell>
  );
}

export default function ExperimentsView({ onOpenItem }: {
  onOpenItem: (experimentId: string, row: ExperimentRow) => void;
}) {
  const theme = useTheme();
  const [runs, setRuns] = useState<ExperimentSummary[] | null>(null);
  const [base, setBase] = useState("");
  const [cand, setCand] = useState("");
  const [cmp, setCmp] = useState<ExperimentComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState<"all" | "regressed" | "improved">("all");
  const [part, setPart] = useState("");

  const load = useCallback(() => {
    quality.experiments().then((r) => {
      setRuns(r.experiments);
      const done = r.experiments.filter((e) => e.items > 0);
      // Default: the newest run against the accepted baseline, or against
      // the run before it when nothing has been accepted.
      const accepted = done.find((e) => e.baseline);
      const newest = done.find((e) => !accepted || e.id !== accepted.id) ?? done[0];
      setCand((c) => c || newest?.id || "");
      setBase((b) => b || accepted?.id || done.find((e) => e.id !== newest?.id)?.id || "");
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!base || !cand || base === cand) {
      setCmp(null);
      return;
    }
    setLoading(true);
    quality.compare(base, cand).then((c) => { setCmp(c); setError(null); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [base, cand]);

  const rows = useMemo(() => (cmp?.rows ?? []).filter((r) =>
    (show === "all" || r.verdict === show) && (!part || r.part === part)), [cmp, show, part]);

  if (runs === null) return error ? <Alert severity="warning">{error}</Alert> : <CircularProgress size={20} />;

  const done = runs.filter((e) => e.items > 0);
  if (done.length < 2) {
    return (
      <Panel title={done.length ? "One run so far" : "No runs over the evaluation set yet"}>
        <Empty>
          An experiment answers the 27 ground-truthed questions in
          docs/three-engine-eval-questions.md and scores every answer against its known answer —
          the only place correctness and complete-sources can be measured. Run two with one setting
          changed, then compare them here:
        </Empty>
        <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: "action.hover", fontSize: 12.5, overflowX: "auto" }}>
{`python evaluation.py dataset                        # once: push the questions
python evaluation.py experiment --mode hybrid -k 8
python evaluation.py experiment --mode hybrid -k 12`}
        </Box>
        {done.length === 1 && (
          <Typography sx={{ fontSize: 13, mt: 1.5 }}>
            <b>{done[0].name}</b> · {done[0].items} questions · overall {done[0].overall?.toFixed(2) ?? "—"}
            {" "}· correct {done[0].correctness?.toFixed(2) ?? "—"}
          </Typography>
        )}
      </Panel>
    );
  }

  const pick = (label: string, value: string, set: (v: string) => void, id: string) => (
    <FormControl size="small" sx={{ minWidth: 240, flex: 1 }}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={value} onChange={(e) => set(e.target.value)}>
        {done.map((e) => (
          <MenuItem key={e.id} value={e.id}>
            {e.baseline ? "★ " : ""}{e.name} · {when(e.started_at)} · {e.items}q · {e.overall?.toFixed(2) ?? "—"}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const differs = cmp?.differs ?? [];
  const candRun = runs.find((r) => r.id === cand);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        {pick("Baseline", base, setBase, "exp-base")}
        {pick("Candidate", cand, setCand, "exp-cand")}
      </Stack>

      {error && <Alert severity="warning">{error}</Alert>}
      {base === cand && <Alert severity="info">Pick two different runs to compare.</Alert>}
      {loading && <CircularProgress size={20} />}

      {cmp && (
        <>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr auto 1fr" }, alignItems: "center" }}>
            <ConfigCard run={cmp.base} differs={differs} role="Baseline" />
            <Typography sx={{ fontWeight: 700, color: "text.secondary", textAlign: "center" }}>vs</Typography>
            <ConfigCard run={cmp.cand} differs={differs} role="Candidate" />
          </Box>

          {differs.length !== 1 && (
            <Alert severity={differs.length ? "warning" : "info"} variant="outlined">
              {differs.length
                ? `These runs differ in ${differs.length} ways (${differs.map((d) => CONFIG_LABEL[d] ?? d).join(", ")}). Any change below cannot be put down to one of them.`
                : "These runs have the same configuration, so any difference below is the judge and the answering model varying — a useful measure of noise, not of a change."}
            </Alert>
          )}

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 160 }}>
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Questions</Typography>
              <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
                <Box component="span" sx={{ color: "success.main" }}>{cmp.counts.improved ?? 0} better</Box>
                {" · "}
                <Box component="span" sx={{ color: "error.main" }}>{cmp.counts.regressed ?? 0} worse</Box>
              </Typography>
            </Paper>
            {METRICS.map((m) => <Stat key={m.key} label={m.label} value={cmp.summary[m.key] ?? null} />)}
            <Stat label="Tokens per answer" value={cmp.tokens.change} pct invert />
          </Stack>

          <Panel
            title="Question by question"
            hint={`a move smaller than ${cmp.noise.toFixed(2)} counts as unchanged`}
            pad={false}
            actions={
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                {candRun?.langfuse_url && (
                  <Link href={candRun.langfuse_url} target="_blank" rel="noreferrer"
                        sx={{ fontSize: 12, display: "inline-flex", gap: 0.5, alignItems: "center" }}>
                    Langfuse <ExternalLink size={12} />
                  </Link>
                )}
                {!candRun?.baseline && (
                  <Button size="small" startIcon={<Star size={14} />} sx={{ textTransform: "none" }}
                          onClick={() => quality.setBaseline(cand).then(() => { setBase(cand); load(); })}>
                    Accept candidate as baseline
                  </Button>
                )}
              </Stack>
            }
          >
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", p: 1.5, pb: 1 }}>
              {(["all", "regressed", "improved"] as const).map((v) => (
                <Chip key={v} size="small" variant={show === v ? "filled" : "outlined"}
                      color={show === v ? "primary" : "default"}
                      label={v === "all" ? `All · ${cmp.rows.length}` : v === "regressed" ? `Worse · ${cmp.counts.regressed ?? 0}` : `Better · ${cmp.counts.improved ?? 0}`}
                      onClick={() => setShow(v)} />
              ))}
              <Box sx={{ width: 12 }} />
              {["", "PKG", "DR", "PKG+DR"].map((p) => (
                <Chip key={p || "any"} size="small" variant={part === p ? "filled" : "outlined"}
                      label={p || "Any part"} onClick={() => setPart(p)} />
              ))}
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 820 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Question</TableCell>
                    <TableCell>Part</TableCell>
                    {METRICS.map((m) => <TableCell key={m.key} align="right">{m.label}</TableCell>)}
                    <TableCell>Why it moved</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => {
                    const edge = r.verdict === "regressed" ? theme.palette.error.main
                      : r.verdict === "improved" ? theme.palette.success.main : "transparent";
                    return (
                      <TableRow key={r.item_id} hover sx={{ cursor: r.verdict === "missing" ? "default" : "pointer" }}
                                onClick={() => r.verdict !== "missing" && onOpenItem(cand, r)}>
                        <TableCell sx={{ boxShadow: `inset 3px 0 0 ${edge}`, maxWidth: 340 }}>
                          <b>{r.item_id}</b> · {r.question}
                        </TableCell>
                        <TableCell>{r.part}</TableCell>
                        {r.verdict === "missing"
                          ? <TableCell colSpan={METRICS.length} sx={{ color: "text.secondary" }}>not answered in the {r.missing_from}</TableCell>
                          : METRICS.map((m) => <DeltaCell key={m.key} value={r.deltas[m.key]} />)}
                        <TableCell sx={{ color: "text.secondary", fontSize: 12.5 }}>
                          {r.why.length ? r.why.join("; ")
                            : r.verdict === "unchanged" ? `overall within noise (±${cmp.noise.toFixed(2)}), same excerpts`
                              : "same excerpts, different answer"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length && (
                    <TableRow><TableCell colSpan={METRICS.length + 3} sx={{ color: "text.secondary" }}>Nothing matches these filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Panel>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            “Why it moved” compares the two runs' excerpts: documents that entered or left the
            retrieved set, and how many excerpts the judge found useful before and after. Click a
            question to read the candidate's judged working.
          </Typography>
        </>
      )}
    </Stack>
  );
}
