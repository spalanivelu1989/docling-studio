import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Layers,
  LocateFixed,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Source } from "../api";
import Markdown, { locateRegex } from "./Markdown";
import { surface } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
  source: Source | null;
  allSources: Source[];
  onSelectSource: (s: Source) => void;
  highlight?: RegExp | null;
  /** A passage to find rather than terms to mark. The Evidence Agent passes
   *  the quote a claim rests on; the caller cannot build the regex itself
   *  because narrowing it needs the text being searched, which is loaded
   *  here. When set it replaces `highlight`. */
  locate?: string;
}

export default function DocumentInspectorDrawer({
  open,
  onClose,
  source,
  allSources,
  onSelectSource,
  highlight,
  locate,
}: Props) {
  const theme = useTheme();
  const [tab, setTab] = useState<"document" | "excerpt">("document");
  const [docContent, setDocContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const excerptRef = useRef<HTMLDivElement>(null);

  // Current index in the sources list
  const currentIndex = useMemo(() => {
    if (!source) return -1;
    return allSources.findIndex((s) => s.n === source.n);
  }, [allSources, source]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allSources.length - 1;

  // Load document content whenever the active source changes
  useEffect(() => {
    if (!open || !source) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const filename = source.file || source.title;
    api
      .kbFileContent(filename, source.source_path)
      .then((text) => {
        if (!cancelled) {
          setDocContent(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // If file not directly accessible, we'll fall back to showing excerpt
          setError(
            err instanceof Error
              ? `Full document could not be loaded: ${err.message}`
              : "Unable to load full document.",
          );
          setDocContent(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, source]);

  // Scroll to active excerpt within the document when docContent is rendered
  const scrollToExcerpt = () => {
    if (!containerRef.current || !source) return;

    // Try finding the heading first
    const headingText = source.section.replace(/^[#\s]+/, "").trim();
    let targetEl: HTMLElement | null = null;

    if (headingText) {
      const headings = containerRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
      for (const h of headings) {
        if (h.textContent?.toLowerCase().includes(headingText.toLowerCase())) {
          targetEl = h as HTMLElement;
          break;
        }
      }
    }

    // Fallback: look for a distinctive sentence from the excerpt content
    if (!targetEl && source.content) {
      const cleanSnippet = source.content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 20 && !l.startsWith("#"));

      if (cleanSnippet) {
        const snippetSub = cleanSnippet.slice(0, 40).toLowerCase();
        const paras = containerRef.current.querySelectorAll("p, li, td");
        for (const p of paras) {
          if (p.textContent?.toLowerCase().includes(snippetSub)) {
            targetEl = p as HTMLElement;
            break;
          }
        }
      }
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

      // Apply temporary pulse highlight
      targetEl.style.transition = "background-color 0.4s ease, outline 0.4s ease";
      const originalBg = targetEl.style.backgroundColor;
      const originalOutline = targetEl.style.outline;

      targetEl.style.backgroundColor = alpha(theme.palette.primary.main, 0.15);
      targetEl.style.outline = `2px solid ${theme.palette.primary.main}`;
      targetEl.style.borderRadius = "4px";

      setTimeout(() => {
        if (targetEl) {
          targetEl.style.backgroundColor = originalBg;
          targetEl.style.outline = originalOutline;
        }
      }, 2500);
    } else {
      // If we couldn't find exact match, scroll back to top of container
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (!loading && docContent && tab === "document") {
      const timer = setTimeout(scrollToExcerpt, 200);
      return () => clearTimeout(timer);
    }
  }, [loading, docContent, tab, source]);

  // The document and the excerpt are different haystacks, so a quote is
  // narrowed against each separately -- the fragment that identifies a row in
  // a 4,000-row sheet is not the one that identifies it inside its own chunk.
  const docHighlight = useMemo(
    () => (locate ? locateRegex(locate, docContent ?? "") : highlight ?? null),
    [locate, docContent, highlight],
  );
  const excerptHighlight = useMemo(
    () => (locate && source ? locateRegex(locate, source.content) : highlight ?? null),
    [locate, source, highlight],
  );

  if (!source) return null;

  const copyExcerpt = async () => {
    await navigator.clipboard.writeText(source.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: {
          sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" },
        },
        paper: {
          sx: {
            width: { xs: "100%", md: 680, lg: 760 },
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
            backgroundImage: "none",
            boxShadow:
              theme.palette.mode === "dark"
                ? "-8px 0 32px rgba(0, 0, 0, 0.7)"
                : "-8px 0 32px rgba(0, 0, 0, 0.12)",
          },
        },
      }}
    >
      {/* ---------- Header ---------- */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? alpha(t.palette.background.default, 0.7)
              : alpha(t.palette.background.paper, 0.95),
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: 2,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
              color: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <BookOpen size={18} />
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {source.title}
              </Typography>
              {source.category && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={source.category}
                  sx={{
                    height: 20,
                    fontSize: 11,
                    fontWeight: 700,
                    borderColor: "divider",
                    bgcolor: (t) => surface(t, 0.5),
                  }}
                />
              )}
            </Stack>

            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {source.file || source.source_path || "Document Excerpt"}
            </Typography>
          </Box>

          {/* Navigation between sources */}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
            <Tooltip title="Previous cited excerpt">
              <span>
                <IconButton
                  size="small"
                  disabled={!hasPrev}
                  onClick={() => hasPrev && onSelectSource(allSources[currentIndex - 1])}
                  sx={{ borderRadius: 1.5 }}
                >
                  <ChevronLeft size={18} />
                </IconButton>
              </span>
            </Tooltip>

            <Chip
              size="small"
              label={`[${source.n}] · ${currentIndex + 1} / ${allSources.length}`}
              sx={{
                height: 24,
                fontSize: 11.5,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                color: "primary.main",
              }}
            />

            <Tooltip title="Next cited excerpt">
              <span>
                <IconButton
                  size="small"
                  disabled={!hasNext}
                  onClick={() => hasNext && onSelectSource(allSources[currentIndex + 1])}
                  sx={{ borderRadius: 1.5 }}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </span>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20, alignSelf: "center" }} />

            <Tooltip title="Close inspector (Esc)">
              <IconButton size="small" onClick={onClose} sx={{ borderRadius: 1.5 }}>
                <X size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      {/* ---------- Context Banner & Controls ---------- */}
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          // Lift this band above the drawer rather than sinking it below:
          // a near-black strip under a dark surface swallowed the section
          // breadcrumb and the metric chips sitting on it.
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? alpha(t.palette.common.white, 0.04)
              : surface(t, 0.35),
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}
        >
          {/* Section Breadcrumb */}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              Referenced Section
            </Typography>
            <Typography
              sx={{
                fontWeight: 650,
                fontSize: 13.5,
                color: "text.primary",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {source.section || "(start of document)"}
            </Typography>
          </Box>

          {/* Metric Badges & Action Buttons */}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {source.similarity != null && (
              <Chip
                size="small"
                variant="outlined"
                label={`Semantic: ${(source.similarity * 100).toFixed(0)}%`}
                sx={{
                  height: 22,
                  fontSize: 11,
                  fontWeight: 650,
                  color: "primary.main",
                  borderColor: (t) => alpha(t.palette.primary.main, 0.3),
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
                }}
              />
            )}
            {source.bm25 != null && (
              <Chip
                size="small"
                variant="outlined"
                label={`BM25: ${source.bm25.toFixed(1)}`}
                sx={{
                  height: 22,
                  fontSize: 11,
                  fontWeight: 650,
                  color: "secondary.main",
                  borderColor: (t) => alpha(t.palette.secondary.main, 0.3),
                  bgcolor: (t) => alpha(t.palette.secondary.main, 0.05),
                }}
              />
            )}

            {tab === "document" && docContent && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<LocateFixed size={14} />}
                onClick={scrollToExcerpt}
                sx={{
                  height: 26,
                  fontSize: 11.5,
                  borderRadius: 1.5,
                  textTransform: "none",
                  fontWeight: 600,
                }}
              >
                Locate in doc
              </Button>
            )}

            <Button
              size="small"
              variant="outlined"
              color={copied ? "success" : "inherit"}
              startIcon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={copyExcerpt}
              sx={{
                height: 26,
                fontSize: 11.5,
                borderRadius: 1.5,
                textTransform: "none",
                fontWeight: 600,
              }}
            >
              {copied ? "Copied" : "Copy excerpt"}
            </Button>
          </Stack>
        </Stack>

        {/* View Switcher Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            minHeight: 34,
            mt: 1,
            "& .MuiTab-root": {
              minHeight: 34,
              py: 0.5,
              px: 1.5,
              fontSize: 12.5,
              fontWeight: 600,
              textTransform: "none",
            },
          }}
        >
          <Tab
            value="document"
            icon={<FileText size={14} />}
            iconPosition="start"
            label="Full Document"
          />
          <Tab
            value="excerpt"
            icon={<Layers size={14} />}
            iconPosition="start"
            label="Indexed Excerpt"
          />
        </Tabs>
      </Box>

      {/* ---------- Content Area ---------- */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          overflowY: "auto",
          p: { xs: 2, md: 3 },
          position: "relative",
        }}
      >
        {tab === "document" ? (
          loading ? (
            <Stack spacing={2} sx={{ py: 3 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <CircularProgress size={18} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Loading source document...
                </Typography>
              </Stack>
              <Skeleton variant="text" width="60%" height={32} />
              <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
              <Skeleton variant="text" width="90%" />
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
            </Stack>
          ) : docContent ? (
            <Box>
              {/* Highlight card indicating active passage */}
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  mb: 3,
                  borderRadius: 2,
                  border: 1,
                  borderColor: (t) => alpha(t.palette.primary.main, 0.4),
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Sparkles size={16} color={theme.palette.primary.main} />
                  <Typography sx={{ fontWeight: 700, fontSize: 13, color: "primary.main" }}>
                    Active Cited Excerpt [{source.n}]
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ fontSize: 13, color: "text.secondary" }}>
                  The section below is currently referenced in the generated answer. Use{" "}
                  <strong>Locate in doc</strong> to jump directly to this passage.
                </Typography>
              </Paper>

              <Markdown source={docContent} highlight={docHighlight} diagrams />
            </Box>
          ) : (
            <Stack spacing={2} sx={{ py: 2 }}>
              {error && (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  {error}
                </Alert>
              )}
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Displaying indexed excerpt content instead:
              </Typography>
              <Paper
                elevation={0}
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  border: 1,
                  borderColor: "divider",
                  bgcolor: "background.default",
                }}
              >
                <Markdown source={source.content} highlight={excerptHighlight} />
              </Paper>
            </Stack>
          )
        ) : (
          /* ---------- Indexed Excerpt View ---------- */
          <Box ref={excerptRef}>
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 2.5,
                border: 1,
                borderColor: "divider",
                bgcolor: "background.default",
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
                <Chip
                  size="small"
                  label={`[${source.n}]`}
                  sx={{
                    fontWeight: 700,
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                    color: "primary.main",
                  }}
                />
                <Typography sx={{ fontWeight: 650, fontSize: 14 }}>
                  {source.section || "(start of document)"}
                </Typography>
              </Stack>
              <Markdown source={source.content} highlight={excerptHighlight} />
            </Paper>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
