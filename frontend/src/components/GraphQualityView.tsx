/** The knowledge graph's Quality view: how good the graph is, and how well
 *  plain-English questions about it are answered.
 *
 *  Two checks, run separately because they cost very different amounts
 *  (backend/graph/graph_eval.py):
 *
 *    The graph itself   counted from the graph and its sources, no model call;
 *                       run when the view opens if it has never run
 *    Questions          Claude writes a query for each reference question and
 *                       its rows are compared with the reference query's; one
 *                       model call per question, so only on request
 *
 *  Both use the Evaluation view the agents use, so a score reads the same way
 *  everywhere: value, target, Pass / Watch / Below, and what it found. */
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, LinearProgress, Paper, Stack, Typography, alpha, useTheme,
} from "@mui/material";
import { ChevronDown, ChevronRight, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type GraphQuality, type GraphQuestionResult } from "../api";
import AgentEvaluationView from "./AgentEvaluationView";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RADIUS = "4px";

const STRUCTURE_METRICS = [
  { name: "Accuracy", asks: "Does every passage an edge cites really name what the edge points to?" },
  { name: "Completeness", asks: "Is everything that should be in the graph there?" },
  { name: "Consistency", asks: "Does the graph obey its own rules, with nothing missing, doubled or contradicting?" },
  { name: "Structure", asks: "Is the graph one connected whole, and how many nodes connect to almost everything?" },
  { name: "Freshness", asks: "Was the graph, and its Cypher copy, built from the documents as they are now?" },
];
const QUESTION_METRICS = [
  { name: "Plain-English questions", asks: "When someone asks the graph a question in English, do they get the right rows?" },
];

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** What happened to one question, in a word and a colour. */
function outcome(r: GraphQuestionResult): { label: string; tone: "success" | "warning" | "error" | "default" } {
  if (r.error && !r.cypher && r.answerable === null) return { label: "Error", tone: "error" };
  if (!r.expected_answerable) {
    return r.answerable === false ? { label: "Rightly declined", tone: "success" } : { label: "Should have declined", tone: "error" };
  }
  if (r.answerable === false) return { label: "Wrongly declined", tone: "error" };
  if (!r.valid) return { label: "No valid query", tone: "error" };
  return r.matched ? { label: "Right answer", tone: "success" } : { label: "Different answer", tone: "warning" };
}

function QuestionRow({ r }: { r: GraphQuestionResult }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const o = outcome(r);
  const code = { fontFamily: MONO, fontSize: 11.5, whiteSpace: "pre-wrap", m: 0, p: 1, borderRadius: 1,
                 bgcolor: alpha(theme.palette.text.primary, 0.04), border: 1, borderColor: "divider" } as const;
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1.5} onClick={() => setOpen((v) => !v)}
             sx={{ px: 2, py: 0.9, alignItems: "center", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "text.secondary", width: 32, flex: "none" }}>{r.id}</Typography>
        <Typography sx={{ fontSize: 13, flex: 1, minWidth: 0 }}>{r.question}</Typography>
        <Chip size="small" variant="outlined" color={o.tone} label={o.label} sx={{ height: 22, fontSize: 11, flex: "none" }} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ px: 2, pb: 1.5, pl: 7 }}>
          {r.why && <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{r.why}</Typography>}
          {r.note && <Typography sx={{ fontSize: 12, color: "text.secondary", fontStyle: "italic" }}>{r.note}</Typography>}
          {r.cypher && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", mb: 0.5 }}>
                QUERY CLAUDE WROTE{r.attempts > 1 ? ` · after ${r.attempts - 1} correction${r.attempts > 2 ? "s" : ""}` : ""}
                {r.answer_rows !== undefined ? ` · ${r.answer_rows} rows` : ""}
              </Typography>
              <Box component="pre" sx={code}>{r.cypher}</Box>
            </Box>
          )}
          {r.reference && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", mb: 0.5 }}>
                REFERENCE QUERY{r.reference_rows !== undefined ? ` · ${r.reference_rows} rows` : ""}
                {r.compare ? ` · compared by ${r.compare === "rows" ? "rows" : r.compare === "values" ? "values found" : "route length"}` : ""}
              </Typography>
              <Box component="pre" sx={code}>{r.reference}</Box>
            </Box>
          )}
          {r.error && !r.valid && <Typography sx={{ fontSize: 12, color: "error.main" }}>{r.error}</Typography>}
        </Stack>
      </Collapse>
    </Box>
  );
}

export default function GraphQualityView() {
  const [data, setData] = useState<GraphQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const asked = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.graphQuality();
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  const checkStructure = useCallback(async () => {
    setChecking(true);
    try {
      await api.checkGraphStructure();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [load]);

  // First visit: the free check has never run, so run it rather than show an empty panel.
  useEffect(() => {
    void load().then((d) => {
      if (d && !d.structure && !asked.current) {
        asked.current = true;
        void checkStructure();
      }
    });
  }, [load, checkStructure]);

  // While a question check runs, follow it.
  const running = data?.questions?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [running, load]);

  async function startQuestions() {
    setStarting(true);
    try {
      await api.startGraphQuestions();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const s = data?.structure;
  const q = data?.questions;
  const results = q?.results ?? [];
  const total = q?.total ?? 0;

  return (
    <Box sx={{ flex: 1, overflowY: "auto", px: { xs: 2, md: 4 }, py: 3 }}>
      <Stack spacing={3} sx={{ maxWidth: 1200, mx: "auto" }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Graph quality</Typography>
          <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5 }}>
            How trustworthy the knowledge graph is, and how well it answers questions asked in plain English.
          </Typography>
        </Box>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: RADIUS }}>{error}</Alert>}

        {/* --- the graph itself --- */}
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>The graph itself</Typography>
            {s && <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Checked {ago(s.finished_at ?? s.started_at)}</Typography>}
            <Button size="small" variant="outlined" onClick={checkStructure} disabled={checking}
                    startIcon={checking ? <CircularProgress size={13} /> : <RefreshCw size={14} />}
                    sx={{ textTransform: "none" }}>
              {checking ? "Checking…" : "Check now"}
            </Button>
          </Stack>
          <AgentEvaluationView
            evaluation={s?.report}
            metrics={STRUCTURE_METRICS}
            subtitle="Counted from the graph and the sources it was built from. No model is called, so it takes seconds."
            empty={checking ? "Checking the graph…" : "Not checked yet. Press Check now."}
            footnote={<>Not measured here: whether a correctly matched mention is <i>meaningful</i> (a
              system named in passing is still a match), and names the fixed system list does not
              know. Both need a person to review a sample.</>}
          />
        </Box>

        {/* --- plain-English questions --- */}
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Plain-English questions</Typography>
            {q && q.status !== "running" && (
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {q.status === "done" ? `Run ${ago(q.finished_at)}` : q.status === "failed" ? "Last run failed" : "Last run did not finish"}
              </Typography>
            )}
            <Button size="small" variant="contained" disableElevation onClick={startQuestions}
                    disabled={running || starting}
                    startIcon={running || starting ? <CircularProgress size={13} color="inherit" /> : <Play size={14} />}
                    sx={{ textTransform: "none" }}>
              {running ? "Running…" : "Run question check"}
            </Button>
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", mb: 1.5 }}>
            Claude writes a Cypher query for each of {total || "the"} reference questions; the query is run and its
            rows are compared with a reference query’s. It asks Claude once per question, so it takes a few
            minutes and only runs when you press the button.
          </Typography>
          {data && !data.reviewed && (
            <Alert severity="warning" sx={{ mb: 1.5, borderRadius: RADIUS }}>
              The reference answers have not been reviewed yet by someone who knows the programme. Until they are,
              read a “different answer” as a question to look at, not as a verdict.
            </Alert>
          )}
          {running && (
            <Box sx={{ mb: 1.5 }}>
              <LinearProgress variant="determinate" value={total ? (results.length / total) * 100 : 0}
                              sx={{ height: 6, borderRadius: 3 }} />
              <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.5 }}>
                {results.length} of {total} questions answered
              </Typography>
            </Box>
          )}
          {q?.status === "failed" && q.error && (
            <Alert severity="error" sx={{ mb: 1.5, borderRadius: RADIUS }}>{q.error}</Alert>
          )}
          {q?.report && (
            <AgentEvaluationView
              evaluation={q.report}
              metrics={QUESTION_METRICS}
              subtitle={`The latest run, over ${total} reference questions${q.seconds ? `, took ${Math.round(q.seconds / 60) || 1} min` : ""}.`}
              footnote="A “different answer” is not always wrong: a query can be right and still return its rows in another shape. Open the question to compare the two queries."
            />
          )}
          {!q && !running && (
            <Paper variant="outlined" sx={{ p: 3, borderRadius: RADIUS }}>
              <Typography sx={{ fontSize: 13.5, color: "text.secondary" }}>Not run yet. Press Run question check.</Typography>
            </Paper>
          )}
          {results.length > 0 && (
            <Paper variant="outlined" sx={{ borderRadius: RADIUS, overflow: "hidden", mt: 2 }}>
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Each question</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Open one to see the query Claude wrote beside the reference.</Typography>
              </Box>
              {results.map((r) => <QuestionRow key={r.id} r={r} />)}
            </Paper>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
