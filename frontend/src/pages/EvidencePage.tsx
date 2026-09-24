import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Collapse, Divider, IconButton,
  LinearProgress, ListSubheader, Paper, Stack, Switch,
  TextField, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban, BookOpen, ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleHelp, Copy, Dices, Eye,
  FileText, FlaskConical, GitBranch, History as HistoryIcon, Network, Quote, Scale,
  Brain, ScanLine, Search, SendHorizontal, Sigma, Square, Target, Trash2, TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import {
  api, askEvidence, evidence,
  type EvidenceToolSources,
  type AnswerState, type EvidenceAnswer, type EvidenceClaim, type EvidenceSource,
  type EvidenceMemory,
  type EvidenceRunSummary, type EvidenceStatus, type EvidenceToolCall, type ScoreTerm,
  type EvidenceRagHit,
  type Source, type Stance,
} from "../api";
import {
  CATEGORY_LABEL, EVAL_QUESTIONS, EVAL_QUESTIONS_BY_GROUP, HALVES, type EvalQuestion,
} from "../data/evalQuestions";
import { surface } from "../theme";
import { clearAdornment } from "../components/ClearAdornment";
import DocumentInspectorDrawer from "../components/DocumentInspectorDrawer";
import AgentTraceDrawer from "../components/AgentTraceDrawer";

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

/** The tooltip behind a log line's source chip: what was read, and -- for
 *  retrieval -- what it was allowed to read, so a narrow result is
 *  distinguishable from a narrow scope. */
function sourcesHint(s: EvidenceToolSources): string {
  if (s.kind === "postgres") {
    const hits = Object.entries(s.databases ?? {}).map(([where, n]) => `${where}: ${n}`).join(", ");
    const scope = (s.searched ?? []).join(", ");
    return [
      hits ? `Chunks returned from ${hits}` : "No chunk matched",
      scope ? `Searched: ${scope}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (s.kind === "graph") {
    const built = (s.built_from ?? []).join(", ");
    const touched = (s.categories ?? []).join(", ");
    return [
      "The knowledge graph is held in memory, not in a database",
      built ? `built from the ${built} Markdown` : "",
      touched ? `this result names ${touched} document node(s)` : "this result names no document nodes",
    ].filter(Boolean).join(" · ");
  }
  if (s.kind === "sheet") return "Read from the BPML spreadsheet, not from a database";
  return s.label;
}

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

/** "4 minutes ago", "yesterday", "12 Sep". A history strip is read to find one
 *  run among many, and an ISO timestamp is the one format that helps with
 *  neither. */
function when(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return plural(mins, "minute") + " ago";
  const hours = Math.round(mins / 60);
  if (hours < 24) return plural(hours, "hour") + " ago";
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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

function SourceRow({ s, onInspect, busy }: {
  s: EvidenceSource;
  onInspect: (s: EvidenceSource) => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const hue = useHue();
  const colour = hue(STANCE[s.stance].hue);
  const [copied, setCopied] = useState(false);
  return (
    <Paper
      role="button"
      tabIndex={0}
      onClick={() => onInspect(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onInspect(s); }
      }}
      sx={{
        p: 1.25,
        borderLeft: `3px solid ${colour}`,
        cursor: "pointer",
        transition: "background-color .15s ease, border-color .15s ease",
        "&:hover, &:focus-visible": {
          bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
          borderColor: (t) => alpha(t.palette.primary.main, 0.4),
        },
      }}
    >
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
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.quote); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <CircleCheck size={12} /> : <Copy size={12} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Open the document this quote came from">
          <IconButton size="small" sx={{ p: 0.25 }} aria-label="Open the source document"
                      onClick={(e) => { e.stopPropagation(); onInspect(s); }}>
            {busy ? <CircularProgress size={12} /> : <BookOpen size={12} />}
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

function ClaimCard({ claim, index, onInspect, busyChunk }: {
  claim: EvidenceClaim;
  index: number;
  onInspect: (s: EvidenceSource) => void;
  busyChunk: string | null;
}) {
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
          {claim.sources.map((s, i) => (
            <SourceRow key={i} s={s} onInspect={onInspect} busy={busyChunk === s.chunk_id} />
          ))}
          {!claim.sources.length && !claim.graph_facts.length && (
            <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>No evidence attached.</Typography>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}

/** How many notes a recorded run started from. Runs from before memory existed
 *  carry `{}`, which is neither on nor off — just older than the feature. */
function memoryNotes(run: { memory?: EvidenceMemory | Record<string, never> }): number {
  const m = run.memory;
  return m && "recalled" in m && m.used ? m.recalled : 0;
}

/* --------------------------------------------------------------------- page */

export default function EvidencePage({ active }: { active: boolean }) {
  const theme = useTheme();
  const [status, setStatus] = useState<EvidenceStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<EvalQuestion | null>(null);
  const [holdout, setHoldout] = useState(false);
  // Memory is off unless asked for. It changes what the agent is told before
  // it starts, so a run with it on is not the same experiment as one without,
  // and the row records which it was.
  const [useMemory, setUseMemory] = useState(false);
  const [memory, setMemory] = useState<EvidenceMemory | null>(null);
  // Every investigation reads the whole corpus; the category a chunk is filed
  // under is still reported on each tool call, but it is no longer a control.
  const [running, setRunning] = useState(false);
  const [calls, setCalls] = useState<EvidenceToolCall[]>([]);
  const [answer, setAnswer] = useState<EvidenceAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Past investigations. Every run is written to evidence_runs as it happens,
  // so this survives a reload, a restart and a closed tab -- which is the
  // whole point: an answer nobody can go back to is one nobody can check.
  const [history, setHistory] = useState<EvidenceRunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<string | null>(null);

  // --- citation traceability -------------------------------------------------
  // A claim's source names a chunk and quotes a sentence of it. That is enough
  // to check the arithmetic and not enough to check the reading: a quote can be
  // accurate and still mean something else in its paragraph. So a source opens
  // the document it came from, in the same inspector the Ask page uses.
  //
  // The chunk key is all the answer carries, so the passage behind it has to be
  // fetched. They are hydrated as a set rather than one at a time, because the
  // inspector pages through sources with prev/next and a half-filled list would
  // make that walk skip over the ones nobody had clicked yet.
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectSource, setInspectSource] = useState<Source | null>(null);
  const [inspectAll, setInspectAll] = useState<Source[]>([]);
  const [inspectQuote, setInspectQuote] = useState("");
  const [inspectBusy, setInspectBusy] = useState<string | null>(null);
  const chunkCache = useRef(new Map<string, Source>());

  // Every distinct chunk the answer cites, in the order the claims cite them.
  // This is the list the inspector walks, so it is the run's evidence, not one
  // claim's.
  const citedChunks = useMemo(() => {
    const seen: string[] = [];
    for (const c of answer?.claims ?? []) {
      for (const src of c.sources) {
        if (src.chunk_id && !seen.includes(src.chunk_id)) seen.push(src.chunk_id);
      }
    }
    return seen;
  }, [answer]);

  /** `walk` is the list the inspector pages through with prev/next. It
   *  defaults to the answer's citations, which is what a reader opening a
   *  claim wants; a passage opened from a retrieval trace passes that call's
   *  own ranking instead, so paging walks the eight results the agent saw
   *  rather than jumping into a different call's evidence. */
  const inspect = useCallback(async (src: EvidenceSource, walk?: string[]) => {
    if (!src.chunk_id) return;
    setInspectBusy(src.chunk_id);
    try {
      const wanted = walk?.length ? walk : citedChunks.length ? citedChunks : [src.chunk_id];
      const loaded = await Promise.all(wanted.map(async (id, i) => {
        const hit = chunkCache.current.get(id);
        if (hit) return { ...hit, n: i + 1 };
        try {
          const fetched = await api.chunk(id);
          chunkCache.current.set(id, fetched);
          return { ...fetched, n: i + 1 };
        } catch {
          // A chunk that no longer resolves is a real answer, not a blank:
          // re-indexing renumbers chunks, so an old run can cite one that is
          // gone. Say so in place rather than dropping it from the walk.
          return {
            n: i + 1, title: src.doc, section: src.heading_path,
            content: `> ${src.quote}\n\n*Chunk \`${id}\` is no longer in the index, so the document it came from cannot be opened. Re-indexing renumbers chunks; this citation is from before the last one. The quote above is what the run recorded.*`,
            category: "", score: 0, similarity: null, bm25: null,
            vector_rank: src.vector_rank, keyword_rank: src.keyword_rank,
            file: "", source_path: "", missing: true,
          } as Source & { missing: boolean };
        }
      }));
      setInspectAll(loaded);
      setInspectSource(loaded[Math.max(0, wanted.indexOf(src.chunk_id))] ?? loaded[0] ?? null);
      setInspectQuote(src.quote);
      setInspectOpen(true);
    } finally {
      setInspectBusy(null);
    }
  }, [citedChunks]);

  // Which call's evidence is open. The log says a call happened; this says what
  // it brought back, which is the question a reader has the moment they doubt
  // the answer.
  const [traceCall, setTraceCall] = useState<EvidenceToolCall | null>(null);

  // What the finished answer actually rests on, so a trace can mark the part of
  // its haul that carried a claim. Retrieval is keyed by chunk, the graph by
  // node and edge -- the two engines contribute different kinds of thing and
  // are credited separately rather than merged into one count.
  const citedGraph = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    for (const c of answer?.claims ?? []) {
      for (const f of c.graph_facts ?? []) {
        for (const n of f.node_ids ?? []) nodes.add(n);
        for (const e of f.edge_ids ?? []) edges.add(e);
      }
    }
    return { nodes: [...nodes], edges: [...edges] };
  }, [answer]);

  const openTraceChunk = useCallback((hit: EvidenceRagHit, walk: string[]) => {
    inspect(
      {
        chunk_id: hit.chunk_id,
        doc: hit.doc,
        heading_path: hit.heading_path,
        // The inspector locates a passage by looking for it in the document.
        // The head of the chunk is a better anchor than the whole of it: long
        // enough to be unique, short enough that a highlight lands on one
        // place rather than striping the page.
        quote: hit.text.slice(0, 300),
        stance: "context",
        score: hit.score,
        vector_rank: hit.vector_rank,
        keyword_rank: hit.keyword_rank,
        provenance: hit.provenance,
        provenance_note: hit.provenance_note,
        verified: null,
      } as EvidenceSource,
      walk,
    );
  }, [inspect]);

  const loadHistory = useCallback(() => {
    evidence.runs().then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    evidence.status().then(setStatus).catch(() => setStatus(null));
    loadHistory();
  }, [active, loadHistory]);

  // The toggle is offered only when there is something to offer. A switch that
  // silently does nothing is worse than one that is visibly unavailable and
  // says why -- the server is a separate process and is usually not running.
  const mem = status?.memory;
  const memoryOff = holdout || !mem?.available;
  const memoryTip = holdout
    ? "Memory is off under holdout. Holdout measures the agent against a corpus it cannot look "
      + "the answer up in, and an earlier run's answer arriving through memory would hand it back."
    : !mem?.configured
    ? "Memory is switched off: HINDSIGHT_URL is empty."
    : !mem.available
    ? `No memory server at ${mem.url} — ${mem.detail}. See docs/agent-memory.md.`
    : `Read what earlier investigations concluded, and write down what this one does. `
      + `${mem.memories ?? 0} memories in '${mem.bank}'. Memory steers the search; it is never `
      + `evidence and can never be cited.`;

  const engineCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const call of calls) c[call.engine] = (c[call.engine] ?? 0) + 1;
    return c;
  }, [calls]);

  async function run(text?: string) {
    const q = (text ?? question).trim();
    if (!q || running) return;
    setRunning(true); setCalls([]); setAnswer(null); setError(null);
    setRunId(null); setViewing(null); setNotSaved(null); setMemory(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      await askEvidence({ question: q, holdout, categories: [], memory: useMemory }, {
        run: (r) => { setRunId(r.id); setNotSaved(r.not_saved ?? null); },
        memory: setMemory,
        toolCall: (c) => setCalls((cs) => [...cs, c]),
        answer: setAnswer,
        error: setError,
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
      controller.current = null;
      // Whether it finished, failed or was stopped, the row exists and the
      // list should show it in the state it actually reached.
      loadHistory();
    }
  }

  /** Reopen a past investigation: the question, every tool call in the order
   *  it happened, and the answer as it was verified at the time. Nothing is
   *  re-run -- and nothing is re-billed. */
  async function open(id: string) {
    if (running) return;
    setError(null);
    try {
      const run = await evidence.run(id);
      setQuestion(run.question);
      setPicked(EVAL_QUESTIONS.find((q) => q.question === run.question) ?? null);
      setHoldout(run.holdout);
      const remembered = run.memory as EvidenceMemory | undefined;
      setMemory(remembered && "enabled" in remembered ? remembered : null);
      setUseMemory(!!remembered && "enabled" in remembered && remembered.enabled);
      setCalls(run.calls ?? []);
      setAnswer(run.answer);
      setRunId(run.id);
      setViewing(run.id);
      if (run.status === "failed" && run.error) setError(run.error);
      if (run.status === "abandoned") {
        setError("This investigation was interrupted — the browser went away before it finished. "
                 + "What it had done by then is below.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that investigation.");
    }
  }

  async function remove(id: string) {
    try {
      await evidence.deleteRun(id);
      if (viewing === id) { setViewing(null); setRunId(null); }
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that investigation.");
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
            placeholder={`Ask anything about the corpus — or pick one of the ${EVAL_QUESTIONS.length} evaluation questions`}
            slotProps={{ input: {
              sx: { fontSize: 15, alignItems: "flex-start" },
              startAdornment: <Box sx={{ pt: 0.35, pr: 1.25, color: "primary.main" }}><FlaskConical size={18} /></Box>,
              // Clears the picked evaluation question with it: the text and the
              // chip below it are the same choice shown twice.
              endAdornment: clearAdornment(question, () => { setQuestion(""); setPicked(null); },
                                           { size: 16, label: "Clear question", top: true }),
            } }}
          />

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1.5 }}>
            <Autocomplete
              openOnFocus size="small" sx={{ flex: 1 }} value={picked} options={EVAL_QUESTIONS_BY_GROUP}
              // Grouped by corpus first: which half of the corpus a question
              // needs is the coarser distinction, and a question that spans
              // both is a different kind of test from one that does not.
              groupBy={(q) => `${CATEGORY_LABEL[q.category]}  ·  ${HALVES[q.half].title}`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(q) => q.question}
              onChange={(_, q) => { setPicked(q); if (q) setQuestion(q.question); }}
              filterOptions={(opts, { inputValue }) => {
                const n = inputValue.trim().toLowerCase();
                return n ? opts.filter((q) => `${q.id} ${q.category} ${q.axis} ${q.question}`.toLowerCase().includes(n)) : opts;
              }}
              renderInput={(params) => (
                <TextField {...params} placeholder={`Evaluation set — ${EVAL_QUESTIONS.length} questions across PKG, DR and both`}
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
            <Tooltip title="Hide the fit registers and blank FIT/GAP tokens, for an unbiased evaluation run">
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Switch size="small" checked={holdout}
                        onChange={(e) => setHoldout(e.target.checked)} />
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>holdout</Typography>
              </Stack>
            </Tooltip>
            <Tooltip title={memoryTip}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center",
                                                        opacity: memoryOff ? 0.5 : 1 }}>
                <Switch size="small" checked={useMemory && !memoryOff} disabled={memoryOff}
                        onChange={(e) => setUseMemory(e.target.checked)} />
                <Stack direction="row" spacing={0.4} sx={{ alignItems: "center" }}>
                  <Brain size={13} />
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>memory</Typography>
                </Stack>
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

        {notSaved && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotSaved(null)}>
            This investigation is running but is <b>not being recorded</b> — {notSaved}. The answer
            below is real; it just will not be in the history afterwards.
          </Alert>
        )}

        {/* previous investigations */}
        {history.length > 0 && (
          <Paper sx={{ mb: 2.5, overflow: "hidden" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", p: 1.5, cursor: "pointer" }}
                   onClick={() => setHistoryOpen((o) => !o)}>
              <HistoryIcon size={15} color={theme.palette.text.secondary} />
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                Previous investigations
              </Typography>
              <Chip size="small" label={history.length} sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }} />
              <Box sx={{ flex: 1 }} />
              {!historyOpen && history[0] && (
                <Typography sx={{ fontSize: 11.5, color: "text.secondary", maxWidth: 420,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  latest: {history[0].question}
                </Typography>
              )}
              {historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Stack>
            <Collapse in={historyOpen}>
              <Divider />
              <Stack divider={<Divider />}>
                {history.map((h) => (
                  <Stack key={h.id} direction="row" spacing={1.25}
                         sx={{ alignItems: "flex-start", p: 1.25, cursor: running ? "default" : "pointer",
                               bgcolor: viewing === h.id ? alpha(theme.palette.primary.main, 0.07) : undefined,
                               "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
                         onClick={() => open(h.id)}>
                    <Box sx={{ pt: 0.25 }}>
                      {h.state ? STATES[h.state as AnswerState].icon
                               : <TriangleAlert size={15} color={theme.palette.warning.main} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                        {h.question}
                      </Typography>
                      {h.summary && (
                        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.25,
                                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.summary}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.5, flexWrap: "wrap" }}>
                        <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>{when(h.started_at)}</Typography>
                        {h.status !== "done" && (
                          <Chip size="small" variant="outlined"
                                color={h.status === "failed" ? "error" : "warning"}
                                label={h.status} sx={{ height: 16, fontSize: 9.5 }} />
                        )}
                        {h.holdout && <Chip size="small" variant="outlined" label="holdout"
                                            sx={{ height: 16, fontSize: 9.5 }} />}
                        {memoryNotes(h) > 0 && (
                          <Tooltip title={`Started from ${plural(memoryNotes(h), "note")} recalled from earlier investigations`}>
                            <Chip size="small" variant="outlined" icon={<Brain size={10} />}
                                  label={memoryNotes(h)}
                                  sx={{ height: 16, fontSize: 9.5, "& .MuiChip-icon": { ml: 0.4 } }} />
                          </Tooltip>
                        )}
                        <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>
                          {plural(h.tool_calls, "call")}
                          {h.claims ? ` · ${plural(h.claims, "claim")}` : ""}
                          {h.sources ? ` · ${plural(h.sources, "source")}` : ""}
                          {h.seconds ? ` · ${h.seconds.toFixed(1)}s` : ""}
                        </Typography>
                      </Stack>
                    </Box>
                    <Tooltip title="Delete this investigation">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); remove(h.id); }}
                                  sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            </Collapse>
          </Paper>
        )}

        {viewing && !running && (
          <Alert severity="info" icon={<HistoryIcon size={16} />} sx={{ mb: 2 }}
                 action={<Button size="small" onClick={() => run()}>Ask again</Button>}>
            Showing a recorded investigation from {when(history.find((h) => h.id === viewing)?.started_at ?? null)}
            {" "}(<code>{viewing}</code>). Nothing was re-run.
          </Alert>
        )}

        {/* what the agent was told before it started */}
        {memory && (memory.used || memory.suppressed_by_holdout) && (
          <Paper sx={{ p: 1.75, mb: 2.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: memory.recalled ? 1.25 : 0 }}>
              <Brain size={15} color={theme.palette.text.secondary} />
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                Memory · {memory.suppressed_by_holdout ? "not read" : plural(memory.recalled, "note")}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" variant="outlined" label="not evidence"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
            </Stack>
            {memory.suppressed_by_holdout ? (
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                Memory was requested but not read: this is a holdout run. Holdout measures the
                agent against a corpus it cannot look the answer up in, and an earlier run's
                answer arriving through memory would hand it back.
              </Typography>
            ) : memory.recalled === 0 ? (
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                Nothing was remembered about this question. The agent started from the corpus, as
                it always did.
              </Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
                  Notes from earlier investigations, given to the agent before its first search.
                  They steer where it looks. They are <b>not</b> evidence and cannot be cited: a
                  quote that is not in a chunk retrieved in this run is discarded, so nothing here
                  can reach an answer without being proved again from the corpus.
                </Typography>
                <Stack spacing={0.75}>
                  {memory.memories.map((m, i) => (
                    <Box key={m.id || i} sx={{ p: 1, borderRadius: 1.5, border: 1,
                                               borderColor: "divider", bgcolor: surface(theme, 0.5) }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
                        <Typography sx={{ fontSize: 10, fontWeight: 800, color: "text.disabled",
                                          textTransform: "uppercase", letterSpacing: ".04em" }}>
                          {m.type || "note"}
                        </Typography>
                        <Typography sx={{ fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</Typography>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </>
            )}
          </Paper>
        )}

        {/* the investigation, live */}
        {calls.length > 0 && (
          <Paper sx={{ p: 1.75, mb: 2.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.25 }}>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                Investigation · {plural(calls.length, "call")}
              </Typography>
              {runId && (
                <Tooltip title="The id this investigation is recorded under. It stays in the history after the tab is closed.">
                  <Box component="span" sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10,
                    fontWeight: 700, px: 0.55, borderRadius: 0.75, color: "text.secondary",
                    bgcolor: alpha(theme.palette.text.primary, 0.06) }}>{runId}</Box>
                </Tooltip>
              )}
              <Box sx={{ flex: 1 }} />
              {Object.entries(engineCounts).map(([e, n]) => (
                <Tooltip key={e} title={ENGINE_HINT[e] ?? ""}>
                  <Chip size="small" variant="outlined" icon={ENGINE_ICON[e] ?? ENGINE_ICON.other}
                        label={`${ENGINE_NAME[e] ?? e} ${plural(n, "call")}`}
                        sx={{ height: 20, fontSize: 10.5 }} />
                </Tooltip>
              ))}
            </Stack>
            {/* Whether these rows open anything, said once rather than left to
                be discovered. A run recorded before the log kept traces looks
                identical to one whose rows simply do nothing, and "the feature
                is not here" is the wrong conclusion to leave available. */}
            {calls.some((c) => c.trace) ? (
              <Typography sx={{ fontSize: 11, color: "text.disabled", mb: 1 }}>
                Click a call to see what it returned.
              </Typography>
            ) : !running && calls.length > 0 ? (
              <Typography sx={{ fontSize: 11, color: "text.disabled", mb: 1 }}>
                {calls.every((c) => c.error)
                  ? "Every call failed, so none of them returned evidence to show."
                  : "This run was recorded before the log kept what each call returned. Ask the question again to get a trace you can open."}
              </Typography>
            ) : null}
            {running && <LinearProgress sx={{ height: 2, borderRadius: 2, mb: 1.25 }} />}
            <Stack spacing={0.5}>
              <AnimatePresence initial={false}>
                {calls.map((c, i) => (
                  <Stack key={i} component={motion.div} layout initial={{ opacity: 0, x: -6 }}
                         animate={{ opacity: 1, x: 0 }} direction="row" spacing={0.85}
                         onClick={c.trace ? () => setTraceCall(c) : undefined}
                         role={c.trace ? "button" : undefined}
                         tabIndex={c.trace ? 0 : undefined}
                         onKeyDown={c.trace ? (e: ReactKeyboardEvent) => {
                           if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTraceCall(c); }
                         } : undefined}
                         sx={{ alignItems: "center", fontSize: 11.5,
                               color: c.error ? "error.main" : "text.secondary",
                               // Only a call that kept a trace is worth opening.
                               // A failed one, or one from a run recorded before
                               // traces existed, stays an ordinary log line
                               // rather than a button that opens an apology.
                               cursor: c.trace ? "pointer" : "default",
                               borderRadius: 0.75, px: 0.4, mx: -0.4,
                               transition: "background-color .12s",
                               "&:hover": c.trace
                                 ? { bgcolor: alpha(theme.palette.text.primary, 0.05) }
                                 : undefined,
                               "&:focus-visible": {
                                 outline: `2px solid ${theme.palette.primary.main}`,
                                 outlineOffset: 1,
                               } }}>
                    <Box sx={{ display: "flex", color: ENGINE_COLOUR[c.engine] ?? ENGINE_COLOUR.other }}>
                      {ENGINE_ICON[c.engine] ?? ENGINE_ICON.other}
                    </Box>
                    {/* Which engine was asked, then which function of it. Without
                        the engine name, "search_corpus" and "graph_entity" read as
                        one undifferentiated list of internals. */}
                    <Stack direction="row" spacing={0.75}
                           sx={{ alignItems: "baseline", minWidth: 176, flexShrink: 0 }}>
                      <Tooltip title={c.trace
                        ? `${ENGINE_HINT[c.engine] ?? ""}\n\nClick to see what this call returned.`
                        : (ENGINE_HINT[c.engine] ?? "")}>
                        <Box component="span" sx={{
                          fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
                          color: ENGINE_COLOUR[c.engine] ?? ENGINE_COLOUR.other,
                          minWidth: 34, cursor: c.trace ? "pointer" : "help",
                          textDecoration: c.trace ? "underline" : "none",
                          textDecorationStyle: "dotted",
                          textUnderlineOffset: 3,
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
                    {/* Which store answered. With the corpus split per
                        category, "rag" alone cannot say whether DR was read. */}
                    {c.sources?.label && (
                      <Tooltip title={sourcesHint(c.sources)}>
                        <Box component="span" sx={{
                          flexShrink: 0, maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, cursor: "help",
                          px: 0.6, py: 0.1, borderRadius: 0.75,
                          border: 1, borderColor: "divider", color: "text.secondary",
                        }}>
                          {c.sources.label}
                        </Box>
                      </Tooltip>
                    )}
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
                  {answer.claims.map((c, i) => (
                    <ClaimCard key={i} claim={c} index={i}
                               onInspect={inspect} busyChunk={inspectBusy} />
                  ))}
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

      {/* ---------- citation traceability ---------- */}
      <AgentTraceDrawer
        open={Boolean(traceCall)}
        onClose={() => setTraceCall(null)}
        call={traceCall}
        cited={citedChunks}
        citedNodes={citedGraph.nodes}
        citedEdges={citedGraph.edges}
        onOpenChunk={openTraceChunk}
      />

      <DocumentInspectorDrawer
        open={inspectOpen}
        onClose={() => setInspectOpen(false)}
        source={inspectSource}
        allSources={inspectAll}
        onSelectSource={setInspectSource}
        // The quote is what the reader is checking, so it is what gets marked --
        // not the question's keywords, which is what the Ask page marks because
        // there the excerpt itself is the unit being judged.
        locate={inspectQuote}
      />
    </Box>
  );
}
