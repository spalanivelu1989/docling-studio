import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Collapse, Divider, IconButton,
  LinearProgress, ListItemText, ListSubheader, MenuItem, Paper, Select, Stack, Switch,
  TextField, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban, ChevronDown, CircleAlert, CircleCheck, CircleHelp, Copy, Dices, Eye, FileText, FlaskConical,
  GitBranch, Layers, Network, Quote, Scale, ScanLine, Search, SendHorizontal, Sigma, Square, Target,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  askEvidence, evidence,
  type AnswerState, type EvidenceAnswer, type EvidenceClaim, type EvidenceSource,
  type EvidenceStatus, type EvidenceToolCall, type ScoreTerm, type Stance,
} from "../api";
import { EVAL_QUESTIONS, HALVES, type EvalQuestion } from "../data/evalQuestions";

/* ------------------------------------------------------------------- states */

const STATES: Record<AnswerState, { label: string; blurb: string; hue: string; icon: ReactElement }> = {
  supported: { label: "Supported", hue: "success", icon: <CircleCheck size={16} />,
    blurb: "The sources agree and carry the claims." },
  conflicted: { label: "Conflicted", hue: "warning", icon: <TriangleAlert size={16} />,
    blurb: "Sources disagree. Both sides are reported; neither is chosen." },
  documented_unknown: { label: "Documented unknown", hue: "info", icon: <CircleHelp size={16} />,
    blurb: "The corpus records this as undecided — somebody wrote down that it is open." },
  not_in_corpus: { label: "Not in the corpus", hue: "neutral", icon: <Ban size={16} />,
    blurb: "Nothing in the indexed corpus addresses this." },
  false_premise: { label: "False premise", hue: "error", icon: <CircleAlert size={16} />,
    blurb: "The corpus contradicts an assumption in the question." },
  unrepresentable: { label: "Unrepresentable", hue: "neutral", icon: <Ban size={16} />,
    blurb: "Answering needs something neither engine models." },
};

const STANCE: Record<Stance, { label: string; hue: "success" | "error" | "neutral" }> = {
  supports: { label: "supports", hue: "success" },
  opposes: { label: "opposes", hue: "error" },
  context: { label: "context", hue: "neutral" },
};

const PROVENANCE_HINT: Record<string, string> = {
  mostly_machine_read: "Most of this document was transcribed from pictures by a vision model or OCR, not typed by an author.",
  has_unreadable_images: "This document contains pictures no engine could read at all.",
  discussion: "An email or meeting note — it records discussion, not an implemented state.",
  template: "A blank template rather than a filled document.",
  sparse_table: "Most of this document's table cells are empty.",
  unfilled_boilerplate: "Unfilled template phrases remain in this document.",
};

const ENGINE_ICON: Record<string, ReactElement> = {
  rag: <Search size={12} />,
  graph: <Network size={12} />,
  bpml: <Target size={12} />,
  other: <GitBranch size={12} />,
};

/** The three places the agent can look, named in the log so a reader can tell
 *  a corpus search from a graph traversal without knowing the function names. */
const ENGINE_NAME: Record<string, string> = {
  rag: "RAG",
  graph: "GRAPH",
  bpml: "BPML",
  other: "\u2014",
};

const ENGINE_COLOUR: Record<string, string> = {
  rag: "primary.main",
  graph: "info.main",
  bpml: "success.main",
  other: "text.disabled",
};

const ENGINE_HINT: Record<string, string> = {
  rag: "Hybrid retrieval over the Markdown corpus: meaning-based vector search and BM25 keyword search, fused. Returns passages, never a written answer.",
  graph: "The knowledge graph, held in memory: entity lookup and breadth-first traversal. No database, no embeddings, no model.",
  bpml: "The BPML process hierarchy, read from the spreadsheet.",
};

function useHue() {
  const theme = useTheme();
  return useCallback((hue: string) => {
    if (hue === "neutral") return theme.palette.text.secondary;
    const slot = (theme.palette as unknown as Record<string, { main?: string } | undefined>)[hue];
    return slot?.main ?? theme.palette.text.secondary;
  }, [theme]);
}

const plural = (n: number, one: string, many = "") => `${n} ${n === 1 ? one : many || one + "s"}`;

/* ------------------------------------------------------------------- pieces */

function StateBadge({ state }: { state: AnswerState }) {
  const s = STATES[state];
  const colour = useHue()(s.hue);
  return (
    <Tooltip title={s.blurb}>
      <Stack direction="row" spacing={0.85} sx={{
        alignItems: "center", px: 1.25, py: 0.6, borderRadius: 1.5,
        bgcolor: alpha(colour, 0.13), color: colour, border: `1px solid ${alpha(colour, 0.35)}`,
        fontWeight: 800, fontSize: 12, letterSpacing: ".03em", whiteSpace: "nowrap",
      }}>
        {s.icon}<span>{s.label.toUpperCase()}</span>
      </Stack>
    </Tooltip>
  );
}

/** The score with its arithmetic attached — the number is only trustworthy if
 *  the terms that produced it are one hover away. */
function ScoreChip({ score, terms }: { score: number; terms: ScoreTerm[] }) {
  const theme = useTheme();
  const colour = score >= 0.65 ? theme.palette.success.main
    : score >= 0.4 ? theme.palette.warning.main : theme.palette.error.main;
  return (
    <Tooltip
      title={
        <Box sx={{ py: 0.5 }}>
          {terms.map((t, i) => (
            <Box key={i} sx={{ fontSize: 11.5, mb: 0.4 }}>
              <b style={{ fontFamily: "ui-monospace, monospace" }}>
                {t.cap != null ? `cap ${t.cap.toFixed(2)}` : `${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}`}
              </b>{" "}
              {t.rule} — {t.detail}
            </Box>
          ))}
          {!terms.length && <Box sx={{ fontSize: 11.5 }}>no terms recorded</Box>}
        </Box>
      }
    >
      <Stack direction="row" spacing={0.6} sx={{
        alignItems: "center", px: 0.9, py: 0.3, borderRadius: 1,
        bgcolor: alpha(colour, 0.14), color: colour, cursor: "help",
      }}>
        <Sigma size={11} />
        <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 12 }}>
          {score.toFixed(2)}
        </Box>
      </Stack>
    </Tooltip>
  );
}

function SourceRow({ s }: { s: EvidenceSource }) {
  const theme = useTheme();
  const hue = useHue();
  const colour = hue(STANCE[s.stance].hue);
  const [copied, setCopied] = useState(false);
  return (
    <Paper sx={{ p: 1.25, borderLeft: `3px solid ${colour}` }}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color: colour,
                          textTransform: "uppercase" }}>
          {STANCE[s.stance].label}
        </Typography>
        {s.verified === false && (
          <Tooltip title="This quote was not found in the chunk it names, so it was discarded from the score">
            <Chip size="small" color="error" label="unverified" sx={{ height: 17, fontSize: 9.5 }} />
          </Tooltip>
        )}
        <Typography sx={{ fontSize: 11, color: "text.secondary", flex: 1, minWidth: 0 }} noWrap title={s.doc}>
          {s.doc}
        </Typography>
        <Tooltip title="Copy the quote">
          <IconButton size="small" sx={{ p: 0.25 }}
                      onClick={() => { navigator.clipboard.writeText(s.quote); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <CircleCheck size={12} /> : <Copy size={12} />}
          </IconButton>
        </Tooltip>
      </Stack>

      {s.heading_path && (
        <Typography sx={{ fontSize: 10.5, color: "text.disabled", mb: 0.5 }} noWrap>{s.heading_path}</Typography>
      )}
      <Typography sx={{ fontSize: 12.5, lineHeight: 1.55, fontStyle: "italic" }}>“{s.quote}”</Typography>

      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.85, alignItems: "center" }}>
        <Chip size="small" variant="outlined" label={`chunk ${s.chunk_id}`} sx={{ height: 17, fontSize: 9.5 }} />
        {/* Why this passage was found at all: the retrieval side of scoring. */}
        {s.score != null && (
          <Tooltip title="Reciprocal rank fusion score — how the two searches agreed on this passage">
            <Chip size="small" variant="outlined" label={`rrf ${s.score.toFixed(4)}`}
                  sx={{ height: 17, fontSize: 9.5, fontFamily: "ui-monospace, monospace" }} />
          </Tooltip>
        )}
        {s.vector_rank != null && (
          <Tooltip title="Rank in the vector (meaning) search"><Chip size="small" variant="outlined"
            label={`vec #${s.vector_rank}`} sx={{ height: 17, fontSize: 9.5 }} /></Tooltip>
        )}
        {s.keyword_rank != null && (
          <Tooltip title="Rank in the BM25 keyword search"><Chip size="small" variant="outlined"
            label={`bm25 #${s.keyword_rank}`} sx={{ height: 17, fontSize: 9.5 }} /></Tooltip>
        )}
        {s.provenance.map((f) => (
          <Tooltip key={f} title={PROVENANCE_HINT[f] ?? f}>
            <Chip size="small" icon={<ScanLine size={10} />} label={f.replace(/_/g, " ")}
                  sx={{ height: 17, fontSize: 9.5,
                        bgcolor: alpha(theme.palette.warning.main, 0.14), color: "warning.main" }} />
          </Tooltip>
        ))}
      </Stack>
    </Paper>
  );
}

function ClaimCard({ claim, index }: { claim: EvidenceClaim; index: number }) {
  const theme = useTheme();
  const [open, setOpen] = useState(index === 0);
  const supports = claim.sources.filter((s) => s.stance === "supports").length;
  const opposes = claim.sources.filter((s) => s.stance === "opposes").length;

  return (
    <Paper component={motion.div} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
           sx={{ p: 1.6 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
        <ScoreChip score={claim.score} terms={claim.score_terms} />
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, flex: 1 }}>{claim.text}</Typography>
        <IconButton size="small" onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
        </IconButton>
      </Stack>

      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.6, mt: 0.85, alignItems: "center" }}>
        {supports > 0 && (
          <Tooltip title={`${plural(claim.independent_sources, "independent document")} behind this claim`}>
            <Chip size="small" icon={<Quote size={10} />} variant="outlined"
                  label={`${supports} supporting · ${claim.independent_sources} independent`}
                  sx={{ height: 19, fontSize: 10 }} />
          </Tooltip>
        )}
        {opposes > 0 && (
          <Chip size="small" color="error" variant="outlined" label={`${opposes} opposing`}
                sx={{ height: 19, fontSize: 10 }} />
        )}
        {claim.graph_facts.map((f, i) => (
          <Tooltip key={i} title={f.note || f.statement}>
            <Chip size="small" icon={<Network size={10} />}
                  label={f.meaningful ? "graph confirms" : "graph route flagged"}
                  sx={{ height: 19, fontSize: 10,
                        bgcolor: alpha(f.meaningful ? theme.palette.info.main : theme.palette.warning.main, 0.14),
                        color: f.meaningful ? "info.main" : "warning.main" }} />
          </Tooltip>
        ))}
      </Stack>

      {claim.note && (
        <Typography sx={{ fontSize: 11.5, color: "warning.main", mt: 0.75 }}>{claim.note}</Typography>
      )}

      <Collapse in={open}>
        <Stack spacing={1} sx={{ mt: 1.25 }}>
          {claim.graph_facts.map((f, i) => (
            <Paper key={i} sx={{ p: 1.25, bgcolor: alpha(theme.palette.info.main, 0.06) }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.4 }}>
                <Network size={12} />
                <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
                                  textTransform: "uppercase", color: "text.secondary" }}>
                  Knowledge graph
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 12.5 }}>{f.statement}</Typography>
              {f.note && (
                <Typography sx={{ fontSize: 11.5, mt: 0.5, color: f.meaningful ? "text.secondary" : "warning.main" }}>
                  {f.note}
                </Typography>
              )}
            </Paper>
          ))}
          {claim.sources.map((s, i) => <SourceRow key={i} s={s} />)}
          {!claim.sources.length && !claim.graph_facts.length && (
            <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>No evidence attached.</Typography>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}

/* --------------------------------------------------------------------- page */

export default function EvidencePage({ active }: { active: boolean }) {
  const theme = useTheme();
  const [status, setStatus] = useState<EvidenceStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<EvalQuestion | null>(null);
  const [holdout, setHoldout] = useState(false);
  // Which document categories the investigation may read. Empty is all of
  // them, which is what the server does with an empty list.
  const [categories, setCategories] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [calls, setCalls] = useState<EvidenceToolCall[]>([]);
  const [answer, setAnswer] = useState<EvidenceAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (active) evidence.status().then(setStatus).catch(() => setStatus(null));
  }, [active]);

  const engineCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const call of calls) c[call.engine] = (c[call.engine] ?? 0) + 1;
    return c;
  }, [calls]);

  async function run(text?: string) {
    const q = (text ?? question).trim();
    if (!q || running) return;
    setRunning(true); setCalls([]); setAnswer(null); setError(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      await askEvidence({ question: q, holdout, categories }, {
        toolCall: (c) => setCalls((cs) => [...cs, c]),
        answer: setAnswer,
        error: setError,
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
      controller.current = null;
    }
  }

  const blocked = status && !status.anthropic_key;

  return (
    <Box sx={{ height: "100%", overflow: "auto", bgcolor: "background.default" }}>
      <Box sx={{ maxWidth: 1080, mx: "auto", p: { xs: 2, md: 3 } }}>
        {/* header */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2.5 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 2, display: "grid", placeItems: "center",
                     bgcolor: "primary.main", color: "primary.contrastText" }}>
            <Scale size={18} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.15 }}>
              Evidence Agent
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
              One question, both engines. Every claim carries its sources and the arithmetic behind its score.
            </Typography>
          </Box>
        </Stack>

        {blocked && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No <code>ANTHROPIC_API_KEY</code> is set, so no question can be answered.
          </Alert>
        )}

        {/* ask */}
        <Paper sx={{ p: 2, mb: 2.5 }}>
          <TextField
            fullWidth multiline maxRows={4} value={question}
            onChange={(e) => { setQuestion(e.target.value); if (picked) setPicked(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }}
            placeholder="Ask anything about the corpus — or pick one of the 16 evaluation questions"
            slotProps={{ input: {
              sx: { fontSize: 15, alignItems: "flex-start" },
              startAdornment: <Box sx={{ pt: 0.35, pr: 1.25, color: "primary.main" }}><FlaskConical size={18} /></Box>,
            } }}
          />

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1.5 }}>
            <Autocomplete
              openOnFocus size="small" sx={{ flex: 1 }} value={picked} options={EVAL_QUESTIONS}
              groupBy={(q) => HALVES[q.half].title}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(q) => q.question}
              onChange={(_, q) => { setPicked(q); if (q) setQuestion(q.question); }}
              filterOptions={(opts, { inputValue }) => {
                const n = inputValue.trim().toLowerCase();
                return n ? opts.filter((q) => `${q.id} ${q.axis} ${q.question}`.toLowerCase().includes(n)) : opts;
              }}
              renderInput={(params) => (
                <TextField {...params} placeholder="Evaluation set — 16 questions"
                  slotProps={{ ...params.slotProps, input: { ...params.slotProps.input,
                    startAdornment: (<><Box sx={{ pl: 0.5, pr: 0.75, display: "flex", color: "text.secondary" }}>
                      <Search size={15} /></Box>{params.slotProps.input.startAdornment}</>) } }} />
              )}
              renderGroup={(params) => (
                <Box key={params.key} component="li" sx={{ listStyle: "none" }}>
                  <ListSubheader sx={{ bgcolor: "background.paper", lineHeight: "28px", fontSize: 10.5,
                                       fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase",
                                       color: "text.secondary", borderBottom: 1, borderColor: "divider" }}>
                    {params.group}
                  </ListSubheader>
                  <Box component="ul" sx={{ p: 0, m: 0 }}>{params.children}</Box>
                </Box>
              )}
              renderOption={(props, q) => {
                const { key, ...rest } = props as { key?: string } & Record<string, unknown>;
                return (
                  <Box component="li" key={q.id} {...rest} sx={{ display: "block !important", py: 0.85, px: 1.5 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.25 }}>
                      <Box component="span" sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10,
                        fontWeight: 800, px: 0.55, borderRadius: 0.75, color: "primary.main",
                        bgcolor: alpha(theme.palette.primary.main, 0.12) }}>{q.id}</Box>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: "text.secondary",
                                        textTransform: "uppercase", letterSpacing: ".04em" }}>{q.axis}</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 12.5, lineHeight: 1.4 }}>{q.question}</Typography>
                  </Box>
                );
              }}
              slotProps={{ paper: { sx: { width: { xs: "100%", md: 560 } } } }}
            />
            <Tooltip title="Pick one at random">
              <span><IconButton size="small" disabled={running}
                onClick={() => { const q = EVAL_QUESTIONS[Math.floor(Math.random() * EVAL_QUESTIONS.length)];
                                 setPicked(q); setQuestion(q.question); }}>
                <Dices size={16} /></IconButton></span>
            </Tooltip>
            {/* A native title, not a MUI Tooltip: a Tooltip renders above the
                open menu and would cover the options. */}
            {(status?.categories?.length ?? 0) > 0 && (
              <Select
                multiple
                size="small"
                displayEmpty
                value={categories}
                onChange={(e) =>
                  setCategories(typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value)
                }
                disabled={running}
                title="Which document categories the investigation may read. None selected reads all of them."
                renderValue={(picked) => (
                  <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
                    <Layers size={14} />
                    <span>{picked.length === 0 ? "All categories" : picked.join(", ")}</span>
                  </Stack>
                )}
                sx={{ fontSize: 13, minWidth: 140 }}
              >
                {(status?.categories ?? []).map((c) => (
                  <MenuItem key={c.code} value={c.code} disabled={c.chunks === 0} sx={{ py: 0.5 }}>
                    <Checkbox size="small" checked={categories.includes(c.code)} sx={{ mr: 0.5 }} />
                    <ListItemText
                      primary={c.code}
                      secondary={
                        c.chunks === 0
                          ? "empty"
                          : `${c.documents} document${c.documents === 1 ? "" : "s"} · ${c.chunks.toLocaleString()} chunks`
                      }
                      slotProps={{ primary: { sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11 } } }}
                    />
                  </MenuItem>
                ))}
              </Select>
            )}
            <Tooltip title="Hide the fit registers and blank FIT/GAP tokens, for an unbiased evaluation run">
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Switch size="small" checked={holdout} onChange={(e) => setHoldout(e.target.checked)} />
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>holdout</Typography>
              </Stack>
            </Tooltip>
            {running ? (
              <Button variant="outlined" color="error" startIcon={<Square size={15} />}
                      onClick={() => controller.current?.abort()}>Stop</Button>
            ) : (
              <Button variant="contained" disabled={!question.trim() || !!blocked}
                      startIcon={<SendHorizontal size={16} />} onClick={() => run()}>Investigate</Button>
            )}
          </Stack>

          {picked && (
            <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 1.25 }}>
              <b>{picked.id} · {picked.axis}</b> — {picked.tests}
            </Typography>
          )}
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* the investigation, live */}
        {calls.length > 0 && (
          <Paper sx={{ p: 1.75, mb: 2.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25 }}>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                Investigation · {plural(calls.length, "call")}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {Object.entries(engineCounts).map(([e, n]) => (
                <Tooltip key={e} title={ENGINE_HINT[e] ?? ""}>
                  <Chip size="small" variant="outlined" icon={ENGINE_ICON[e] ?? ENGINE_ICON.other}
                        label={`${ENGINE_NAME[e] ?? e} ${plural(n, "call")}`}
                        sx={{ height: 20, fontSize: 10.5 }} />
                </Tooltip>
              ))}
            </Stack>
            {running && <LinearProgress sx={{ height: 2, borderRadius: 2, mb: 1.25 }} />}
            <Stack spacing={0.5}>
              <AnimatePresence initial={false}>
                {calls.map((c, i) => (
                  <Stack key={i} component={motion.div} layout initial={{ opacity: 0, x: -6 }}
                         animate={{ opacity: 1, x: 0 }} direction="row" spacing={0.85}
                         sx={{ alignItems: "center", fontSize: 11.5,
                               color: c.error ? "error.main" : "text.secondary" }}>
                    <Box sx={{ display: "flex", color: ENGINE_COLOUR[c.engine] ?? ENGINE_COLOUR.other }}>
                      {ENGINE_ICON[c.engine] ?? ENGINE_ICON.other}
                    </Box>
                    {/* Which engine was asked, then which function of it. Without
                        the engine name, "search_corpus" and "graph_entity" read as
                        one undifferentiated list of internals. */}
                    <Stack direction="row" spacing={0.75}
                           sx={{ alignItems: "baseline", minWidth: 176, flexShrink: 0 }}>
                      <Tooltip title={ENGINE_HINT[c.engine] ?? ""}>
                        <Box component="span" sx={{
                          fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
                          color: ENGINE_COLOUR[c.engine] ?? ENGINE_COLOUR.other,
                          minWidth: 34, cursor: "help",
                        }}>
                          {ENGINE_NAME[c.engine] ?? c.engine.toUpperCase()}
                        </Box>
                      </Tooltip>
                      <Box component="span" sx={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                        {c.tool}
                      </Box>
                    </Stack>
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden",
                                                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.summary}
                    </Box>
                    {c.warning && (
                      <Tooltip title={c.warning}>
                        <Box sx={{ display: "flex", color: "warning.main" }}><TriangleAlert size={12} /></Box>
                      </Tooltip>
                    )}
                    <Box component="span" sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
                      {c.ms}ms
                    </Box>
                  </Stack>
                ))}
              </AnimatePresence>
            </Stack>
          </Paper>
        )}

        {/* the answer */}
        {answer && (
          <Paper component={motion.div} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                 sx={{ p: { xs: 1.75, md: 2.5 } }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }}>
              <StateBadge state={answer.state} />
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                {plural(answer.claims.length, "claim")} · {answer.tool_calls} calls ·{" "}
                {answer.seconds}s · {Math.round((answer.input_tokens + answer.output_tokens) / 1000)}k tokens
              </Typography>
            </Stack>

            <Typography sx={{ fontSize: 15, lineHeight: 1.65, mb: 2 }}>{answer.answer}</Typography>

            {answer.claims.length > 0 && (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25 }}>
                  <Quote size={14} />
                  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                    Claims and evidence
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="The weakest claim that actually asserts something governs the answer">
                    <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                      hover any score to see its arithmetic
                    </Typography>
                  </Tooltip>
                </Stack>
                <Stack spacing={1.25}>
                  {answer.claims.map((c, i) => <ClaimCard key={i} claim={c} index={i} />)}
                </Stack>
              </>
            )}

            {(answer.open_questions.length > 0 || answer.limits.length > 0) && <Divider sx={{ my: 2 }} />}

            {answer.open_questions.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <Stack direction="row" spacing={0.85} sx={{ alignItems: "center", mb: 0.75 }}>
                  <CircleHelp size={13} />
                  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                    Open questions
                  </Typography>
                </Stack>
                <Stack spacing={0.4}>
                  {answer.open_questions.map((q, i) => (
                    <Typography key={i} sx={{ fontSize: 12.5 }}>• {q}</Typography>
                  ))}
                </Stack>
              </Box>
            )}

            {answer.limits.length > 0 && (
              <Box>
                <Stack direction="row" spacing={0.85} sx={{ alignItems: "center", mb: 0.75 }}>
                  <Eye size={13} />
                  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                    What stopped it going further
                  </Typography>
                </Stack>
                <Stack spacing={0.4}>
                  {answer.limits.map((l, i) => (
                    <Typography key={i} sx={{ fontSize: 12.5, color: "text.secondary" }}>• {l}</Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>
        )}

        {/* idle */}
        {!answer && !running && !calls.length && (
          <Paper sx={{ p: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>Nothing asked yet</Typography>
            <Typography sx={{ fontSize: 13, color: "text.secondary", maxWidth: 660, mx: "auto" }}>
              The agent decides for itself which engine to use — the graph for identity and counting,
              hybrid retrieval for substance — then reports what it found as separate claims, each
              scored by a rule you can check. It will say <b>not in the corpus</b> rather than guess.
            </Typography>
            {status && (
              <Stack direction="row" useFlexGap sx={{ justifyContent: "center", flexWrap: "wrap", gap: 1, mt: 2 }}>
                <Chip size="small" variant="outlined" icon={<FileText size={13} />} label={status.model} />
                <Chip size="small" variant="outlined" icon={<GitBranch size={13} />}
                      label={`${status.tools.length} tools`} />
                <Tooltip title={status.hubs.map((h) => `${h.label} (${h.degree})`).join(" · ")}>
                  <Chip size="small" variant="outlined" icon={<Network size={13} />}
                        label={`${status.hubs.length} graph hubs filtered`} />
                </Tooltip>
                <Tooltip title={status.duplicate_groups.map((g) => g.join("  ↔  ")).join("\n")}>
                  <Chip size="small" variant="outlined" icon={<Copy size={13} />}
                        label={`${status.duplicate_groups.length} duplicate groups`} />
                </Tooltip>
              </Stack>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
}
