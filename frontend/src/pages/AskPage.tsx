import {
  Alert, Box, Button, Chip, Fade, IconButton, InputAdornment, MenuItem, Paper, Popper, Select,
  Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Ban, Binary, BookOpen, BrainCircuit, Check, ChevronDown, CircleAlert, CircleCheck, Copy, Database, GitMerge, History as HistoryIcon, Lightbulb, LoaderCircle, MessageSquareText, Search, SendHorizontal, Sparkles, Square, TextSearch, Timer,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ask, api, askHistory, type CategoryInfo, type Done, type RagStatus, type SearchMode, type Source,
  type StepKey, type StepStatus,
} from "../api";
import Markdown, { highlightRegex } from "../components/Markdown";
import DocumentInspectorDrawer from "../components/DocumentInspectorDrawer";
import SampleQuestionsDrawer from "../components/SampleQuestionsDrawer";
import AskHistoryDrawer from "../components/AskHistoryDrawer";
import { searchColors, surface } from "../theme";
import { clearAdornment } from "../components/ClearAdornment";

interface Step {
  key: StepKey;
  name: string;
  tech: string;
  idle: string;
  icon: ReactNode;
  status: StepStatus;
  detail: string;
  ms?: number;
}

const STEPS: Omit<Step, "status" | "detail" | "ms">[] = [
  { key: "embed", name: "Embed question", tech: "Ollama · bge-m3", idle: "Turn the question into a 1024-d vector", icon: <Binary size={16} /> },
  { key: "vector", name: "Vector search", tech: "pgvector · cosine similarity", idle: "Chunks closest in meaning", icon: <BrainCircuit size={16} /> },
  { key: "keyword", name: "Keyword search", tech: "Postgres full text · BM25", idle: "Chunks containing the question's words and codes", icon: <TextSearch size={16} /> },
  { key: "fuse", name: "Merge rankings", tech: "Reciprocal rank fusion", idle: "Pick the best excerpts from both lists", icon: <GitMerge size={16} /> },
  { key: "answer", name: "Write answer", tech: "Claude", idle: "Answer only from the excerpts, with citations", icon: <Sparkles size={16} /> },
];

const freshSteps = (mode: SearchMode): Step[] =>
  STEPS.map((s) => {
    const skipped = (mode === "keyword" && (s.key === "embed" || s.key === "vector")) || (mode === "vector" && s.key === "keyword");
    return { ...s, status: skipped ? "skipped" : "pending", detail: skipped ? "Not used in this search mode" : s.idle };
  });

type SortKey = "score" | "similarity" | "bm25";

export default function AskPage({ active }: { active: boolean }) {
  const theme = useTheme();
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [k, setK] = useState(8);
  const [steps, setSteps] = useState<Step[]>(() => freshSteps("hybrid"));
  const [terms, setTerms] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [flash, setFlash] = useState<{ n: number; at: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bumped when a question finishes, so a reopened panel is never stale.
  const [historyKey, setHistoryKey] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<string | null>(null);
  // Set when the view is showing a recorded question rather than a live one.
  const [replay, setReplay] = useState<{ id: string; at: string | null; changed: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef("");
  const questionField = useRef<HTMLTextAreaElement | null>(null);

  // Refresh the index counts whenever the page is shown: a document may have
  // just been added from the Extract page.
  useEffect(() => {
    if (active) api.ragStatus().then(setStatus).catch(() => setStatus(null));
  }, [active]);

  // Every question reads the whole corpus. The category each document is filed
  // under is still recorded and still shown on a source, but it is no longer a
  // control: there is one index and a question is asked of all of it.
  const scope = useMemo<CategoryInfo[]>(
    () => (status?.categories ?? []).filter((c) => c.chunks > 0), [status]);
  const scoped = useMemo(
    () => scope.reduce((acc, c) => ({ documents: acc.documents + c.documents, chunks: acc.chunks + c.chunks }), { documents: 0, chunks: 0 }),
    [scope],
  );

  // Tokens arrive faster than it is worth re-rendering Markdown; flush a few
  // times a second.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (pending.current) {
        const chunk = pending.current;
        pending.current = "";
        setAnswer((a) => a + chunk);
      }
    }, 60);
    return () => clearInterval(t);
  }, [running]);

  async function executeAsk(overrideQuestion?: string) {
    const q = (typeof overrideQuestion === "string" ? overrideQuestion : question).trim();
    if (!q || running) return;
    if (typeof overrideQuestion === "string") setQuestion(overrideQuestion);
    setAsked(q);
    setSteps(freshSteps(mode));
    setTerms([]);
    setSources([]);
    setAnswer("");
    pending.current = "";
    setDone(null);
    setError(null);
    setRunning(true);
    setRunId(null);
    setNotSaved(null);
    setReplay(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    const fail = (message: string) => {
      setError(message);
      setSteps((ss) => {
        const i = ss.findIndex((s) => s.status === "running");
        const j = i >= 0 ? i : ss.findIndex((s) => s.status === "pending");
        return ss.map((s, n) => (n === j ? { ...s, status: "error", detail: message === "Stopped" ? "Stopped" : "Failed" } : s));
      });
    };
    try {
      await ask(
        { question: q, mode, k, categories: [] },
        {
          stage: (e) => {
            if (e.terms) setTerms(e.terms);
            setSteps((ss) => ss.map((s) => (s.key === e.key ? { ...s, status: e.status, detail: e.detail || s.detail, ms: e.ms ?? s.ms } : s)));
          },
          run: (r) => {
            setRunId(r.id);
            setNotSaved(r.not_saved ?? null);
          },
          sources: setSources,
          token: (t) => {
            pending.current += t;
          },
          done: (d) => {
            setDone(d);
            setHistoryKey((n) => n + 1);
          },
          error: fail,
        },
        ctrl.signal,
      );
    } catch (err) {
      fail((err as Error).name === "AbortError" ? "Stopped" : (err as Error).message);
    } finally {
      const rest = pending.current;
      pending.current = "";
      if (rest) setAnswer((a) => a + rest);
      controller.current = null;
      setRunning(false);
    }
  }

  const run = () => executeAsk();

  // Reopening a recorded question restores the view it produced -- the answer
  // and the excerpts it was written from -- rather than asking it again. The
  // pipeline panel is put back to "done" because this run did happen; what it
  // cannot honestly show is the per-stage timing, which was never recorded.
  const openRun = useCallback(async (id: string) => {
    setHistoryOpen(false);
    try {
      const r = await askHistory.run(id);
      controller.current?.abort();
      setQuestion(r.question);
      setAsked(r.question);
      setMode(r.mode);
      setK(r.k);
      setTerms(r.terms);
      setSources(r.sources);
      pending.current = "";
      setAnswer(r.answer);
      setError(r.error || (r.status === "abandoned" ? "This question was interrupted before it was answered." : null));
      setDone(r.status === "done"
        ? { seconds: r.seconds, input_tokens: r.input_tokens, output_tokens: r.output_tokens }
        : null);
      setSteps(freshSteps(r.mode).map((st) =>
        st.status === "skipped"
          ? st
          : { ...st, status: r.status === "done" || st.key !== "answer" ? "done" : "error",
              detail: st.key === "answer" && r.status !== "done" ? "Not finished" : st.idle }));
      setRunId(r.id);
      setNotSaved(null);
      setReplay({ id: r.id, at: r.started_at, changed: r.corpus_changed });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const askAgain = (q: string) => {
    setHistoryOpen(false);
    executeAsk(q);
  };

  // Picking a sample question drops it in the box and hands the reader the
  // caret, so it can be edited before it is asked. The arrow on a sample runs
  // it as it stands.
  const pickSample = (q: string) => {
    setQuestion(q);
    setSamplesOpen(false);
    requestAnimationFrame(() => {
      const el = questionField.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(q.length, q.length);
    });
  };

  const askSample = (q: string) => {
    setSamplesOpen(false);
    executeAsk(q);
  };

  const titles = useMemo(() => new Map(sources.map((s) => [s.n, s.title])), [sources]);
  const cited = useMemo(() => {
    const set = new Set<number>();
    for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) if (titles.has(Number(m[1]))) set.add(Number(m[1]));
    return set;
  }, [answer, titles]);
  const highlight = useMemo(() => highlightRegex(terms, asked), [terms, asked]);
  const sorted = useMemo(
    () => [...sources].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)),
    [sources, sort],
  );
  const maxScore = Math.max(0, ...sources.map((s) => s.score)) || 1;
  const maxBm25 = Math.max(0, ...sources.map((s) => s.bm25 ?? 0)) || 1;

  const cite = useCallback((n: number) => {
    const el = document.getElementById(`source-${n}`);
    el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    setFlash({ n, at: Date.now() });
  }, []);

  // ---------- Document Inspector & Hover Card State ----------
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [hoverCite, setHoverCite] = useState<{ n: number; anchorEl: HTMLElement } | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openInspector = useCallback((s: Source) => {
    setActiveSource(s);
    setInspectorOpen(true);
    setHoverCite(null);
  }, []);

  const openInspectorForN = useCallback((n: number) => {
    const s = sources.find((src) => src.n === n);
    if (s) {
      openInspector(s);
    } else {
      cite(n);
    }
  }, [sources, openInspector, cite]);

  // mouseover fires again for every node the cursor crosses inside the same
  // citation. Re-setting state each time would hand Popper a new object and
  // make it recompute its position mid-hover, which reads as jitter.
  const handleHoverCite = useCallback((n: number, anchorEl: HTMLElement) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setHoverCite((c) => (c && c.n === n && c.anchorEl === anchorEl ? c : { n, anchorEl }));
  }, []);

  // Leaving the citation does not close the card at once: the cursor has to
  // cross a few pixels of answer text to reach it, and the card cancels this
  // timer on mouseenter.
  const handleLeaveCite = useCallback((_n: number) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      setHoverCite(null);
    }, 280);
  }, []);

  useEffect(() => () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  // Every token flushed into the answer rebuilds the Markdown, which throws
  // away the button the card is anchored to. A detached anchor sends Popper to
  // the top-left corner, so drop the hover instead.
  useEffect(() => {
    if (hoverCite && !document.contains(hoverCite.anchorEl)) setHoverCite(null);
  }, [hoverCite, answer]);

  const scrollToSourceCard = useCallback((n: number) => {
    cite(n);
    setHoverCite(null);
  }, [cite]);

  const hoveredSource = useMemo(
    () => (hoverCite ? sources.find((s) => s.n === hoverCite.n) ?? null : null),
    [hoverCite, sources],
  );

  const problems: ReactNode[] = [];
  if (status?.missing.length) problems.push(<>Set {status.missing.join(", ")} in <code>.env</code> and restart the server.</>);
  if (status?.error) problems.push(<>Cannot read the index: {status.error}</>);
  else if (status && !status.missing.includes("DATABASE_URL") && !status.chunks)
    problems.push(<>The index is empty. Run <code>.venv/bin/python rag.py index solvay-spark/pkg/markdown</code> or add a document from the Extract page.</>);

  const answerModel = status?.answer_model ?? "Claude";
  const docsInSources = new Set(sources.map((s) => s.title)).size;
  const sourceCategories = useMemo(() => [...new Set(sources.map((s) => s.category))].sort(), [sources]);
  const colors = searchColors[theme.palette.mode];

  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Stack spacing={2.5} sx={{ maxWidth: 1280, mx: "auto", p: { xs: 2, md: 3 } }}>
        {problems.length > 0 && (
          <Alert severity="warning">
            {problems.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </Alert>
        )}

        {/* ---------- question ---------- */}
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 2.5,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            boxShadow: (t) =>
              t.palette.mode === "dark"
                ? "0 4px 20px -2px rgba(0, 0, 0, 0.4)"
                : "0 2px 10px -2px rgba(0, 0, 0, 0.04)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            "&:focus-within": {
              borderColor: (t) => alpha(t.palette.primary.main, 0.4),
              boxShadow: (t) =>
                t.palette.mode === "dark"
                  ? `0 6px 24px -2px rgba(0, 0, 0, 0.5), 0 0 0 2px ${alpha(t.palette.primary.main, 0.15)}`
                  : `0 4px 16px -2px rgba(0, 0, 0, 0.08), 0 0 0 2px ${alpha(t.palette.primary.main, 0.1)}`,
            },
          }}
        >
          {/* Header Row: Icon + Title on left, Corpus metrics chip on right */}
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.5 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: 1.5,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                color: "primary.main",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MessageSquareText size={16} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
              Ask the documents
            </Typography>
            <Box sx={{ flex: 1 }} />
            {status && !status.error && (
              <Tooltip
                title={
                  <>
                    Embeddings: Ollama {status.embed_model} ({status.embed_dimension || 1024}d) · Answers: {status.answer_model}
                    {scope.length > 0 && (
                      <>
                        <br />
                        {scope.map((c) => `${c.code}: ${c.documents} document${c.documents === 1 ? "" : "s"}`).join(" · ")}
                      </>
                    )}
                  </>
                }
              >
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<Database size={13} />}
                  label={`${scoped.chunks.toLocaleString()} chunks · ${scoped.documents} documents`}
                  sx={{
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                    fontSize: 11.5,
                    height: 26,
                    borderRadius: 1.5,
                    bgcolor: (t) => surface(t, 0.5),
                    borderColor: "divider",
                  }}
                />
              </Tooltip>
            )}
          </Stack>

          {/* Question Input */}
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={8}
            value={question}
            inputRef={questionField}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              }
            }}
            placeholder="Ask a question about the indexed documents..."
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ alignSelf: "flex-start", mt: 1.25, mr: 1 }}>
                    <Search size={18} color={theme.palette.text.secondary} />
                  </InputAdornment>
                ),
                endAdornment: clearAdornment(question, () => setQuestion(""),
                                             { size: 16, label: "Clear question", top: true }),
                sx: {
                  fontSize: 15,
                  alignItems: "flex-start",
                  borderRadius: 2,
                  bgcolor: (t) => (t.palette.mode === "dark" ? alpha(t.palette.background.default, 0.5) : "background.paper"),
                  transition: "all 0.15s ease",
                  "&.Mui-focused": {
                    borderColor: "primary.main",
                  },
                },
              },
            }}
          />

          {/* Action Row */}
          <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 1.5 }}>
            <Button
              variant="contained"
              onClick={run}
              disabled={!question.trim()}
              loading={running}
              loadingPosition="end"
              endIcon={<SendHorizontal size={15} />}
              sx={{
                borderRadius: 1.75,
                fontWeight: 700,
                fontSize: 13,
                height: 34,
                px: 2,
                textTransform: "none",
                boxShadow: (t) => `0 2px 8px ${alpha(t.palette.primary.main, 0.3)}`,
              }}
            >
              Ask
            </Button>

            <AnimatePresence>
              {running && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Button
                    color="inherit"
                    variant="outlined"
                    size="small"
                    startIcon={<Square size={13} />}
                    onClick={() => controller.current?.abort()}
                    sx={{ borderRadius: 1.75, height: 34, fontSize: 12.5, fontWeight: 650, textTransform: "none" }}
                  >
                    Stop
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              onChange={(_, v) => v && setMode(v)}
              disabled={running}
              sx={{
                height: 34,
                borderRadius: 1.75,
                "& .MuiToggleButton-root": {
                  textTransform: "none",
                  fontWeight: 650,
                  fontSize: 12,
                  px: 1.25,
                  gap: 0.6,
                },
              }}
            >
              <ToggleButton value="hybrid" title="Vector and keyword search, merged">
                <GitMerge size={14} /> Hybrid
              </ToggleButton>
              <ToggleButton value="vector" title="Closest in meaning only">
                <BrainCircuit size={14} /> Vector
              </ToggleButton>
              <ToggleButton value="keyword" title="Exact words and codes only">
                <TextSearch size={14} /> Keyword
              </ToggleButton>
            </ToggleButtonGroup>

            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600, fontSize: 12.5 }}>
                Excerpts
              </Typography>
              <Select
                size="small"
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
                disabled={running}
                sx={{
                  height: 34,
                  fontSize: 12.5,
                  fontWeight: 700,
                  borderRadius: 1.75,
                  bgcolor: (t) => surface(t, 0.4),
                  "& .MuiSelect-select": { py: 0.5, px: 1.25 },
                }}
              >
                {[5, 8, 12, 20].map((n) => (
                  <MenuItem key={n} value={n} sx={{ fontSize: 12.5 }}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </Stack>

            <Button
              color="inherit"
              variant="outlined"
              size="small"
              startIcon={<HistoryIcon size={14} />}
              onClick={() => setHistoryOpen(true)}
              sx={{ borderRadius: 1.75, height: 34, fontSize: 12.5, fontWeight: 650, textTransform: "none" }}
            >
              History
            </Button>

            <Button
              color="inherit"
              variant="outlined"
              size="small"
              startIcon={<Lightbulb size={14} />}
              onClick={() => setSamplesOpen(true)}
              sx={{ borderRadius: 1.75, height: 34, fontSize: 12.5, fontWeight: 650, textTransform: "none" }}
            >
              Sample questions
            </Button>

            <Box sx={{ flex: 1 }} />

            <Box
              sx={{
                display: { xs: "none", sm: "flex" },
                alignItems: "center",
                px: 1,
                py: 0.4,
                borderRadius: 1.25,
                border: 1,
                borderColor: "divider",
                bgcolor: (t) => surface(t, 0.5),
              }}
            >
              <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 700, color: "text.secondary" }}>
                ⌘/Ctrl + ↵ to ask
              </Typography>
            </Box>
          </Stack>
        </Paper>

        {/* A recorded question, reopened. Saying WHEN matters: the answer below
            is what the corpus said then, and if the corpus has been re-indexed
            since, asking again is not guaranteed to reproduce it. */}
        {replay && (
          <Alert
            severity={replay.changed ? "warning" : "info"}
            action={
              <Button color="inherit" size="small" onClick={() => executeAsk(asked)} disabled={running}>
                Ask again
              </Button>
            }
            sx={{ borderRadius: 2 }}
          >
            Showing a saved answer from {replay.at ? new Date(replay.at).toLocaleString() : "an earlier session"}.
            {replay.changed
              ? " The corpus has changed since it was written, so asking again may give a different answer."
              : " The corpus has not changed since it was written."}
          </Alert>
        )}

        {notSaved && (
          <Alert severity="warning" sx={{ borderRadius: 2 }} onClose={() => setNotSaved(null)}>
            This question is being answered but not recorded in the history: {notSaved}
          </Alert>
        )}

        {/* ---------- pipeline + answer ---------- */}
        <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "minmax(0,1fr)", md: "340px minmax(0,1fr)" }, alignItems: "start" }}>
          <Paper sx={{ overflow: "hidden" }}>
            <CardHead title="Pipeline" />
            <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, py: 1 }}>
              {steps.map((s, i) => (
                <PipelineStep key={s.key} step={{ ...s, tech: s.key === "embed" && status ? `Ollama ${status.embed_model} (${status.embed_dimension || 1024}d)` : s.key === "answer" ? answerModel : s.tech }} last={i === steps.length - 1} next={steps[i + 1]?.status} />
              ))}
            </Box>
            <AnimatePresence>
              {done && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", px: 2, py: 1.25, borderTop: 1, borderColor: "divider" }}>
                    <Chip size="small" icon={<Timer size={13} />} label={`${done.seconds}s total`} />
                    <Chip size="small" label={`${done.input_tokens.toLocaleString()} in`} />
                    <Chip size="small" label={`${done.output_tokens.toLocaleString()} out`} />
                    {runId && (
                      <Tooltip title="This question's id in the history. Saved automatically.">
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<HistoryIcon size={12} />}
                          label={runId}
                          onClick={() => setHistoryOpen(true)}
                          sx={{ fontFamily: "monospace", fontSize: 10.5 }}
                        />
                      </Tooltip>
                    )}
                  </Stack>
                </motion.div>
              )}
            </AnimatePresence>
          </Paper>

          <Paper sx={{ overflow: "hidden", minHeight: 260 }}>
            <CardHead
              title="Answer"
              actions={
                answer && !running ? (
                  <Tooltip title={copied ? "Copied" : "Copy answer"}>
                    <IconButton
                      size="small"
                      onClick={async () => {
                        await navigator.clipboard.writeText(answer);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </IconButton>
                  </Tooltip>
                ) : undefined
              }
            />
            <Box sx={{ p: 2.5 }}>
              {asked && (
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5, fontStyle: "italic" }}>
                  “{asked}”
                </Typography>
              )}
              {answer ? (
                <Box
                  sx={
                    running
                      ? {
                          "& > div > :last-child::after": {
                            content: '""', display: "inline-block", width: ".5em", height: "1em", ml: "2px", verticalAlign: "-2px",
                            bgcolor: "primary.main", animation: "caret 1s steps(1) infinite",
                          },
                          "@keyframes caret": { "50%": { opacity: 0 } },
                        }
                      : undefined
                  }
                >
                  <Markdown
                    source={answer}
                    citations={titles}
                    onCite={openInspectorForN}
                    onHoverCite={handleHoverCite}
                    onLeaveCite={handleLeaveCite}
                    sx={{ maxWidth: "80ch" }}
                  />
                </Box>
              ) : running && !error ? (
                <Stack spacing={1}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {sources.length ? `Waiting for ${answerModel}…` : "Retrieving excerpts…"}
                  </Typography>
                  {[92, 100, 78, 85].map((w, i) => (
                    <Skeleton key={i} variant="text" width={`${w}%`} />
                  ))}
                </Stack>
              ) : !error ? (
                <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", color: "text.secondary", py: 5 }}>
                  <Box sx={{ width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.primary.main, 0.1), color: "primary.main" }}>
                    <Sparkles size={24} />
                  </Box>
                  <Typography sx={{ fontWeight: 650, color: "text.primary" }}>Ask a question</Typography>
                  <Typography variant="body2" sx={{ maxWidth: "44ch" }}>
                    The answer is written only from the excerpts found in your documents, with numbered citations you can click.
                  </Typography>
                </Stack>
              ) : null}
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Alert severity={error === "Stopped" ? "info" : "error"} sx={{ mt: answer ? 2 : 0 }}>
                      {error}
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>
            </Box>
          </Paper>
        </Box>

        {/* ---------- sources ---------- */}
        <AnimatePresence>
          {sources.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Paper sx={{ overflow: "hidden" }}>
                <CardHead
                  title="Sources"
                  meta={`${sources.length} excerpts from ${docsInSources} document${docsInSources === 1 ? "" : "s"}${sourceCategories.length > 1 ? ` in ${sourceCategories.join(", ")}` : ""} · ${cited.size} cited`}
                  actions={
                    <ToggleButtonGroup size="small" exclusive value={sort} onChange={(_, v) => v && setSort(v)} aria-label="Sort sources">
                      <ToggleButton value="score" sx={{ px: 1.25, py: 0.3 }}>Combined</ToggleButton>
                      <ToggleButton value="similarity" sx={{ px: 1.25, py: 0.3 }}>Semantic</ToggleButton>
                      <ToggleButton value="bm25" sx={{ px: 1.25, py: 0.3 }}>Keyword</ToggleButton>
                    </ToggleButtonGroup>
                  }
                />
                <Stack direction="row" spacing={2.5} useFlexGap sx={{ flexWrap: "wrap", px: 2.5, pt: 1.5, color: "text.secondary", fontSize: 12.5 }}>
                  <Legend color={colors.combined} text="Combined: reciprocal rank fusion of both searches" />
                  <Legend color={colors.vector} text="Semantic: cosine similarity to the question" />
                  <Legend color={colors.keyword} text="Keyword: BM25 over the question's words" />
                  <Box component="span" sx={{ ml: "auto" }}>Highest first</Box>
                </Stack>
                <LayoutGroup>
                  <Box component="ol" sx={{ listStyle: "none", m: 0, p: 2.5, pt: 1.5, display: "grid", gap: 1.5 }}>
                    {sorted.map((s, i) => (
                      <SourceCard
                        key={s.n}
                        source={s}
                        index={i}
                        cited={cited.has(s.n)}
                        maxScore={maxScore}
                        maxBm25={maxBm25}
                        highlight={highlight}
                        flash={flash?.n === s.n ? flash.at : 0}
                        showCategory={scope.length > 1}
                        onInspect={openInspector}
                      />
                    ))}
                  </Box>
                </LayoutGroup>
              </Paper>
            </motion.div>
          )}
        </AnimatePresence>
      </Stack>

      {/* ---------- Citation Hover Card ----------
          A Popper, not a Popover. A Popover is a Modal: it lays an invisible
          backdrop over the whole viewport and locks the page scrollbar. The
          backdrop slides between the cursor and the citation the instant the
          card opens, so the citation fires mouseout, the card closes, the
          backdrop goes with it, the citation fires mouseover again -- the
          flicker loop the card was reported for. The scroll lock also shifts
          the page sideways on every open. A Popper has neither. */}
      <Popper
        open={Boolean(hoverCite && hoveredSource)}
        anchorEl={hoverCite?.anchorEl}
        placement="bottom"
        transition
        modifiers={[
          { name: "offset", options: { offset: [0, 8] } },
          { name: "preventOverflow", options: { padding: 12 } },
          { name: "flip", options: { padding: 12 } },
        ]}
        // The popper box itself must not take the pointer, or it becomes the
        // same trap the backdrop was; only the card inside it does.
        sx={{ zIndex: (t) => t.zIndex.tooltip, pointerEvents: "none" }}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={120}>
            <Paper
              elevation={0}
              onMouseEnter={() => {
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
              }}
              onMouseLeave={() => setHoverCite(null)}
              sx={{
                p: 2,
                width: 380,
                maxWidth: "calc(100vw - 32px)",
                borderRadius: 2.5,
                border: 1,
                borderColor: "divider",
                bgcolor: "background.paper",
                boxShadow: (t) =>
                  t.palette.mode === "dark"
                    ? "0 8px 32px rgba(0, 0, 0, 0.7)"
                    : "0 8px 24px rgba(0, 0, 0, 0.12)",
                pointerEvents: "auto",
              }}
            >
              {hoveredSource && (
          <Stack spacing={1.5}>
            {/* Header: [n] + Title + Category */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Chip
                size="small"
                label={`[${hoveredSource.n}]`}
                sx={{
                  fontWeight: 700,
                  fontSize: 12,
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                  color: "primary.main",
                  height: 22,
                }}
              />
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: 13.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {hoveredSource.title}
              </Typography>
              {hoveredSource.category && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={hoveredSource.category}
                  sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }}
                />
              )}
            </Stack>

            {/* Section & Metrics */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {hoveredSource.section || "(document start)"}
              </Typography>
              {hoveredSource.similarity != null && (
                <Typography variant="caption" sx={{ fontWeight: 650, color: "primary.main", fontVariantNumeric: "tabular-nums" }}>
                  {(hoveredSource.similarity * 100).toFixed(0)}% match
                </Typography>
              )}
            </Stack>

            {/* Snippet Preview */}
            <Typography
              variant="body2"
              sx={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "text.secondary",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                bgcolor: (t) => surface(t, 0.5),
                p: 1.25,
                borderRadius: 1.5,
              }}
            >
              {hoveredSource.content.replace(/^#+.*$/gm, "").trim()}
            </Typography>

            {/* Actions */}
            <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<BookOpen size={13} />}
                onClick={() => openInspector(hoveredSource)}
                sx={{
                  flex: 1,
                  height: 28,
                  fontSize: 11.5,
                  fontWeight: 650,
                  textTransform: "none",
                  borderRadius: 1.5,
                }}
              >
                Inspect in Document
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<ChevronDown size={13} />}
                onClick={() => scrollToSourceCard(hoveredSource.n)}
                sx={{
                  height: 28,
                  fontSize: 11.5,
                  fontWeight: 600,
                  textTransform: "none",
                  borderRadius: 1.5,
                  color: "text.secondary",
                }}
              >
                Jump to Card
              </Button>
            </Stack>
          </Stack>
              )}
            </Paper>
          </Fade>
        )}
      </Popper>

      {/* ---------- Document Inspector Drawer ---------- */}
      <DocumentInspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        source={activeSource}
        allSources={sources}
        onSelectSource={setActiveSource}
        highlight={highlight}
      />

      {/* ---------- Previous questions ---------- */}
      <AskHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenRun={openRun}
        onAskAgain={askAgain}
        reloadKey={historyKey}
        busy={running}
      />

      {/* ---------- Sample questions ---------- */}
      <SampleQuestionsDrawer
        open={samplesOpen}
        onClose={() => setSamplesOpen(false)}
        onPick={pickSample}
        onAsk={askSample}
        busy={running}
      />
    </Box>
  );
}

function CardHead({ title, meta, actions }: { title: string; meta?: string; actions?: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", px: 2.5, py: 1, minHeight: 46, borderBottom: 1, borderColor: "divider" }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
        {title}
      </Typography>
      {meta && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {actions}
    </Stack>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.75} component="span" sx={{ alignItems: "center" }}>
      <Box component="span" sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color }} />
      <span>{text}</span>
    </Stack>
  );
}

function PipelineStep({ step, last, next }: { step: Step; last: boolean; next?: StepStatus }) {
  const theme = useTheme();
  const { status } = step;
  const color =
    status === "done" ? theme.palette.success.main
      : status === "running" ? theme.palette.primary.main
        : status === "error" ? theme.palette.error.main
          : theme.palette.text.disabled;
  const icon =
    status === "done" ? <CircleCheck size={22} />
      : status === "error" ? <CircleAlert size={22} />
        : status === "skipped" ? <Ban size={20} />
          : status === "running" ? (
            <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}>
              <LoaderCircle size={22} />
            </motion.span>
          ) : (
            <Box sx={{ display: "flex", color: "text.disabled" }}>{step.icon}</Box>
          );
  // The line to the next step fills once this one is done.
  const filled = status === "done" && next !== "pending";

  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: "28px 1fr auto", columnGap: 1.25, px: 2, py: 1.1, position: "relative", opacity: status === "skipped" ? 0.5 : 1 }}>
      {!last && (
        <Box sx={{ position: "absolute", left: 29, top: 40, bottom: -6, width: 2, bgcolor: "divider", overflow: "hidden", borderRadius: 1 }}>
          <motion.div
            initial={false}
            animate={{ scaleY: filled ? 1 : 0 }}
            transition={{ duration: 0.4 }}
            style={{ originY: 0, height: "100%", background: theme.palette.success.main }}
          />
        </Box>
      )}
      <Box sx={{ position: "relative", width: 28, height: 28, display: "grid", placeItems: "center", color }}>
        {status === "running" && (
          <Box
            component={motion.span}
            animate={{ scale: [1, 1.6], opacity: [0.45, 0] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
            sx={{ position: "absolute", inset: 2, borderRadius: "50%", bgcolor: alpha(theme.palette.primary.main, 0.35) }}
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            style={{ display: "flex", position: "relative" }}
          >
            {icon}
          </motion.span>
        </AnimatePresence>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 14, lineHeight: 1.3 }}>{step.name}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {step.tech}
        </Typography>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step.detail} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <Typography variant="body2" sx={{ fontSize: 12.5, mt: 0.25, color: status === "running" ? "text.primary" : "text.secondary", overflowWrap: "anywhere" }}>
              {step.detail}
            </Typography>
          </motion.div>
        </AnimatePresence>
      </Box>
      <AnimatePresence>
        {step.ms != null && (
          <motion.div initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {step.ms >= 1000 ? `${(step.ms / 1000).toFixed(1)} s` : `${step.ms} ms`}
            </Typography>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
}

function ScoreBar({ label, value, fraction, color, empty }: { label: string; value: string; fraction: number; color: string; empty?: boolean }) {
  return (
    <Box sx={{ opacity: empty ? 0.55 : 1, fontSize: 12.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
        <span>{label}</span>
        <Box component="b" sx={{ color: "text.primary", fontWeight: 650 }}>
          {value}
        </Box>
      </Stack>
      <Box sx={{ height: 6, borderRadius: 3, bgcolor: "divider", overflow: "hidden", mt: 0.5 }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ height: "100%", borderRadius: 3, background: color }}
        />
      </Box>
    </Box>
  );
}

function SourceCard({ source: s, index, cited, maxScore, maxBm25, highlight, flash, showCategory, onInspect }: {
  source: Source; index: number; cited: boolean; maxScore: number; maxBm25: number; highlight: RegExp | null;
  flash: number; showCategory: boolean; onInspect?: (s: Source) => void;
}) {
  const theme = useTheme();
  const colors = searchColors[theme.palette.mode];
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(true);
  const excerpt = useRef<HTMLDivElement>(null);

  // A long excerpt opens its preview at the first matched code (or else the
  // first match): in a 30-row table the answering row is rarely the first.
  // Runs after every render, not just on new content: re-sorting moves DOM
  // nodes, which resets their scroll position. The preview itself cannot be
  // scrolled by hand, so nothing is overridden.
  useLayoutEffect(() => {
    const box = excerpt.current;
    if (!box) return;
    setOverflows(box.scrollHeight > 200);
    if (open) {
      box.scrollTop = 0;
      return;
    }
    const target = box.querySelector("mark.key") ?? box.querySelector("mark");
    if (!target) return;
    const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = offset > 130 ? offset - 50 : 0;
  });

  return (
    <Box
      component={motion.li}
      id={`source-${s.n}`}
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: "spring", stiffness: 400, damping: 35 }, delay: index * 0.04 }}
      sx={{
        position: "relative", scrollMarginTop: 16, border: 1, borderRadius: 3, p: 2, display: "grid", gap: 1.5,
        borderColor: cited ? alpha(theme.palette.success.main, 0.5) : "divider",
        bgcolor: "background.paper",
        transition: "border-color .2s",
        "&:hover": { borderColor: cited ? "success.main" : "text.disabled" },
      }}
    >
      {/* Pulses when the card is reached from a citation in the answer. */}
      {flash > 0 && (
        <Box
          key={flash}
          component={motion.span}
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          sx={{ position: "absolute", inset: -3, borderRadius: 3.5, border: 3, borderColor: "primary.main", pointerEvents: "none" }}
        />
      )}
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: "none", fontSize: 12, fontWeight: 750, color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.12), borderRadius: 1.5, px: 0.9, py: 0.2, mt: 0.2 }}>
          [{s.n}]
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 650, overflowWrap: "anywhere" }}>{s.title}</Typography>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {/* Only when more than one category exists: otherwise it says the
                same thing on every card. */}
            {showCategory && (
              <Chip size="small" variant="outlined" label={s.category} sx={{ height: 19, fontSize: 11, fontWeight: 650 }} />
            )}
            <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
              {s.section || "(start of document)"}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <AnimatePresence>
            {cited && (
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                <Chip size="small" color="success" variant="outlined" icon={<Check size={13} />} label="Cited" />
              </motion.div>
            )}
          </AnimatePresence>
          {onInspect && (
            <Tooltip title="Inspect in full document">
              <IconButton
                size="small"
                onClick={() => onInspect(s)}
                sx={{
                  borderRadius: 1.5,
                  color: "primary.main",
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                  "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.16) },
                  width: 28,
                  height: 28,
                }}
              >
                <BookOpen size={15} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <ScoreBar label="Combined" value={s.score.toFixed(4)} fraction={s.score / maxScore} color={colors.combined} />
        <ScoreBar
          label={`Semantic${s.vector_rank ? ` · #${s.vector_rank}` : ""}`}
          value={s.similarity == null ? "not in top 40" : s.similarity.toFixed(3)}
          fraction={s.similarity ?? 0}
          color={colors.vector}
          empty={s.similarity == null}
        />
        <ScoreBar
          label={`Keyword${s.keyword_rank ? ` · #${s.keyword_rank}` : ""}`}
          value={s.bm25 == null ? "no match" : s.bm25.toFixed(2)}
          fraction={(s.bm25 ?? 0) / maxBm25}
          color={colors.keyword}
          empty={s.bm25 == null}
        />
      </Box>

      <Box
        ref={excerpt}
        component={motion.div}
        initial={false}
        animate={{ maxHeight: open || !overflows ? 4000 : 200 }}
        transition={{ duration: 0.35, ease: "easeInOut" }}
        sx={{
          overflow: "hidden", borderRadius: 2, bgcolor: "background.default", px: 1.75, py: 1.25,
          maskImage: open || !overflows ? "none" : "linear-gradient(#000 calc(100% - 44px), transparent)",
        }}
      >
        <Markdown source={s.content} highlight={highlight} dense />
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        {overflows ? (
          <Button
            size="small"
            color="inherit"
            onClick={() => setOpen(!open)}
            sx={{ justifySelf: "start", color: "text.secondary", textTransform: "none", fontSize: 12.5 }}
            endIcon={
              <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: "flex" }}>
                <ChevronDown size={15} />
              </motion.span>
            }
          >
            {open ? "Show less" : "Show full text"}
          </Button>
        ) : (
          <Box />
        )}
        {onInspect && (
          <Button
            size="small"
            variant="text"
            color="primary"
            startIcon={<BookOpen size={14} />}
            onClick={() => onInspect(s)}
            sx={{ textTransform: "none", fontSize: 12.5, fontWeight: 650 }}
          >
            Inspect in document
          </Button>
        )}
      </Stack>
    </Box>
  );
}
