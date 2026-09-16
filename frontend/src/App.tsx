import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, Tab, Tabs, ThemeProvider, Toolbar, Tooltip, Typography } from "@mui/material";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { FileText, MessageSquareText, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AskPage from "./pages/AskPage";
import ExtractPage from "./pages/ExtractPage";
import { makeTheme, type Mode } from "./theme";

type Page = "extract" | "ask";
const PATHS: Record<Page, string> = { extract: "/", ask: "/ask" };
const pageFromPath = (): Page => (location.pathname.startsWith("/ask") ? "ask" : "extract");

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
    document.title = page === "ask" ? "Docling Ask" : "Docling Extraction Studio";
  }, [page]);

  const go = (next: Page) => {
    if (next === page) return;
    history.pushState(null, "", PATHS[next]);
    setPage(next);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* The resize handle between the Extract page's panes. */}
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
        <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <AppBar position="static" color="inherit" sx={{ flex: "none" }}>
            <Toolbar variant="dense" sx={{ gap: 2, minHeight: 52 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  component={motion.div}
                  whileHover={{ rotate: -8, scale: 1.08 }}
                  sx={{
                    width: 28, height: 28, borderRadius: 2, display: "grid", placeItems: "center",
                    bgcolor: "primary.main", color: "primary.contrastText",
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
              <Tabs
                value={page}
                onChange={(_, v) => go(v)}
                sx={{ minHeight: 52, "& .MuiTab-root": { minHeight: 52, py: 0, px: 1.5, minWidth: 0 } }}
              >
                <Tab value="extract" label="Extract" icon={<FileText size={16} />} iconPosition="start" />
                <Tab value="ask" label="Ask" icon={<MessageSquareText size={16} />} iconPosition="start" />
              </Tabs>
              <Box sx={{ flex: 1 }} />
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

          {/* Both pages stay mounted so switching tabs keeps an upload, its
              Markdown or an answer in place. */}
          <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
            {(["extract", "ask"] as Page[]).map((p) => (
              <Box
                key={p}
                component={motion.div}
                initial={false}
                animate={page === p ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                sx={{ position: "absolute", inset: 0, display: page === p ? "block" : "none" }}
              >
                {p === "extract" ? <ExtractPage onAsk={() => go("ask")} /> : <AskPage active={page === "ask"} />}
              </Box>
            ))}
          </Box>
        </Box>
      </MotionConfig>
    </ThemeProvider>
  );
}
