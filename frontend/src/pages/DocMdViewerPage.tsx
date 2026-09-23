import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  ListSubheader,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  CodeXml,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode,
  FileText,
  FolderOpen,
  Layers,
  ScanEye,
  Search,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api, type KbFileItem, type Upload } from "../api";
import Markdown from "../components/Markdown";
import { surface } from "../theme";

const ACCEPT_DOCS = ".pptx,.ppt,.docx,.doc,.xlsx,.xlsm,.xls,.pdf,.html,.htm,.xml,.csv,.txt,.json,.msg,.eml,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif";
const ACCEPT_MD = ".md,.markdown,.mdown,.mkd,.txt";

const countLines = (text: string) => (text ? text.split("\n").length : 0);
const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// Demo sample markdown and document preview fallback
const SAMPLE_MD = `# P2P Process Orders & Integration Architecture

## Overview
This document describes the end-to-end integration architecture for **Manufacturing Execution in SAP Packaged Process Orders** and **EWM Production Integration**.

### Key Objectives
- Standardize process orders across manufacturing plants.
- Ensure seamless goods receipt and batch determination.
- Eliminate reconciliation bottlenecks between ERP and shop floor systems.

---

## Process Flow Diagram
\`\`\`mermaid
flowchart TD
  PO[SAP Process Order Created] --> Rel[Order Release & Staging]
  Rel --> Mat[Material Staging in EWM]
  Mat --> Prod[Production Execution]
  Prod --> Conf[Phase Confirmation & Quality Inspection]
  Conf --> GR[Auto Goods Receipt to Warehouse]
\`\`\`

---

## Systems & Communication Protocols
| Component | System Name | Protocol / Interface | Direction |
| :--- | :--- | :--- | :--- |
| Core ERP | SAP S/4HANA | RFC / qRFC | Bi-directional |
| Warehouse | SAP EWM 9.5 | qRFC & IDoc | Inbound / Outbound |
| Shop Floor | LIMS / MES | REST API & WebServices | Outbound |
| Archival | OpenText Documentum | CMIS API | Outbound |

---

## Business Rules for Batch Determination
1. **FIFO Allocation**: Batches must be allocated based on minimum expiration date.
2. **Quality Quarantine**: Any batch flagged with status *Q* cannot be staged for packaging.
3. **Tare Weight Validation**: Variance between actual and gross tare must not exceed ±0.5%.

> [!NOTE]
> Review the source presentation slides on the left pane to verify diagram shapes, data tables, and connector alignments.
`;

export default function DocMdViewerPage() {
  // Left pane: Original Document
  const [doc, setDoc] = useState<Upload | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const [docZoom, setDocZoom] = useState(100);
  const [docViewMode, setDocViewMode] = useState<"continuous" | "single">("continuous");
  const [leftTitle, setLeftTitle] = useState("Original Document");

  // Right pane: Converted Markdown
  const [mdContent, setMdContent] = useState("");
  const [mdFilename, setMdFilename] = useState<string | null>(null);
  const [mdView, setMdView] = useState<"rendered" | "raw">("rendered");
  const [mdConverting, setMdConverting] = useState(false);
  const [kbFiles, setKbFiles] = useState<KbFileItem[]>([]);
  // Keyed by source path, not file name. Two documents can share a name --
  // knowledge_base/X.md and solvay-spark/pkg/markdown/X.md are different files
  // -- and the server refuses a delete or a read aimed by name alone.
  const [selectedKbFile, setSelectedKbFile] = useState<string>("");
  const [kbLoading, setKbLoading] = useState(false);
  // Set when the chosen document has Markdown in the corpus but no original
  // file on disk to show beside it.
  const [noOriginal, setNoOriginal] = useState<string | null>(null);

  // Global settings
  const [syncScroll, setSyncScroll] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Refs
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const docInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const docInputId = useId();
  const mdInputId = useId();

  // Fetch KB files list
  useEffect(() => {
    api.kbFiles()
      .then((files) => setKbFiles(files))
      .catch(() => {});
  }, []);

  // Synchronized scrolling
  const handleScroll = (source: "left" | "right") => {
    if (!syncScroll || isSyncing.current) return;
    const srcEl = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const tgtEl = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!srcEl || !tgtEl) return;

    const maxSrc = srcEl.scrollHeight - srcEl.clientHeight;
    const maxTgt = tgtEl.scrollHeight - tgtEl.clientHeight;
    if (maxSrc <= 0 || maxTgt <= 0) return;

    const ratio = srcEl.scrollTop / maxSrc;
    isSyncing.current = true;
    tgtEl.scrollTop = ratio * maxTgt;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  };

  // Upload original document
  const uploadDoc = async (file: File) => {
    setDocLoading(true);
    setNotice(`Uploading and rendering ${file.name}...`);
    try {
      const data = await api.upload(file);
      setDoc(data);
      setLeftTitle(data.filename);
      setDocPage(1);
      setNotice(`Loaded ${data.filename} (${data.pages} pages).`);
    } catch (err: unknown) {
      setNotice(`Failed to open document: ${(err as Error).message}`);
    } finally {
      setDocLoading(false);
    }
  };

  // Load markdown file from disk
  const openMdFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setMdContent(text);
      setMdFilename(file.name);
      setNotice(`Loaded ${file.name}.`);
    };
    reader.readAsText(file, "utf-8");
  };

  // Load an indexed document from the corpus into BOTH panes: its Markdown on
  // the right, and the file that Markdown was converted from on the left. That
  // pairing is the whole job of this page -- comparing them used to mean
  // picking the Markdown here and then hunting the original up on disk to
  // upload by hand.
  const handleSelectKbFile = async (source: string) => {
    if (!source) return;
    const entry = kbFiles.find((f) => f.source === source);
    const label = entry?.title || source;
    setSelectedKbFile(source);
    setKbLoading(true);
    setNoOriginal(null);
    try {
      const text = await api.kbFileContent(entry?.name || source, source);
      setMdContent(text);
      setMdFilename(entry?.name || source);
      setNotice(`Loaded ${label} from the knowledge base.`);
    } catch (err: unknown) {
      setNotice(`Failed to load ${label}: ${(err as Error).message}`);
      setKbLoading(false);
      return;
    }

    // The original is a bonus, not a requirement: a document added through the
    // web UI has only its Markdown, and the Markdown side must still load.
    try {
      const data = await api.openKbOriginal(source);
      setDoc(data);
      setLeftTitle(data.filename);
      setDocPage(1);
      setNotice(`Loaded ${label} — ${data.filename} (${data.pages} pages) beside its Markdown.`);
    } catch (err: unknown) {
      setDoc(null);
      setLeftTitle("Original Document");
      setNoOriginal((err as Error).message);
    } finally {
      setKbLoading(false);
    }
  };

  // Convert uploaded doc on the fly
  const convertUploadedDoc = async () => {
    if (!doc) return;
    setMdConverting(true);
    setNotice(`Extracting Markdown from ${doc.filename}...`);
    try {
      const data = await api.convert(doc.id, false, "claude");
      setMdContent(data.markdown);
      setMdFilename(`${doc.filename.replace(/\.[^/.]+$/, "")}.md`);
      setNotice(`Converted ${doc.filename} to Markdown (${data.markdown.length.toLocaleString()} chars).`);
    } catch (err: unknown) {
      setNotice(`Conversion failed: ${(err as Error).message}`);
    } finally {
      setMdConverting(false);
    }
  };

  // Demo sample loader
  const loadSample = () => {
    setMdContent(SAMPLE_MD);
    setMdFilename("P2P-WS021-Manufacturing-Execution.md");
    setLeftTitle("Sample Process Flow (PPTX)");
    setNotice("Loaded sample document comparison.");
  };

  // Copy Markdown
  const handleCopy = async () => {
    if (!mdContent) return;
    await navigator.clipboard.writeText(mdContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setNotice("Copied Markdown to clipboard.");
  };

  // Download Markdown
  const handleDownload = () => {
    if (!mdContent) return;
    const blob = new Blob([mdContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = mdFilename || "document.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reset/Clear
  const handleClearAll = () => {
    setDoc(null);
    setDocPage(1);
    setDocZoom(100);
    setLeftTitle("Original Document");
    setMdContent("");
    setMdFilename(null);
    setSelectedKbFile("");
    setNoOriginal(null);
    setNotice("Cleared review workspace.");
  };

  const totalPages = doc?.pages || 0;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Hidden file inputs */}
      <input
        id={docInputId}
        ref={docInputRef}
        type="file"
        accept={ACCEPT_DOCS}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) uploadDoc(e.target.files[0]);
          if (docInputRef.current) docInputRef.current.value = "";
        }}
      />
      <input
        id={mdInputId}
        ref={mdInputRef}
        type="file"
        accept={ACCEPT_MD}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) openMdFile(e.target.files[0]);
          if (mdInputRef.current) mdInputRef.current.value = "";
        }}
      />

      {/* Top Header Controls Toolbar */}
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
              <ScanEye size={18} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "text.primary" }}>
              Doc vs Markdown Review
            </Typography>
          </Stack>

          <Box sx={{ flex: 1 }} />

          {/* Sync Scroll Toggle */}
          <Paper
            variant="outlined"
            sx={{
              px: 1.25,
              py: 0.25,
              display: "flex",
              alignItems: "center",
              gap: 1,
              bgcolor: (t) => (syncScroll ? alpha(t.palette.primary.main, 0.08) : "transparent"),
              borderColor: (t) => (syncScroll ? alpha(t.palette.primary.main, 0.3) : t.palette.divider),
              borderRadius: 2,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 600, color: syncScroll ? "primary.main" : "text.secondary" }}>
              Sync Scroll
            </Typography>
            <Switch checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} size="small" />
          </Paper>

          {/* Quick Actions */}
          <Tooltip title="Load sample document and converted markdown for comparison">
            <Button
              variant="outlined"
              size="small"
              startIcon={<Sparkles size={14} />}
              onClick={loadSample}
              sx={{ fontSize: 12.5, minHeight: 32 }}
            >
              Load Sample
            </Button>
          </Tooltip>

          {(doc || mdContent) && (
            <Tooltip title="Clear both panes">
              <IconButton size="small" onClick={handleClearAll} sx={{ p: 0.75 }}>
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Paper>

      {/* Main Resizable Split Screen */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Group orientation="horizontal" style={{ height: "100%" }}>
          {/* Left Panel: Original Document Viewer */}
          <Panel defaultSize="50" minSize="25">
            <Box
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                borderRight: 1,
                borderColor: "divider",
                bgcolor: "background.default",
              }}
            >
              {/* Left Pane Toolbar */}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  px: 2,
                  py: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  flexWrap: "wrap",
                  gap: 1,
                  minHeight: 48,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
                  <Box sx={{ color: "primary.main", display: "flex" }}>
                    <FileText size={16} />
                  </Box>
                  <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, fontSize: 13 }}>
                    {leftTitle}
                  </Typography>
                  {doc && (
                    <Chip
                      size="small"
                      label={doc.format.toUpperCase()}
                      variant="outlined"
                      sx={{ fontSize: 10.5, height: 20 }}
                    />
                  )}
                  {totalPages > 0 && (
                    <Chip
                      size="small"
                      label={`${totalPages} ${totalPages === 1 ? "page" : "pages"}`}
                      color="primary"
                      variant="filled"
                      sx={{ fontSize: 10.5, height: 20 }}
                    />
                  )}
                </Stack>

                {/* Document View Controls */}
                {doc && totalPages > 0 && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    {/* View Mode */}
                    <ToggleButtonGroup
                      size="small"
                      value={docViewMode}
                      exclusive
                      onChange={(_, v) => v && setDocViewMode(v)}
                      sx={{ height: 28 }}
                    >
                      <Tooltip title="Continuous vertical scroll of all pages">
                        <ToggleButton value="continuous" sx={{ px: 1, py: 0 }}>
                          <Layers size={13} />
                        </ToggleButton>
                      </Tooltip>
                      <Tooltip title="Single page navigation">
                        <ToggleButton value="single" sx={{ px: 1, py: 0 }}>
                          <Columns2 size={13} />
                        </ToggleButton>
                      </Tooltip>
                    </ToggleButtonGroup>

                    {/* Single page navigation arrows */}
                    {docViewMode === "single" && (
                      <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
                        <IconButton
                          size="small"
                          disabled={docPage <= 1}
                          onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                          sx={{ p: 0.5 }}
                        >
                          <ChevronLeft size={16} />
                        </IconButton>
                        <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 44, textAlign: "center" }}>
                          {docPage} / {totalPages}
                        </Typography>
                        <IconButton
                          size="small"
                          disabled={docPage >= totalPages}
                          onClick={() => setDocPage((p) => Math.min(totalPages, p + 1))}
                          sx={{ p: 0.5 }}
                        >
                          <ChevronRight size={16} />
                        </IconButton>
                      </Stack>
                    )}

                    {/* Zoom controls */}
                    <Tooltip title="Zoom out">
                      <IconButton
                        size="small"
                        onClick={() => setDocZoom((z) => Math.max(50, z - 15))}
                        disabled={docZoom <= 50}
                        sx={{ p: 0.5 }}
                      >
                        <ZoomOut size={15} />
                      </IconButton>
                    </Tooltip>
                    <Typography variant="caption" sx={{ minWidth: 36, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {docZoom}%
                    </Typography>
                    <Tooltip title="Zoom in">
                      <IconButton
                        size="small"
                        onClick={() => setDocZoom((z) => Math.min(200, z + 15))}
                        disabled={docZoom >= 200}
                        sx={{ p: 0.5 }}
                      >
                        <ZoomIn size={15} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}

                {/* Open Doc Button */}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<FolderOpen size={14} />}
                  onClick={() => docInputRef.current?.click()}
                  sx={{ fontSize: 12, height: 28, px: 1.25 }}
                >
                  Open Doc
                </Button>
              </Stack>

              {/* Left Pane Body */}
              <Box
                ref={leftScrollRef}
                onScroll={() => handleScroll("left")}
                sx={{
                  flex: 1,
                  overflow: "auto",
                  p: 2.5,
                  bgcolor: (t) => (t.palette.mode === "light" ? "#f1f3f7" : "#0d1117"),
                }}
              >
                {docLoading || kbLoading ? (
                  <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
                    <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
                      <CircularProgress size={36} />
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Rendering document pages with LibreOffice &amp; Poppler...
                      </Typography>
                    </Stack>
                  </Box>
                ) : noOriginal ? (
                  /* The Markdown loaded and there is nothing to put beside it.
                     Said here rather than in a toast, because this pane staying
                     empty is the thing that needs explaining. */
                  <Box sx={{ height: "100%", display: "grid", placeItems: "center", px: 3 }}>
                    <Alert severity="info" sx={{ maxWidth: 460 }}>
                      {noOriginal}
                      <Typography sx={{ fontSize: 12.5, mt: 1, color: "text.secondary" }}>
                        The Markdown is loaded on the right. Use <strong>Open Doc</strong> if you
                        have the original file to compare it against.
                      </Typography>
                    </Alert>
                  </Box>
                ) : doc && totalPages > 0 ? (
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    {docViewMode === "continuous" ? (
                      Array.from({ length: totalPages }, (_, i) => (
                        <DocumentPageCard
                          key={`${doc.id}-p${i + 1}`}
                          src={api.previewUrl(doc.id, i + 1)}
                          pageNum={i + 1}
                          totalPages={totalPages}
                          zoom={docZoom}
                        />
                      ))
                    ) : (
                      <DocumentPageCard
                        key={`${doc.id}-single-${docPage}`}
                        src={api.previewUrl(doc.id, docPage)}
                        pageNum={docPage}
                        totalPages={totalPages}
                        zoom={docZoom}
                      />
                    )}
                  </Box>
                ) : (
                  <DropZoneCard
                    icon={<FileText size={32} />}
                    title="Open Original Document"
                    subtitle="Drop any PowerPoint (.pptx), Word (.docx), Excel (.xlsx), PDF, or image file here"
                    buttonText="Choose Document File"
                    onBrowse={() => docInputRef.current?.click()}
                    onDropFile={uploadDoc}
                  />
                )}
              </Box>

              {/* Left Pane Footer / Auto-convert action */}
              {doc && !mdContent && (
                <Paper square sx={{ p: 1.25, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Document loaded on left. Want to view its extracted Markdown?
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={mdConverting ? <CircularProgress size={13} color="inherit" /> : <Sparkles size={13} />}
                      onClick={convertUploadedDoc}
                      disabled={mdConverting}
                      sx={{ fontSize: 11.5, height: 26 }}
                    >
                      {mdConverting ? "Converting..." : "Auto-Convert to Markdown"}
                    </Button>
                  </Stack>
                </Paper>
              )}
            </Box>
          </Panel>

          <Separator className="pane-separator" />

          {/* Right Panel: Converted Markdown Viewer */}
          <Panel defaultSize="50" minSize="25">
            <Box
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.default",
              }}
            >
              {/* Right Pane Toolbar */}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  px: 2,
                  py: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  flexWrap: "wrap",
                  gap: 1,
                  minHeight: 48,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
                  <Box sx={{ color: "success.main", display: "flex" }}>
                    <FileCode size={16} />
                  </Box>
                  <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, fontSize: 13 }}>
                    {mdFilename || "Converted Markdown"}
                  </Typography>
                  {mdContent && (
                    <Chip
                      size="small"
                      label={`${countWords(mdContent).toLocaleString()} words`}
                      variant="outlined"
                      sx={{ fontSize: 10.5, height: 20 }}
                    />
                  )}
                  {mdContent && (
                    <Chip
                      size="small"
                      label={`${countLines(mdContent)} lines`}
                      variant="outlined"
                      sx={{ fontSize: 10.5, height: 20 }}
                    />
                  )}
                </Stack>

                {/* Knowledge base picker: loads BOTH panes. An Autocomplete
                    rather than a Select, because 214 documents is a list you
                    search, not one you scroll -- and their names are long and
                    near-identical ("L2C-WS020 - 16.07.2025 - ..."), so the part
                    a reviewer remembers is rarely the part it is sorted by. */}
                {kbFiles.length > 0 && (
                  <Autocomplete
                    openOnFocus
                    size="small"
                    disabled={kbLoading}
                    sx={{ width: { xs: 220, md: 300 } }}
                    options={kbFiles}
                    value={kbFiles.find((f) => f.source === selectedKbFile) ?? null}
                    onChange={(_, f) => f && handleSelectKbFile(f.source ?? f.name)}
                    isOptionEqualToValue={(a, b) => (a.source ?? a.name) === (b.source ?? b.name)}
                    getOptionLabel={(f) => f.title || f.name}
                    groupBy={(f) => f.category || "Unfiled"}
                    filterOptions={(opts, { inputValue }) => {
                      // Every word has to appear somewhere, in any order and in
                      // any field. Typing "returns pdf" finds the returns PDF
                      // whether the reviewer remembers the title, the format,
                      // the category or the folder it was indexed from -- and
                      // "ws020 minutes" finds the minutes without knowing that
                      // the file name spells the date out in the middle.
                      const words = inputValue.toLowerCase().split(/\s+/).filter(Boolean);
                      if (!words.length) return opts;
                      return opts.filter((f) => {
                        const hay = `${f.title} ${f.name} ${f.category ?? ""} ${f.source ?? ""}`.toLowerCase();
                        return words.every((w) => hay.includes(w));
                      });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={`Search ${kbFiles.length} documents…`}
                        slotProps={{
                          ...params.slotProps,
                          input: {
                            ...params.slotProps.input,
                            startAdornment: (
                              <>
                                <Box sx={{ pl: 0.5, pr: 0.5, display: "flex", color: "text.secondary" }}>
                                  {kbLoading ? <CircularProgress size={13} /> : <Search size={14} />}
                                </Box>
                                {params.slotProps.input.startAdornment}
                              </>
                            ),
                          },
                        }}
                        sx={{ "& .MuiInputBase-root": { height: 28, fontSize: 12 },
                              "& input": { fontSize: 12 } }}
                      />
                    )}
                    renderGroup={(params) => (
                      <Box key={params.key} component="li" sx={{ listStyle: "none" }}>
                        <ListSubheader
                          sx={{ bgcolor: "background.paper", lineHeight: "26px", fontSize: 10,
                                fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase",
                                color: "text.secondary", borderBottom: 1, borderColor: "divider" }}
                        >
                          {params.group}
                        </ListSubheader>
                        <Box component="ul" sx={{ p: 0, m: 0 }}>{params.children}</Box>
                      </Box>
                    )}
                    renderOption={(props, f) => {
                      const { key, ...rest } = props as { key?: string } & Record<string, unknown>;
                      return (
                        <Box component="li" key={f.source ?? f.name} {...rest}
                             sx={{ display: "block !important", py: 0.7, px: 1.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600 }} noWrap>
                            {f.title}
                          </Typography>
                          <Typography sx={{ fontSize: 10.5, color: "text.secondary" }} noWrap>
                            {f.category ?? "—"}
                            {f.chunks != null ? ` · ${f.chunks.toLocaleString()} chunks` : ""}
                            {f.source ? ` · ${f.source.replace(/\/markdown\/.*$/, "")}` : ""}
                          </Typography>
                        </Box>
                      );
                    }}
                    slotProps={{ paper: { sx: { width: 420 } }, listbox: { sx: { maxHeight: 420 } } }}
                    noOptionsText="No document matches those words"
                  />
                )}

                {/* Open MD File Button */}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<FolderOpen size={14} />}
                  onClick={() => mdInputRef.current?.click()}
                  sx={{ fontSize: 12, height: 28, px: 1.25 }}
                >
                  Open MD
                </Button>

                {/* Markdown Actions */}
                {mdContent && (
                  <>
                    <ToggleButtonGroup
                      size="small"
                      value={mdView}
                      exclusive
                      onChange={(_, v) => v && setMdView(v)}
                      sx={{ height: 28 }}
                    >
                      <ToggleButton value="rendered" sx={{ px: 1, py: 0 }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", fontSize: 12 }}>
                          <Eye size={13} />
                          <span>Rendered</span>
                        </Stack>
                      </ToggleButton>
                      <ToggleButton value="raw" sx={{ px: 1, py: 0 }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", fontSize: 12 }}>
                          <CodeXml size={13} />
                          <span>Raw</span>
                        </Stack>
                      </ToggleButton>
                    </ToggleButtonGroup>

                    <Tooltip title="Copy Markdown">
                      <IconButton size="small" onClick={handleCopy} sx={{ p: 0.5 }}>
                        {copied ? <Check size={15} color="var(--mui-palette-success-main)" /> : <Copy size={15} />}
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Download .md">
                      <IconButton size="small" onClick={handleDownload} sx={{ p: 0.5 }}>
                        <Download size={15} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>

              {/* Right Pane Body */}
              <Box
                ref={rightScrollRef}
                onScroll={() => handleScroll("right")}
                sx={{
                  flex: 1,
                  overflow: "auto",
                  p: 2.5,
                  bgcolor: "background.paper",
                }}
              >
                {mdConverting ? (
                  <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
                    <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
                      <CircularProgress size={36} color="success" />
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Extracting document and rebuilding Markdown structures...
                      </Typography>
                    </Stack>
                  </Box>
                ) : mdContent ? (
                  mdView === "rendered" ? (
                    <Box sx={{ maxWidth: "85ch", mx: "auto" }}>
                      <Markdown source={mdContent} diagrams />
                    </Box>
                  ) : (
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 2,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        font: "12.5px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace",
                        color: "text.primary",
                      }}
                    >
                      {mdContent}
                    </Box>
                  )
                ) : (
                  <DropZoneCard
                    icon={<FileCode size={32} />}
                    title="Open Converted Markdown"
                    subtitle="Drop a .md file here, select from your Knowledge Base, or convert the document on the left"
                    buttonText="Choose Markdown File"
                    onBrowse={() => mdInputRef.current?.click()}
                    onDropFile={openMdFile}
                  />
                )}
              </Box>
            </Box>
          </Panel>
        </Group>
      </Box>

      {/* Snackbar Notifications */}
      <Snackbar
        open={Boolean(notice)}
        onClose={(_, reason) => reason !== "clickaway" && setNotice(null)}
        autoHideDuration={3500}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice ? (
          <Alert severity="info" variant="filled" onClose={() => setNotice(null)} sx={{ alignItems: "center" }}>
            {notice}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}

// Subcomponent: Document Page Card with zoom and shadow
function DocumentPageCard({
  src,
  pageNum,
  totalPages,
  zoom,
}: {
  src: string;
  pageNum: number;
  totalPages: number;
  zoom: number;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Box
      sx={{
        width: `${zoom}%`,
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transition: "width 0.15s ease",
      }}
    >
      <Box
        sx={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 0.75,
          px: 0.5,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
          Page {pageNum} of {totalPages}
        </Typography>
      </Box>
      <Paper
        elevation={loaded ? 3 : 0}
        sx={{
          width: "100%",
          bgcolor: "#ffffff",
          borderRadius: 2,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          minHeight: loaded ? 0 : 260,
          display: "grid",
          placeItems: "center",
        }}
      >
        <motion.img
          src={src}
          alt={`Page ${pageNum}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: loaded ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
          }}
        />
        {!loaded && (
          <Box sx={{ p: 4, display: "flex", alignItems: "center", gap: 1, color: "text.disabled" }}>
            <CircularProgress size={18} color="inherit" />
            <Typography variant="caption">Loading page {pageNum}...</Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

// Subcomponent: Dropzone card for empty states
function DropZoneCard({
  icon,
  title,
  subtitle,
  buttonText,
  onBrowse,
  onDropFile,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  buttonText: string;
  onBrowse: () => void;
  onDropFile: (file: File) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      onDropFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <Box
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        height: "100%",
        minHeight: 320,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: 4,
        textAlign: "center",
        border: "2px dashed",
        borderColor: isDragOver ? "primary.main" : "divider",
        borderRadius: 3,
        bgcolor: (t) => (isDragOver ? alpha(t.palette.primary.main, 0.06) : surface(t, 0.3)),
        transition: "all 0.2s ease",
      }}
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
          color: "primary.main",
          mb: 2,
        }}
      >
        {icon}
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 360, mb: 2.5, fontSize: 13 }}>
        {subtitle}
      </Typography>
      <Button variant="contained" size="small" startIcon={<CloudUpload size={15} />} onClick={onBrowse} sx={{ px: 2 }}>
        {buttonText}
      </Button>
    </Box>
  );
}

