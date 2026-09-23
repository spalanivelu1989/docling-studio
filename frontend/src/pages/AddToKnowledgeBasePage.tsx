import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  Database,
  DatabaseZap,
  FileCode,
  FileText,
  FileUp,
  Filter,
  FolderUp,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  batchInsertKb,
  type KbBatchInsertHandlers,
  type KbFileItem,
  type RagStatus,
} from "../api";
import { clearAdornment, clearOnEscape } from "../components/ClearAdornment";
import { surface } from "../theme";

interface StagedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  tokensEstimate: number;
  status: "idle" | "running" | "done" | "error";
  chunks?: number;
  tokens?: number;
  duplicates?: string[];
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getDocumentExtension(file: KbFileItem): string {
  const titleMatch = file.title?.match(/\(([a-zA-Z0-9]+)\)$/);
  if (titleMatch) {
    return titleMatch[1].toLowerCase();
  }
  const nameMatch = file.name.match(/[_.]([a-zA-Z0-9]+)\.md$/i);
  if (nameMatch && !["md", "markdown"].includes(nameMatch[1].toLowerCase())) {
    return nameMatch[1].toLowerCase();
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext || "md";
}

function getExtensionColor(ext: string): { bg: string; color: string; border: string } {
  switch (ext.toLowerCase()) {
    case "xlsx":
    case "xls":
    case "csv":
      return { bg: "rgba(16, 185, 129, 0.12)", color: "#059669", border: "rgba(16, 185, 129, 0.35)" };
    case "docx":
    case "doc":
      return { bg: "rgba(37, 99, 235, 0.12)", color: "#2563eb", border: "rgba(37, 99, 235, 0.35)" };
    case "pptx":
    case "ppt":
      return { bg: "rgba(249, 115, 22, 0.12)", color: "#ea580c", border: "rgba(249, 115, 22, 0.35)" };
    case "pdf":
      return { bg: "rgba(239, 68, 68, 0.12)", color: "#dc2626", border: "rgba(239, 68, 68, 0.35)" };
    case "html":
    case "xml":
      return { bg: "rgba(139, 92, 246, 0.12)", color: "#7c3aed", border: "rgba(139, 92, 246, 0.35)" };
    default:
      return { bg: "rgba(107, 114, 128, 0.12)", color: "#4b5563", border: "rgba(107, 114, 128, 0.35)" };
  }
}

export default function AddToKnowledgeBasePage({ active }: { active: boolean }) {
  const theme = useTheme();

  // Status state
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [kbFiles, setKbFiles] = useState<KbFileItem[]>([]);
  const [loadingKbFiles, setLoadingKbFiles] = useState(false);

  // Staging state
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  // Nothing is asked about which corpus these join: they land in
  // knowledge_base/, which is the folder UNFILED claims, and every run reads
  // the whole corpus.
  const [dragging, setDragging] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [kbFilterQuery, setKbFilterQuery] = useState("");
  const [selectedExtension, setSelectedExtension] = useState<string>("all");

  // Ingestion state
  const [isInserting, setIsInserting] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState<number | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [completionSummary, setCompletionSummary] = useState<{
    succeeded: number;
    failed: number;
    total_chunks: number;
    total_tokens: number;
    seconds: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<KbFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // A delete that removed nothing used to close the dialog and report success,
  // so the only visible symptom was a count that would not move.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRepoMinimized, setIsRepoMinimized] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Every number on this page comes from here, and every path that can change
  // the corpus calls it -- including the ones that fail. A batch that errors or
  // is stopped halfway has still inserted the documents it got through, so
  // leaving the counts alone would report a corpus that no longer exists.
  const loadStatus = useCallback(() => {
    const status = api.ragStatus()
      .then(setRagStatus)
      .catch(() => setRagStatus(null));
    setLoadingKbFiles(true);
    const files = api.kbFiles()
      .then(setKbFiles)
      .catch(() => setKbFiles([]))
      .finally(() => setLoadingKbFiles(false));
    return Promise.all([status, files]);
  }, []);

  useEffect(() => {
    if (active) {
      loadStatus();
    }
  }, [active, loadStatus]);

  // The corpus also changes from places this page cannot see: the Convert and
  // Batch Convert tabs, the CLI, a second browser window. Coming back to the
  // page is the moment those numbers are about to be read, so that is when
  // they are re-read.
  useEffect(() => {
    if (!active) return;
    const onFocus = () => loadStatus();
    const onVisible = () => { if (!document.hidden) loadStatus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, loadStatus]);

  // Handle file addition
  const handleAddFiles = useCallback((incomingFiles: FileList | File[]) => {
    const validExts = [".md", ".markdown", ".txt"];
    const newItems: StagedFile[] = [];

    Array.from(incomingFiles).forEach((file) => {
      const name = file.name;
      if (name.startsWith(".") || name.startsWith("~$")) return;
      const lower = name.toLowerCase();
      if (!validExts.some((ext) => lower.endsWith(ext))) return;

      // Estimate tokens (~4 chars per token)
      const tokensEst = Math.max(1, Math.round(file.size / 4));

      newItems.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        size: file.size,
        tokensEstimate: tokensEst,
        status: "idle",
      });
    });

    if (newItems.length > 0) {
      setStagedFiles((prev) => {
        // Prevent duplicate names in staging
        const existingNames = new Set(prev.map((f) => f.name));
        const filteredNew = newItems.filter((f) => !existingNames.has(f.name));
        return [...prev, ...filteredNew];
      });
      setCompletionSummary(null);
      setErrorMessage(null);
    }
  }, []);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // Remove single file
  const handleRemoveFile = (id: string) => {
    if (isInserting) return;
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Clear all staged
  const handleClearAll = () => {
    if (isInserting) return;
    setStagedFiles([]);
    setCompletionSummary(null);
    setErrorMessage(null);
  };

  // Run Batch Insert
  const handleInsert = async () => {
    if (stagedFiles.length === 0 || isInserting) return;

    setIsInserting(true);
    setCompletionSummary(null);
    setErrorMessage(null);

    // Reset status of all staged items
    setStagedFiles((prev) => prev.map((f) => ({ ...f, status: "idle", error: undefined })));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const filesToUpload = stagedFiles.map((s) => s.file);

    const handlers: KbBatchInsertHandlers = {
      onProgress: ({ index, filename }) => {
        setCurrentFileIndex(index);
        setCurrentFileName(filename);
        setStagedFiles((prev) =>
          prev.map((f) => (f.name === filename ? { ...f, status: "running" } : f))
        );
      },
      onFileDone: ({ filename, chunks, tokens, duplicates }) => {
        setStagedFiles((prev) =>
          prev.map((f) =>
            f.name === filename
              ? { ...f, status: "done", chunks, tokens, duplicates }
              : f
          )
        );
      },
      onFileError: ({ filename, error }) => {
        setStagedFiles((prev) =>
          prev.map((f) => (f.name === filename ? { ...f, status: "error", error } : f))
        );
      },
      onComplete: (summary) => {
        setCompletionSummary(summary);
        setIsInserting(false);
        setCurrentFileIndex(null);
        setCurrentFileName("");
        abortControllerRef.current = null;
        loadStatus();
      },
      onError: (err) => {
        setErrorMessage(err);
        setIsInserting(false);
        setCurrentFileIndex(null);
        setCurrentFileName("");
        abortControllerRef.current = null;
        // Whatever got through before the failure is in the corpus now.
        loadStatus();
      },
    };

    try {
      await batchInsertKb(filesToUpload, handlers, controller.signal);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setErrorMessage("Insertion stopped by user.");
      } else {
        setErrorMessage((err as Error).message || "Batch insertion failed.");
      }
      setIsInserting(false);
      setCurrentFileIndex(null);
      setCurrentFileName("");
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // An aborted batch has already inserted everything it reached, so the
    // counts have moved even though the run did not finish.
    loadStatus();
  };

  // Delete confirmed KB file
  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // The list row knows the path this document was indexed from, and that
      // identifies it. Sending it is what stops a document that only shares a
      // file name going with it.
      // full_path, not source: the server stores the resolved absolute path,
      // and source is shown relative to the project. Without one the server
      // refuses an ambiguous name, which is the right answer.
      const res = await api.deleteKbFile(fileToDelete.name, fileToDelete.full_path);
      setFileToDelete(null);
      loadStatus();
      if (!res.deleted_from_db && !res.file_removed) {
        setErrorMessage(`'${fileToDelete.name}' was not removed — nothing matched it.`);
      }
    } catch (err) {
      // Keep the dialog open and say why. The server refuses a delete it
      // cannot address, and that message is the one thing that explains an
      // unchanged count.
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
      loadStatus();
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered lists
  const filteredStagedFiles = useMemo(() => {
    if (!filterQuery.trim()) return stagedFiles;
    const q = filterQuery.toLowerCase();
    return stagedFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [stagedFiles, filterQuery]);

  // Available extensions in repository with document counts
  const availableExtensions = useMemo(() => {
    const counts: Record<string, number> = {};
    kbFiles.forEach((file) => {
      const ext = getDocumentExtension(file);
      counts[ext] = (counts[ext] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [kbFiles]);

  // The list counts two different things: documents indexed in pgvector and
  // Markdown files sitting in the workspace with nothing indexed behind them.
  // Showing only the total is what made the header disagree with the database
  // count above it, with no way to see where the difference came from.
  const indexedCount = useMemo(() => kbFiles.filter((f) => f.is_indexed).length, [kbFiles]);
  const unindexedCount = kbFiles.length - indexedCount;
  // /api/rag/status and /api/kb/files count the same rows of the same table,
  // so once both have loaded they cannot honestly differ. If they do, one
  // response is older than the other and the page is showing a corpus that is
  // no longer there -- worth saying out loud rather than picking one.
  const countsDisagree =
    !!ragStatus && !loadingKbFiles && kbFiles.length > 0 && ragStatus.documents !== indexedCount;

  const filteredKbFiles = useMemo(() => {
    let result = kbFiles;
    if (selectedExtension !== "all") {
      result = result.filter((f) => getDocumentExtension(f) === selectedExtension);
    }
    if (kbFilterQuery.trim()) {
      const q = kbFilterQuery.toLowerCase();
      result = result.filter(
        (f) =>
          (f.title && f.title.toLowerCase().includes(q)) ||
          f.name.toLowerCase().includes(q) ||
          (f.source && f.source.toLowerCase().includes(q))
      );
    }
    return result;
  }, [kbFiles, kbFilterQuery, selectedExtension]);

  const totalStagedSize = useMemo(() => {
    return stagedFiles.reduce((acc, f) => acc + f.size, 0);
  }, [stagedFiles]);

  const totalStagedTokens = useMemo(() => {
    return stagedFiles.reduce((acc, f) => acc + f.tokensEstimate, 0);
  }, [stagedFiles]);

  const completedCount = useMemo(() => {
    return stagedFiles.filter((f) => f.status === "done").length;
  }, [stagedFiles]);

  const progressPercent = useMemo(() => {
    if (stagedFiles.length === 0) return 0;
    return Math.round((completedCount / stagedFiles.length) * 100);
  }, [completedCount, stagedFiles.length]);

  return (
    <Box sx={{ height: "100%", overflowY: "auto", bgcolor: "background.default", p: { xs: 2, md: 3 } }}>
      <Container maxWidth="xl" disableGutters>
        {/* Top Header Card */}
        <Paper
          sx={{
            p: { xs: 2.5, md: 3 },
            mb: 3,
            borderRadius: 3,
            position: "relative",
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 240,
              height: 240,
              borderRadius: "50%",
              bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
              pointerEvents: "none",
            }}
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
            <Box>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 0.5 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2.5,
                    display: "grid",
                    placeItems: "center",
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                    color: "primary.main",
                  }}
                >
                  <DatabaseZap size={22} />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
                  Add to Knowledge Base
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 750 }}>
                Upload Markdown files straight into the corpus. Each file is parsed, chunked with
                structure awareness, and embedded using <strong>Ollama BGE-M3 (1024d)</strong> for hybrid RAG search.
              </Typography>
            </Box>

            {/* Live Knowledge Base Status Badges */}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
              <Tooltip title="Local embedding model active for vector indexing">
                <Chip
                  size="small"
                  icon={<Zap size={14} />}
                  label={`Ollama ${ragStatus?.embed_model || "bge-m3"} (${ragStatus?.embed_dimension || 1024}d)`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />
              </Tooltip>

              <Tooltip title={countsDisagree
                ? `${ragStatus?.documents ?? 0} documents in PostgreSQL pgvector, but the list below `
                  + `reports ${indexedCount}. One of the two is stale -- press refresh.`
                : "Documents and chunks currently stored in PostgreSQL pgvector"}>
                <Chip
                  size="small"
                  icon={<Database size={14} />}
                  label={`${ragStatus?.documents ?? 0} docs · ${(ragStatus?.chunks ?? 0).toLocaleString()} chunks`}
                  variant="outlined"
                  color={countsDisagree ? "warning" : "default"}
                  sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                />
              </Tooltip>

              <Tooltip title="Refresh Knowledge Base statistics">
                <IconButton size="small" onClick={loadStatus} aria-label="Refresh status">
                  <RefreshCw size={15} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </Paper>

        {/* Ingestion Workspace Grid */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "420px minmax(0, 1fr)" }, gap: 3, alignItems: "start", mb: 4 }}>
          {/* Left Column: Dropzone & Actions */}
          <Stack spacing={2.5}>
            {/* Dropzone Card */}
            <Paper
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              sx={{
                p: 3,
                borderRadius: 3,
                textAlign: "center",
                border: "2px dashed",
                borderColor: dragging ? "primary.main" : "divider",
                bgcolor: (t) => (dragging ? alpha(t.palette.primary.main, 0.05) : "background.paper"),
                transition: "all 0.2s ease",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Box
                component={motion.div}
                animate={dragging ? { scale: 1.1 } : { scale: 1 }}
                sx={{
                  width: 58,
                  height: 58,
                  borderRadius: "50%",
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                  color: "primary.main",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <FileUp size={28} />
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Drop .md files here
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", maxWidth: 300, mx: "auto" }}>
                  Supports multiple Markdown documents (<code>.md</code>, <code>.markdown</code>, <code>.txt</code>)
                </Typography>
              </Box>

              <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<FileText size={16} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isInserting}
                  sx={{ borderRadius: 2 }}
                >
                  Select Files
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<FolderUp size={16} />}
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isInserting}
                  sx={{ borderRadius: 2 }}
                >
                  Select Folder
                </Button>
              </Stack>

              {/* Hidden Inputs */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.markdown,.txt"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) handleAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is standard for folder upload
                webkitdirectory=""
                directory=""
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) handleAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </Paper>

            {/* Action Card */}
            <Paper sx={{ p: 2.5, borderRadius: 3, border: 1, borderColor: "divider" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Insertion Controls
              </Typography>

              <Stack spacing={2}>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Staged Documents
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {stagedFiles.length} files ({formatBytes(totalStagedSize)})
                  </Typography>
                </Stack>

                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Est. Total Tokens
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    ~{totalStagedTokens.toLocaleString()} tokens
                  </Typography>
                </Stack>

                <Divider />

                <Stack direction="row" spacing={1.5}>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    color="primary"
                    startIcon={isInserting ? <Loader2 size={18} className="animate-spin" /> : <DatabaseZap size={18} />}
                    onClick={handleInsert}
                    disabled={stagedFiles.length === 0 || isInserting}
                    sx={{ borderRadius: 2, fontWeight: 700 }}
                  >
                    {isInserting
                      ? `Embedding ${currentFileIndex || 0} of ${stagedFiles.length}...`
                      : "Insert into knowledge base"}
                  </Button>

                  {isInserting && (
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleStop}
                      startIcon={<Square size={14} />}
                      sx={{ borderRadius: 2 }}
                    >
                      Stop
                    </Button>
                  )}
                </Stack>

                {stagedFiles.length > 0 && !isInserting && (
                  <Button
                    variant="text"
                    color="inherit"
                    size="small"
                    onClick={handleClearAll}
                    startIcon={<Trash2 size={14} />}
                    sx={{ color: "text.secondary" }}
                  >
                    Clear Staged Queue
                  </Button>
                )}
              </Stack>
            </Paper>

            {/* Completion or Error Banners */}
            <AnimatePresence>
              {completionSummary && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Alert
                    severity={completionSummary.failed > 0 ? "warning" : "success"}
                    icon={<CheckCircle2 size={18} />}
                    sx={{ borderRadius: 2 }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Insertion Complete ({completionSummary.seconds}s)
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 13 }}>
                      Successfully embedded {completionSummary.succeeded} files into pgvector (
                      {completionSummary.total_chunks} chunks, {completionSummary.total_tokens.toLocaleString()} tokens).
                      {completionSummary.failed > 0 && ` ${completionSummary.failed} files had errors.`}
                    </Typography>
                  </Alert>
                </motion.div>
              )}

              {errorMessage && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Alert severity="error" icon={<AlertCircle size={18} />} sx={{ borderRadius: 2 }}>
                    {errorMessage}
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>
          </Stack>

          {/* Right Column: Staged Queue Table & Progress */}
          <Paper sx={{ borderRadius: 3, border: 1, borderColor: "divider", overflow: "hidden", minHeight: 450, display: "flex", flexDirection: "column" }}>
            {/* Queue Header & Search */}
            <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Staged Files Queue
                </Typography>
                <Chip size="small" label={`${stagedFiles.length}`} sx={{ fontWeight: 700 }} />
              </Stack>

              <TextField
                size="small"
                placeholder="Filter files..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={clearOnEscape(() => setFilterQuery(""))}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search size={15} />
                      </InputAdornment>
                    ),
                    endAdornment: clearAdornment(filterQuery, () => setFilterQuery(""),
                                                 { label: "Clear filter" }),
                    sx: { fontSize: 13, height: 34, width: { xs: 150, sm: 220 } },
                  },
                }}
              />
            </Box>

            {/* Live Progress Bar when inserting */}
            {isInserting && (
              <Box sx={{ width: "100%" }}>
                <LinearProgress variant="determinate" value={progressPercent} sx={{ height: 6 }} />
                <Box sx={{ px: 2, py: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.08), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: "primary.main" }}>
                    Embedding: {currentFileName || "processing..."}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {progressPercent}% ({completedCount}/{stagedFiles.length})
                  </Typography>
                </Box>
              </Box>
            )}

            {/* Table Area */}
            <TableContainer sx={{ flex: 1, maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Document Name</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 100 }}>Size</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>Est. Tokens</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 160 }}>Status</TableCell>
                    <TableCell align="right" sx={{ width: 50 }}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredStagedFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                          <FileCode size={36} strokeWidth={1.5} color={theme.palette.text.secondary} />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {stagedFiles.length === 0
                              ? "No files staged yet. Drag & drop .md files or click 'Select Files' to get started."
                              : "No staged files match your search."}
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStagedFiles.map((item) => (
                      <TableRow key={item.id} hover>
                        <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <FileText size={16} color={theme.palette.primary.main} />
                            <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                              {item.name}
                            </Typography>
                          </Stack>
                        </TableCell>

                        <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                          {formatBytes(item.size)}
                        </TableCell>

                        <TableCell sx={{ fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                          ~{item.tokensEstimate.toLocaleString()}
                        </TableCell>

                        <TableCell>
                          {item.status === "idle" && (
                            <Chip size="small" label="Ready" variant="outlined" sx={{ fontSize: 11 }} />
                          )}
                          {item.status === "running" && (
                            <Chip
                              size="small"
                              color="primary"
                              icon={<Loader2 size={12} className="animate-spin" />}
                              label="Embedding..."
                              sx={{ fontSize: 11 }}
                            />
                          )}
                          {item.status === "done" && (
                            <Tooltip title={`Indexed into pgvector: ${item.chunks} chunks, ${item.tokens} tokens`}>
                              <Chip
                                size="small"
                                color="success"
                                icon={<CheckCircle2 size={12} />}
                                label={`${item.chunks} chunks`}
                                sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                              />
                            </Tooltip>
                          )}
                          {item.status === "error" && (
                            <Tooltip title={item.error || "Failed to embed"}>
                              <Chip
                                size="small"
                                color="error"
                                icon={<AlertCircle size={12} />}
                                label="Error"
                                sx={{ fontSize: 11 }}
                              />
                            </Tooltip>
                          )}
                        </TableCell>

                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={() => handleRemoveFile(item.id)}
                            disabled={isInserting}
                            sx={{ opacity: 0.7, "&:hover": { opacity: 1, color: "error.main" } }}
                          >
                            <X size={15} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>

        {/* Bottom Section: Existing Knowledge Base Repository Explorer */}
        <Paper
          sx={{
            p: 3,
            borderRadius: 3,
            border: 1,
            borderColor: "divider",
            transition: "box-shadow 0.2s ease, border-color 0.2s ease",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            sx={{
              justifyContent: "space-between",
              alignItems: { sm: "center" },
              cursor: "pointer",
              userSelect: "none",
            }}
            spacing={2}
            onClick={() => setIsRepoMinimized((prev) => !prev)}
          >
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 750, letterSpacing: "-0.01em" }}>
                  Knowledge Base Repository Documents
                </Typography>
                {/* The database count first, so this chip and the one in the
                    header are the same number. The table can hold more rows
                    than the corpus holds documents -- a Markdown file in the
                    workspace that nothing has indexed is a row with no
                    document behind it -- and when it does, the chip says so
                    rather than quietly disagreeing with the header. */}
                <Tooltip title={unindexedCount
                  ? `${indexedCount} indexed in pgvector, ${kbFiles.length} rows below: `
                    + `${unindexedCount} file(s) are in the workspace with nothing indexed behind them`
                  : `${indexedCount} indexed in pgvector, and every row below is one of them`}>
                  <Chip size="small" sx={{ fontWeight: 700 }}
                        label={unindexedCount ? `${indexedCount} of ${kbFiles.length}` : `${indexedCount}`} />
                </Tooltip>
                {unindexedCount > 0 && (
                  <Tooltip title="Markdown files in the workspace with no document indexed behind them. They are searchable only once indexed.">
                    <Chip size="small" variant="outlined" color="warning"
                          label={`${unindexedCount} not indexed`}
                          sx={{ fontWeight: 600, fontSize: 11 }} />
                  </Tooltip>
                )}
                <AnimatePresence>
                  {isRepoMinimized && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label="Minimized"
                        sx={{ fontSize: 11, color: "text.secondary", borderColor: "divider" }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Stack>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                All documents indexed in PostgreSQL pgvector and Markdown files available in the workspace.
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center" }}
              onClick={(e) => e.stopPropagation()}
            >
              <AnimatePresence>
                {!isRepoMinimized && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
                    style={{ overflow: "hidden", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <TextField
                      size="small"
                      placeholder="Search repository..."
                      value={kbFilterQuery}
                      onChange={(e) => setKbFilterQuery(e.target.value)}
                      onKeyDown={clearOnEscape(() => setKbFilterQuery(""))}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <Search size={15} />
                            </InputAdornment>
                          ),
                          endAdornment: clearAdornment(kbFilterQuery, () => setKbFilterQuery("")),
                          sx: { fontSize: 13, height: 34, width: { xs: 140, sm: 190 } },
                        },
                      }}
                    />
                    <FormControl size="small">
                      <Select
                        value={selectedExtension}
                        onChange={(e) => setSelectedExtension(e.target.value)}
                        displayEmpty
                        sx={{
                          height: 34,
                          fontSize: 12.5,
                          fontWeight: 600,
                          minWidth: { xs: 130, sm: 155 },
                          bgcolor: (t) => alpha(t.palette.background.paper, 0.6),
                        }}
                        startAdornment={
                          <InputAdornment position="start">
                            <Filter size={13} />
                          </InputAdornment>
                        }
                      >
                        <MenuItem value="all" sx={{ fontSize: 12.5, fontWeight: 600 }}>
                          All Formats ({kbFiles.length})
                        </MenuItem>
                        {availableExtensions.map(([ext, count]) => {
                          const colors = getExtensionColor(ext);
                          return (
                            <MenuItem key={ext} value={ext} sx={{ fontSize: 12.5 }}>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                                <Box
                                  sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    bgcolor: colors.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <span>.{ext.toUpperCase()}</span>
                                <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
                                  ({count})
                                </Typography>
                              </Box>
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshCw size={14} />}
                onClick={loadStatus}
                disabled={loadingKbFiles}
              >
                Refresh
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={() => setIsRepoMinimized((prev) => !prev)}
                sx={{
                  textTransform: "none",
                  fontWeight: 600,
                  minWidth: 102,
                  transition: "all 0.2s ease",
                }}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <motion.span
                    animate={{ rotate: isRepoMinimized ? 180 : 0 }}
                    transition={{ duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
                    style={{ display: "inline-flex", alignItems: "center" }}
                  >
                    <ChevronUp size={15} />
                  </motion.span>
                  <span>{isRepoMinimized ? "Expand" : "Minimize"}</span>
                </Stack>
              </Button>
            </Stack>
          </Stack>

          <AnimatePresence initial={false}>
            {!isRepoMinimized && (
              <motion.div
                key="repo-table-content"
                initial={{ opacity: 0, height: 0 }}
                animate={{
                  opacity: 1,
                  height: "auto",
                  transition: {
                    height: { duration: 0.4, ease: [0.25, 1, 0.5, 1] },
                    opacity: { duration: 0.28, delay: 0.08 },
                  },
                }}
                exit={{
                  opacity: 0,
                  height: 0,
                  transition: {
                    height: { duration: 0.35, ease: [0.25, 1, 0.5, 1] },
                    opacity: { duration: 0.18 },
                  },
                }}
                style={{ overflow: "hidden" }}
              >
                <Box sx={{ pt: 2.5 }}>
                  <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: (t) => surface(t, 0.4) }}>
                          <TableCell sx={{ fontWeight: 700 }}>Document Title</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Location / Source</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>File Size</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Vector Chunks</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Total Tokens</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredKbFiles.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} sx={{ textAlign: "center", py: 5, color: "text.secondary" }}>
                              {kbFiles.length === 0
                                ? "No documents in the knowledge base yet. Upload and insert files above!"
                                : selectedExtension !== "all"
                                ? `No .${selectedExtension.toUpperCase()} documents match your search query.`
                                : "No documents match your search query."}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredKbFiles.map((file) => {
                            const ext = getDocumentExtension(file);
                            const colors = getExtensionColor(ext);
                            return (
                              <TableRow key={file.name} hover>
                                <TableCell sx={{ fontWeight: 600 }}>
                                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                    <Chip
                                      size="small"
                                      label={`.${ext.toUpperCase()}`}
                                      sx={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        height: 20,
                                        fontFamily: "monospace",
                                        bgcolor: colors.bg,
                                        color: colors.color,
                                        border: "1px solid",
                                        borderColor: colors.border,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {file.title}
                                    </Typography>
                                  </Stack>
                                </TableCell>
                                <TableCell sx={{ color: "text.secondary", fontSize: 12 }}>
                                  <code>{file.source || file.name}</code>
                                </TableCell>
                                <TableCell sx={{ color: "text.secondary", fontSize: 12 }}>{formatBytes(file.size)}</TableCell>
                                <TableCell>
                                  <Chip
                                    size="small"
                                    label={file.is_indexed ? `${file.chunks ?? 0} chunks` : "Unindexed"}
                                    color={file.is_indexed ? "success" : "default"}
                                    variant={file.is_indexed ? "filled" : "outlined"}
                                    sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                                  />
                                </TableCell>
                                <TableCell sx={{ color: "text.secondary", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                                  {(file.tokens ?? 0).toLocaleString()}
                                </TableCell>
                                <TableCell align="right">
                                  <Tooltip title="Delete from knowledge base">
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => { setDeleteError(null); setFileToDelete(file); }}
                                    >
                                      <Trash2 size={14} />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </motion.div>
            )}
          </AnimatePresence>
        </Paper>
      </Container>

      {/* Delete Confirmation Modal */}
      <Dialog
        open={Boolean(fileToDelete)}
        onClose={() => !isDeleting && (setDeleteError(null), setFileToDelete(null))}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2.5,
              p: 0.5,
            },
          },
        }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, pb: 1 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              bgcolor: alpha(theme.palette.error.main, 0.1),
              color: "error.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Trash2 size={18} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
              Delete Document
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Confirm deletion from knowledge base
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <DialogContentText sx={{ fontSize: 13.5, color: "text.primary", mb: 1.5 }}>
            Are you sure you want to remove this document from the knowledge base?
          </DialogContentText>
          {fileToDelete && (
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "grey.50"),
                border: "1px solid",
                borderColor: "divider",
                fontSize: 12.5,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, wordBreak: "break-word" }}>
                {fileToDelete.title || fileToDelete.name}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  color: "text.secondary",
                  fontFamily: "monospace",
                  mb: 0.75,
                  wordBreak: "break-all",
                }}
              >
                {fileToDelete.source || fileToDelete.name}
              </Typography>
              {fileToDelete.chunks !== undefined && fileToDelete.chunks > 0 && (
                <Typography variant="caption" sx={{ color: "error.main", display: "block" }}>
                  Permanently removes {fileToDelete.chunks} vector chunks and embeddings from PostgreSQL pgvector.
                </Typography>
              )}
            </Box>
          )}
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            disabled={isDeleting}
            onClick={() => { setDeleteError(null); setFileToDelete(null); }}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={isDeleting}
            onClick={handleConfirmDelete}
            startIcon={isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {isDeleting ? "Deleting..." : "Delete Document"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
