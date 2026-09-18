import {
  Box,
  Button,
  Chip,
  IconButton,
  InputBase,
  Paper,
  Snackbar,
  Alert,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight,
  Check,
  CodeXml,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode,
  FileUp,
  FolderOpen,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import Markdown from "../components/Markdown";

interface PaneState {
  id: "left" | "right";
  title: string;
  isCustomTitle: boolean;
  content: string;
  filename: string | null;
  fileSize: number | null;
  view: "rendered" | "raw";
}

const SAMPLE_LEFT = `# Product Specification v1.0

## Executive Summary
Docling Studio is an open-source document conversion and extraction platform.
It processes complex multi-page documents (PDF, PPTX, DOCX, XLSX, images) into rich, structured Markdown.

## Core Features
- **High-accuracy parsing**: Extracts headings, body paragraphs, and lists.
- **Table reconstruction**: Preserves spreadsheet grids and complex tables.
- **Vision Model assistance**: Integrates VLM for diagrams and flattened visuals.
- **Vector Search & RAG**: Semantic retrieval with BGE-M3 (Ollama) embeddings.

## Architectural Components
\`\`\`mermaid
flowchart TD
  Doc[Original Document] --> Extractor[Docling Pipeline]
  Extractor --> MD[Structured Markdown]
  MD --> Indexer[BGE-M3 Embeddings]
  Indexer --> VectorDB[(pgvector DB)]
\`\`\`

## Supported Formats
| Format | Extension | Engine |
| :--- | :--- | :--- |
| PDF | \`.pdf\` | Docling Native |
| Office Docs | \`.docx, .pptx, .xlsx\` | LibreOffice + Native |
| Scans & Images | \`.png, .jpg\` | RapidOCR + VLM |

*Status: Approved for Production*
`;

const SAMPLE_RIGHT = `# Product Specification v2.0 (Draft)

## Executive Summary
Docling Studio is an open-source document conversion and extraction platform.
Now featuring a built-in **Side-by-Side MD Viewer** for comparing revisions and extraction outputs!

## Core Features
- **High-accuracy parsing**: Extracts headings, body paragraphs, and lists.
- **Table reconstruction**: Preserves spreadsheet grids and complex tables.
- **Vision Model assistance**: Integrates VLM for diagrams and flattened visuals.
- **Vector Search & RAG**: Semantic retrieval with BGE-M3 (Ollama) embeddings.
- **Side-by-Side MD Comparison**: Dual split-screen markdown viewer with synced scrolling.

## Architectural Components
\`\`\`mermaid
flowchart TD
  Doc[Original Document] --> Extractor[Docling Pipeline]
  Extractor --> MD[Structured Markdown]
  MD --> Indexer[BGE-M3 Embeddings]
  MD --> Compare[Side-by-Side MD Viewer]
  Indexer --> VectorDB[(pgvector DB)]
\`\`\`

## Supported Formats
| Format | Extension | Engine | Notes |
| :--- | :--- | :--- | :--- |
| PDF | \`.pdf\` | Docling Native | OCR enabled |
| Office Docs | \`.docx, .pptx, .xlsx\` | LibreOffice + Native | Auto converts |
| Scans & Images | \`.png, .jpg\` | RapidOCR + VLM | Vision-aided |
| Markdown | \`.md, .txt\` | MD Comparison Viewer | Direct preview |

*Status: In Review — Target Q3 Release*
`;

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function MdViewerPage() {
  const [leftPane, setLeftPane] = useState<PaneState>({
    id: "left",
    title: "Left Document",
    isCustomTitle: false,
    content: "",
    filename: null,
    fileSize: null,
    view: "rendered",
  });

  const [rightPane, setRightPane] = useState<PaneState>({
    id: "right",
    title: "Right Document",
    isCustomTitle: false,
    content: "",
    filename: null,
    fileSize: null,
    view: "rendered",
  });

  const [syncScroll, setSyncScroll] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // Synchronized scrolling listener
  const handleScroll = (source: "left" | "right") => {
    if (!syncScroll || isSyncing.current) return;
    const sourceEl = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const targetEl = source === "left" ? rightScrollRef.current : leftScrollRef.current;

    if (!sourceEl || !targetEl) return;

    const sourceMax = sourceEl.scrollHeight - sourceEl.clientHeight;
    const targetMax = targetEl.scrollHeight - targetEl.clientHeight;
    if (sourceMax <= 0 || targetMax <= 0) return;

    const scrollRatio = sourceEl.scrollTop / sourceMax;
    isSyncing.current = true;
    targetEl.scrollTop = scrollRatio * targetMax;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  };

  const handleFileLoad = (paneId: "left" | "right", file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      const updateFn = paneId === "left" ? setLeftPane : setRightPane;
      updateFn((prev) => ({
        ...prev,
        content: text,
        filename: file.name,
        fileSize: file.size,
        title: prev.isCustomTitle ? prev.title : file.name,
      }));
      setNotice(`Loaded ${file.name} into ${paneId === "left" ? "Left" : "Right"} pane.`);
    };
    reader.readAsText(file);
  };

  const handleSwap = () => {
    setLeftPane((prevLeft) => {
      const newLeft = { ...rightPane, id: "left" as const };
      setRightPane({ ...prevLeft, id: "right" as const });
      return newLeft;
    });
    setNotice("Swapped Left and Right panes.");
  };

  const handleClearAll = () => {
    setLeftPane({
      id: "left",
      title: "Left Document",
      isCustomTitle: false,
      content: "",
      filename: null,
      fileSize: null,
      view: "rendered",
    });
    setRightPane({
      id: "right",
      title: "Right Document",
      isCustomTitle: false,
      content: "",
      filename: null,
      fileSize: null,
      view: "rendered",
    });
    setNotice("Cleared both panes.");
  };

  const handleLoadSample = () => {
    setLeftPane({
      id: "left",
      title: "Product Spec v1.0",
      isCustomTitle: true,
      content: SAMPLE_LEFT,
      filename: "product_spec_v1.0.md",
      fileSize: new Blob([SAMPLE_LEFT]).size,
      view: "rendered",
    });
    setRightPane({
      id: "right",
      title: "Product Spec v2.0 (Draft)",
      isCustomTitle: true,
      content: SAMPLE_RIGHT,
      filename: "product_spec_v2.0_draft.md",
      fileSize: new Blob([SAMPLE_RIGHT]).size,
      view: "rendered",
    });
    setNotice("Loaded sample Markdown documents for side-by-side comparison.");
  };

  const hasAnyContent = Boolean(leftPane.content || rightPane.content);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* ---------- Top MD Viewer Control Toolbar ---------- */}
      <Paper square sx={{ borderWidth: "0 0 1px 0", px: 2, py: 1, flex: "none" }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                display: "inline-flex",
                p: 0.75,
                borderRadius: 1.5,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                color: "primary.main",
              }}
            >
              <Columns2 size={18} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "text.primary" }}>
              Markdown Comparator
            </Typography>
          </Stack>

          <Box sx={{ flex: 1 }} />

          {/* Sync Scrolling Switch */}
          <Tooltip title="When enabled, scrolling one pane synchronously scrolls the other pane to the same relative position">
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                alignItems: "center",
                px: 1.25,
                py: 0.5,
                borderRadius: 2,
                bgcolor: (t) => (syncScroll ? alpha(t.palette.primary.main, 0.08) : "transparent"),
                border: (t) => `1px solid ${syncScroll ? alpha(t.palette.primary.main, 0.3) : t.palette.divider}`,
                transition: "all 0.15s ease",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600, color: syncScroll ? "primary.main" : "text.secondary" }}>
                Sync Scroll
              </Typography>
              <Switch
                size="small"
                checked={syncScroll}
                onChange={(e) => setSyncScroll(e.target.checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": {
                    color: "primary.main",
                  },
                }}
              />
            </Stack>
          </Tooltip>

          {/* Swap Panes */}
          <Tooltip title="Swap Left and Right documents">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ArrowLeftRight size={15} />}
                onClick={handleSwap}
                disabled={!hasAnyContent}
              >
                Swap
              </Button>
            </span>
          </Tooltip>

          {/* Load Sample Comparison */}
          <Tooltip title="Load sample markdown files with revisions to test side-by-side comparison">
            <Button
              variant="outlined"
              size="small"
              startIcon={<Sparkles size={15} />}
              onClick={handleLoadSample}
            >
              Load Sample
            </Button>
          </Tooltip>

          {/* Clear All */}
          {hasAnyContent && (
            <Tooltip title="Clear both comparison panes">
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<Trash2 size={15} />}
                onClick={handleClearAll}
              >
                Clear All
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Paper>

      {/* ---------- Split Comparison Panes ---------- */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Group orientation="horizontal" style={{ height: "100%" }}>
          {/* Left Pane */}
          <Panel defaultSize="50" minSize="20">
            <ViewerPane
              pane={leftPane}
              scrollRef={leftScrollRef}
              onScroll={() => handleScroll("left")}
              onChangeTitle={(title) => setLeftPane((p) => ({ ...p, title, isCustomTitle: true }))}
              onChangeView={(view) => setLeftPane((p) => ({ ...p, view }))}
              onFileSelected={(file) => handleFileLoad("left", file)}
              onContentChange={(content) => setLeftPane((p) => ({ ...p, content }))}
              onClear={() =>
                setLeftPane({
                  id: "left",
                  title: "Left Document",
                  isCustomTitle: false,
                  content: "",
                  filename: null,
                  fileSize: null,
                  view: "rendered",
                })
              }
              onNotify={(msg) => setNotice(msg)}
            />
          </Panel>

          {/* Resizable Divider */}
          <Separator className="pane-separator" />

          {/* Right Pane */}
          <Panel defaultSize="50" minSize="20">
            <ViewerPane
              pane={rightPane}
              scrollRef={rightScrollRef}
              onScroll={() => handleScroll("right")}
              onChangeTitle={(title) => setRightPane((p) => ({ ...p, title, isCustomTitle: true }))}
              onChangeView={(view) => setRightPane((p) => ({ ...p, view }))}
              onFileSelected={(file) => handleFileLoad("right", file)}
              onContentChange={(content) => setRightPane((p) => ({ ...p, content }))}
              onClear={() =>
                setRightPane({
                  id: "right",
                  title: "Right Document",
                  isCustomTitle: false,
                  content: "",
                  filename: null,
                  fileSize: null,
                  view: "rendered",
                })
              }
              onNotify={(msg) => setNotice(msg)}
            />
          </Panel>
        </Group>
      </Box>

      {/* Feedback Toast */}
      <Snackbar
        open={Boolean(notice)}
        onClose={(_, reason) => reason !== "clickaway" && setNotice(null)}
        autoHideDuration={3000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice ? (
          <Alert severity="success" variant="filled" onClose={() => setNotice(null)} sx={{ alignItems: "center" }}>
            {notice}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}

// ----------------------------------------------------------------------------
// Sub-component: Individual Viewer Pane
// ----------------------------------------------------------------------------
interface ViewerPaneProps {
  pane: PaneState;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onChangeTitle: (title: string) => void;
  onChangeView: (view: "rendered" | "raw") => void;
  onFileSelected: (file: File) => void;
  onContentChange: (content: string) => void;
  onClear: () => void;
  onNotify: (message: string) => void;
}

function ViewerPane({
  pane,
  scrollRef,
  onScroll,
  onChangeTitle,
  onChangeView,
  onFileSelected,
  onClear,
  onNotify,
}: ViewerPaneProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(pane.title);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  // Sync title input with external title changes
  useEffect(() => {
    setTitleInput(pane.title);
  }, [pane.title]);

  const commitTitle = () => {
    const trimmed = titleInput.trim();
    if (trimmed && trimmed !== pane.title) {
      onChangeTitle(trimmed);
    } else {
      setTitleInput(pane.title);
    }
    setIsEditingTitle(false);
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrag = (e: DragEvent, kind: "enter" | "leave" | "over" | "drop") => {
    e.preventDefault();
    if (kind === "enter") dragDepth.current += 1;
    if (kind === "leave") dragDepth.current -= 1;
    if (kind === "drop") {
      dragDepth.current = 0;
      const file = e.dataTransfer.files?.[0];
      if (file) {
        onFileSelected(file);
      }
    }
    setIsDragging(dragDepth.current > 0 && kind !== "drop");
  };

  const handleCopy = async () => {
    if (!pane.content) return;
    await navigator.clipboard.writeText(pane.content);
    setCopied(true);
    onNotify("Copied Markdown to clipboard.");
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    if (!pane.content) return;
    const blob = new Blob([pane.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = pane.title.replace(/[^\w.-]/g, "_");
    a.href = url;
    a.download = safeTitle.endsWith(".md") ? safeTitle : `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Downloaded ${a.download}`);
  };

  // Content stats
  const lineCount = pane.content ? pane.content.split("\n").length : 0;
  const wordCount = pane.content ? (pane.content.match(/\S+/g) || []).length : 0;
  const charCount = pane.content ? pane.content.length : 0;

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}
      onDragEnter={(e) => handleDrag(e, "enter")}
      onDragLeave={(e) => handleDrag(e, "leave")}
      onDragOver={(e) => handleDrag(e, "over")}
      onDrop={(e) => handleDrag(e, "drop")}
    >
      {/* Hidden file input */}
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.mdown,.mkd,.txt"
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      {/* Pane Header */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 2,
          py: 0.75,
          minHeight: 48,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {/* Pane Name / Editable Title */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, flexShrink: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: pane.content ? "primary.main" : "text.disabled",
              flexShrink: 0,
            }}
          />
          {isEditingTitle ? (
            <InputBase
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setTitleInput(pane.title);
                  setIsEditingTitle(false);
                }
              }}
              sx={{
                fontSize: 13.5,
                fontWeight: 700,
                border: (t) => `1px solid ${t.palette.primary.main}`,
                borderRadius: 1,
                px: 1,
                py: 0.25,
                bgcolor: "background.default",
                maxWidth: 240,
              }}
            />
          ) : (
            <Tooltip title="Click to rename pane">
              <Stack
                direction="row"
                spacing={0.5}
                onClick={() => setIsEditingTitle(true)}
                sx={{
                  alignItems: "center",
                  cursor: "pointer",
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                  transition: "background-color 0.15s",
                }}
              >
                <Typography
                  noWrap
                  sx={{
                    fontWeight: 700,
                    fontSize: 13.5,
                    color: "text.primary",
                    maxWidth: { xs: 130, md: 220 },
                  }}
                >
                  {pane.title}
                </Typography>
                <Pencil size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
              </Stack>
            </Tooltip>
          )}

          {pane.filename && pane.filename !== pane.title && (
            <Tooltip title={`Source file: ${pane.filename}`}>
              <Chip
                size="small"
                label={pane.filename}
                variant="outlined"
                sx={{
                  fontSize: 11,
                  height: 20,
                  maxWidth: 140,
                  "& .MuiChip-label": { px: 0.75 },
                }}
              />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Action Controls */}
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          {pane.content ? (
            <>
              {/* Document metadata count */}
              <Tooltip title={`${lineCount} lines • ${wordCount} words • ${charCount} chars${pane.fileSize ? ` • ${formatBytes(pane.fileSize)}` : ""}`}>
                <Chip
                  size="small"
                  label={`${lineCount}L / ${wordCount}W`}
                  sx={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 11,
                    height: 22,
                    bgcolor: (t) => alpha(t.palette.text.secondary, 0.08),
                  }}
                />
              </Tooltip>

              {/* View toggle (Rendered vs Raw) */}
              <ToggleButtonGroup
                size="small"
                value={pane.view}
                exclusive
                onChange={(_, v) => v && onChangeView(v)}
                sx={{ height: 28 }}
              >
                <ToggleButton value="rendered" sx={{ px: 1, py: 0 }}>
                  <Tooltip title="Rendered preview with markdown & diagrams">
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", fontSize: 12 }}>
                      <Eye size={13} />
                      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                        Preview
                      </Box>
                    </Stack>
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="raw" sx={{ px: 1, py: 0 }}>
                  <Tooltip title="Raw markdown source code">
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", fontSize: 12 }}>
                      <CodeXml size={13} />
                      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                        Raw
                      </Box>
                    </Stack>
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>

              {/* Copy */}
              <Tooltip title="Copy Markdown to clipboard">
                <IconButton size="small" onClick={handleCopy} sx={{ p: 0.5 }}>
                  {copied ? <Check size={15} color="var(--mui-palette-success-main)" /> : <Copy size={15} />}
                </IconButton>
              </Tooltip>

              {/* Download */}
              <Tooltip title="Download Markdown file">
                <IconButton size="small" onClick={handleDownload} sx={{ p: 0.5 }}>
                  <Download size={15} />
                </IconButton>
              </Tooltip>

              {/* Clear */}
              <Tooltip title="Clear pane">
                <IconButton size="small" onClick={onClear} sx={{ p: 0.5 }}>
                  <RotateCcw size={15} />
                </IconButton>
              </Tooltip>
            </>
          ) : null}

          {/* Open MD File Button */}
          <Button
            size="small"
            variant={pane.content ? "outlined" : "contained"}
            startIcon={<FileUp size={14} />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ fontSize: 12, py: 0.4, px: 1.25, minHeight: 28 }}
          >
            {pane.content ? "Open" : "Open MD"}
          </Button>
        </Stack>
      </Stack>

      {/* Pane Content Area */}
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        sx={{
          flex: 1,
          overflow: "auto",
          bgcolor: "background.default",
          position: "relative",
        }}
      >
        {pane.content ? (
          <motion.div
            key={pane.view + pane.title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {pane.view === "rendered" ? (
              <Markdown source={pane.content} diagrams sx={{ p: 3, maxWidth: "85ch", mx: "auto" }} />
            ) : (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 3,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  font: "12.5px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "text.primary",
                }}
              >
                {pane.content}
              </Box>
            )}
          </motion.div>
        ) : (
          <EmptyPane
            isDragging={isDragging}
            paneTitle={pane.title}
            onBrowse={() => fileInputRef.current?.click()}
          />
        )}

        {/* Drag Overlay indicator when dragging over an already loaded pane */}
        <AnimatePresence>
          {isDragging && pane.content && (
            <Box
              component={motion.div}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              sx={{
                position: "absolute",
                inset: 8,
                borderRadius: 2,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                border: (t) => `2px dashed ${t.palette.primary.main}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", bgcolor: "background.paper", px: 2, py: 1, borderRadius: 2, boxShadow: 3 }}>
                <FileCode size={20} color="var(--mui-palette-primary-main)" />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Drop file here to replace content
                </Typography>
              </Stack>
            </Box>
          )}
        </AnimatePresence>
      </Box>
    </Box>
  );
}

// ----------------------------------------------------------------------------
// Sub-component: Empty Pane Drop Zone
// ----------------------------------------------------------------------------
function EmptyPane({
  isDragging,
  paneTitle,
  onBrowse,
}: {
  isDragging: boolean;
  paneTitle: string;
  onBrowse: () => void;
}) {
  return (
    <Box sx={{ p: 3, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Box
        component={motion.div}
        animate={{ scale: isDragging ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        sx={(t) => ({
          width: "100%",
          maxWidth: 440,
          minHeight: 280,
          borderRadius: 3,
          p: 4,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          border: `2px dashed ${isDragging ? t.palette.primary.main : t.palette.divider}`,
          bgcolor: isDragging ? alpha(t.palette.primary.main, 0.04) : alpha(t.palette.action.hover, 0.4),
          transition: "border-color .15s, background-color .15s",
        })}
      >
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2.5,
            display: "grid",
            placeItems: "center",
            bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
            color: "primary.main",
          }}
        >
          <FolderOpen size={24} />
        </Box>

        <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 0.5 }}>
          Open {paneTitle}
        </Typography>

        <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 300, fontSize: 13 }}>
          Drop a Markdown (<code>.md</code>, <code>.txt</code>) file here, or browse from your computer.
        </Typography>

        <Button
          variant="contained"
          size="small"
          startIcon={<FileUp size={15} />}
          onClick={onBrowse}
          sx={{ mt: 1 }}
        >
          Choose File
        </Button>
      </Box>
    </Box>
  );
}
