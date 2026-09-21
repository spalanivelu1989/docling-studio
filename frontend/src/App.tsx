import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, Tab, Tabs, ThemeProvider, Toolbar, Tooltip, Typography } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Columns2, DatabaseZap, FileText, FlaskConical, FolderArchive, MessageSquareText, Moon, Network, ScanEye, Scale, Sun } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import AddToKnowledgeBasePage from "./pages/AddToKnowledgeBasePage";
import AskPage from "./pages/AskPage";
import BatchConvertPage from "./pages/BatchConvertPage";
import DocMdViewerPage from "./pages/DocMdViewerPage";
import EvidencePage from "./pages/EvidencePage";
import ExtractPage from "./pages/ExtractPage";
import FitGapPage from "./pages/FitGapPage";
import KnowledgeGraphPage from "./pages/KnowledgeGraphPage";
import LandingPage from "./pages/LandingPage";
import MdViewerPage from "./pages/MdViewerPage";
import { makeTheme, searchColors, type Mode } from "./theme";

type Page = "ask" | "graph" | "evidence" | "fitgap" | "extract" | "batch" | "add-kb" | "review" | "viewer" | "landing";
/** The header reads left to right as the pipeline actually runs: ask the
 *  corpus, convert documents into it, index them, then check the conversion.
 *  Each stage carries its own accent so the bar can be scanned rather than
 *  read. */
type TabGroup = "engine" | "convert" | "index" | "inspect";

const TABS: { value: Page; label: string; icon: ReactElement; group: TabGroup }[] = [
  // The order a question escalates through them: one engine, the other
  // engine, an agent over both, then the agent that writes a register.
  { value: "ask", label: "Ask RAG", icon: <MessageSquareText size={16} />, group: "engine" },
  { value: "graph", label: "Knowledge Graph", icon: <Network size={16} />, group: "engine" },
  { value: "evidence", label: "Agent", icon: <FlaskConical size={16} />, group: "engine" },
  { value: "fitgap", label: "Fit-Gap Copilot", icon: <Scale size={16} />, group: "engine" },
  { value: "extract", label: "Convert", icon: <FileText size={16} />, group: "convert" },
  { value: "batch", label: "Batch Convert", icon: <FolderArchive size={16} />, group: "convert" },
  { value: "add-kb", label: "Add to knowledge base", icon: <DatabaseZap size={16} />, group: "index" },
  { value: "review", label: "Doc vs MD", icon: <ScanEye size={16} />, group: "inspect" },
  { value: "viewer", label: "MD Viewer", icon: <Columns2 size={16} />, group: "inspect" },
];

const groupOf = (p: Page): TabGroup | null =>
  TABS.find((t) => t.value === p)?.group ?? null;

/** Every accent comes from the theme, so each one has a light and a dark
 *  variant and none is hardcoded. Amber, green and purple are far enough
 *  apart in hue to survive being laid down at 6% opacity. */
function groupAccent(th: Theme, group: TabGroup): string {
  const purple = th.palette.mode === "dark" ? searchColors.dark.keyword : searchColors.light.keyword;
  return {
    engine: th.palette.primary.main,
    convert: th.palette.warning.main,
    index: th.palette.success.main,
    inspect: purple,
  }[group];
}

/** Amber and green read louder than blue at the same opacity, so each tint is
 *  nudged to look equally faint rather than to be numerically equal. */
const TINT: Record<TabGroup, number> = {
  engine: 0.055,
  convert: 0.05,
  index: 0.05,
  inspect: 0.06,
};

/** Label opacity, per group and per theme. The dark palette's amber (#fbbf24)
 *  and green (#4ade80) are far brighter than its blue and purple, so at equal
 *  opacity those two labels shout while the others murmur. Damping them is
 *  what makes the four groups read as peers. The light palette's accents are
 *  dark and saturated already, so they need no correction.
 */
const LABEL_ALPHA: Record<"light" | "dark", Record<TabGroup, number>> = {
  light: { engine: 0.82, convert: 0.82, index: 0.82, inspect: 0.82 },
  dark: { engine: 0.8, convert: 0.62, index: 0.62, inspect: 0.76 },
};

const PATHS: Record<Page, string> = {
  ask: "/ask",
  graph: "/graph",
  evidence: "/evidence",
  fitgap: "/fit-gap",
  extract: "/convert",
  batch: "/batch",
  "add-kb": "/add-kb",
  review: "/review",
  viewer: "/md-viewer",
  landing: "/",
};

const pageFromPath = (): Page => {
  if (location.pathname.startsWith("/convert") || location.pathname.startsWith("/extract")) return "extract";
  if (location.pathname.startsWith("/batch")) return "batch";
  if (location.pathname.startsWith("/add-kb") || location.pathname.startsWith("/add-to-knowledge-base")) return "add-kb";
  if (location.pathname.startsWith("/graph") || location.pathname.startsWith("/knowledge-graph")) return "graph";
  if (location.pathname.startsWith("/fit-gap") || location.pathname.startsWith("/fitgap")) return "fitgap";
  if (location.pathname.startsWith("/evidence") || location.pathname.startsWith("/investigate")) return "evidence";
  if (location.pathname.startsWith("/ask")) return "ask";
  if (location.pathname.startsWith("/md-viewer") || location.pathname.startsWith("/viewer")) return "viewer";
  if (location.pathname.startsWith("/review") || location.pathname.startsWith("/doc-md-viewer")) return "review";
  if (location.pathname.startsWith("/about") || location.pathname.startsWith("/landing")) return "landing";
  return "landing";
};

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* private mode */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [page, setPage] = useState<Page>(pageFromPath);
  const theme = useMemo(() => makeTheme(mode), [mode]);
  const activeGroup = groupOf(page);
  // The Fit-Gap page hands a ticket or system name to the Graph page. The
  // nonce makes a repeat of the same text re-run the query.
  const [graphQuery, setGraphQuery] = useState<{ text: string; nonce: number } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem("theme", mode);
    } catch {
      /* private mode */
    }
  }, [mode]);

  useEffect(() => {
    const onPop = () => setPage(pageFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title =
      page === "landing"
        ? "Docling Studio — Enterprise Document Intelligence"
        : page === "ask"
          ? "Docling Ask"
          : page === "viewer"
            ? "Docling MD Viewer"
            : page === "batch"
              ? "Docling Batch Convert"
              : page === "add-kb"
                ? "Docling Add to Knowledge Base"
                : page === "graph"
                  ? "Docling Knowledge Graph"
                  : page === "fitgap"
                    ? "Docling Fit-Gap Copilot"
                    : page === "evidence"
                      ? "Docling Agent"
                      : page === "review"
                        ? "Docling Doc vs MD Review"
                        : "Docling Convert Studio";
  }, [page]);

  const go = (next: Page) => {
    if (next === page) return;
    history.pushState(null, "", PATHS[next]);
    setPage(next);
  };

  const showInGraph = (text: string) => {
    setGraphQuery({ text, nonce: Date.now() });
    go("graph");
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* The resize handle between split panes. */}
      <GlobalStyles
        styles={(t) => ({
          ".pane-separator": { width: 6, background: t.palette.divider, cursor: "col-resize", transition: "background .15s", outline: "none" },
          ".pane-separator:hover, .pane-separator:focus-visible, .pane-separator[data-separator='active'], .pane-separator[data-separator='hover']": {
            background: t.palette.primary.main,
          },
        })}
      />
      {/* Honour the OS "reduce motion" setting for every animation below. */}
      <MotionConfig reducedMotion="user">
        <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
          <AppBar
            position="static"
            color="default"
            elevation={0}
            sx={{
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
            }}
          >
            <Toolbar variant="dense" disableGutters sx={{ minHeight: 52, px: 2, gap: 2 }}>
              {/* Brand Logo & Title — Clickable link to Landing Page */}
              <Tooltip title="Home / About Docling Studio">
                <Box
                  onClick={() => go("landing")}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    cursor: "pointer",
                    userSelect: "none",
                    "&:hover": { opacity: 0.8 },
                    transition: "opacity 0.15s ease",
                  }}
                >
                  <Box
                    component={motion.div}
                    whileHover={{ rotate: -8, scale: 1.08 }}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: 2,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                    }}
                  >
                    <FileText size={16} />
                  </Box>
                  <Typography sx={{ fontWeight: 700, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>
                    Docling{" "}
                    <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                      Studio
                    </Box>
                  </Typography>
                </Box>
              </Tooltip>

              {/* Nine tabs overflow a laptop window, so the bar scrolls rather
                  than clipping the last one. */}
              {/* Two groups, told apart by colour rather than by a label —
                  horizontal space is already tight. The four answering
                  surfaces are tinted and carry the accent; the document tools
                  stay neutral. A rule separates them. */}
              <Tabs
                value={page === "landing" ? false : page}
                onChange={(_, v) => go(v)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={(th) => ({
                  minHeight: 52,
                  flex: 1,
                  minWidth: 0,
                  "& .MuiTab-root": { minHeight: 52, py: 0, px: 1.5, minWidth: 0 },
                  "& .MuiTabs-scrollButtons.Mui-disabled": { opacity: 0.25 },
                  // The indicator is one shared element, so it takes the colour
                  // of whichever group is currently open.
                  "& .MuiTabs-indicator": {
                    backgroundColor: activeGroup ? groupAccent(th, activeGroup) : th.palette.text.secondary,
                  },
                })}
              >
                {TABS.map(({ value, label, icon, group }, i) => {
                  const opensGroup = TABS[i - 1] && TABS[i - 1].group !== group;
                  return (
                    <Tab
                      key={value}
                      value={value}
                      label={label}
                      icon={icon}
                      iconPosition="start"
                      sx={(th) => {
                        const accent = groupAccent(th, group);
                        const tint = TINT[group];
                        return {
                          color: alpha(accent, LABEL_ALPHA[th.palette.mode][group]),
                          bgcolor: alpha(accent, tint),
                          "&.Mui-selected": {
                            color: accent,
                            bgcolor: alpha(accent, tint + 0.05),
                          },
                          "&:hover": { bgcolor: alpha(accent, tint + 0.04) },
                          ...(opensGroup && {
                            ml: 0.75,
                            borderLeft: `1px solid ${th.palette.divider}`,
                          }),
                        };
                      }}
                    />
                  );
                })}
              </Tabs>
              <Tooltip title={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}>
                <IconButton onClick={() => setMode(mode === "dark" ? "light" : "dark")} aria-label="Switch theme">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={mode}
                      initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                      animate={{ rotate: 0, opacity: 1, scale: 1 }}
                      exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.2 }}
                      style={{ display: "flex" }}
                    >
                      {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                    </motion.span>
                  </AnimatePresence>
                </IconButton>
              </Tooltip>
            </Toolbar>
          </AppBar>

          {/* All pages stay mounted so switching tabs keeps an upload, its
              Markdown or an answer in place. */}
          <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
            {(["ask", "graph", "evidence", "fitgap", "extract", "batch", "add-kb", "review", "viewer", "landing"] as Page[]).map((p) => (
              <Box
                key={p}
                component={motion.div}
                initial={false}
                animate={page === p ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                sx={{ position: "absolute", inset: 0, display: page === p ? "block" : "none" }}
              >
                {p === "extract" ? (
                  <ExtractPage onAsk={() => go("ask")} />
                ) : p === "batch" ? (
                  <BatchConvertPage />
                ) : p === "add-kb" ? (
                  <AddToKnowledgeBasePage active={page === "add-kb"} />
                ) : p === "graph" ? (
                  <KnowledgeGraphPage active={page === "graph"} onNavigate={(next) => go(next as Page)} incomingQuery={graphQuery} />
                ) : p === "fitgap" ? (
                  <FitGapPage active={page === "fitgap"} onShowInGraph={showInGraph} />
                ) : p === "evidence" ? (
                  <EvidencePage active={page === "evidence"} />
                ) : p === "review" ? (
                  <DocMdViewerPage />
                ) : p === "viewer" ? (
                  <MdViewerPage />
                ) : p === "landing" ? (
                  <LandingPage onNavigate={(next) => go(next)} />
                ) : (
                  <AskPage active={page === "ask"} />
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </MotionConfig>
    </ThemeProvider>
  );
}
