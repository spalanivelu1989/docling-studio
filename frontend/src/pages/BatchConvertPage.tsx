import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  CodeXml,
  Copy,
  Cpu,
  DatabaseZap,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  FileUp,
  FolderArchive,
  FolderUp,
  Layers,
  Loader2,
  Play,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { BatchEmbedSummary } from "../api";
import Markdown from "../components/Markdown";

const ACCEPT = ".pptx,.ppt,.docx,.doc,.xlsx,.xls,.xlsm,.pdf,.html,.htm,.xml,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif";

const PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic API)" },
  { value: "openai", label: "GPT (OpenAI API)" },
  { value: "qwen", label: "Qwen3-VL (local)" },
];

export interface ToolBreakdown {
  primary_engine: string;
  format: string;
  vlm_used: boolean;
  vlm_provider: string | null;
  claude_vlm_images: number;
  vlm_images: number;
  tesseract_ocr_images: number;
  table_cv_tables: number;
  flowcharts: number;
  skipped_images: number;
  total_pictures: number;
  pages_or_sheets: number;
  unit: string;
  elapsed: number;
  markdown_length: number;
}

export interface ConvertedFile {
  index: number;
  filename: string;
  dest_name: string;
  markdown: string;
  tools: ToolBreakdown;
}

export interface FileEmbedInfo {
  status: "added" | "updated" | "unchanged" | "error";
  chunks?: number;
  tokens?: number;
  error?: string;
  duplicates?: string[];
}

export interface QueuedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
  result?: ConvertedFile;
  embed?: FileEmbedInfo;
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function BatchConvertPage() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [vlm, setVlm] = useState(true);
  const [provider, setProvider] = useState("claude");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // pgvector Knowledge Base bulk embedding state
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [embedSummary, setEmbedSummary] = useState<BatchEmbedSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputId = useId();
  const folderInputId = useId();

  // Timer while batch is running
  useEffect(() => {
    if (!converting || !startTime) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startTime) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [converting, startTime]);

  const addFilesToQueue = (files: FileList | File[]) => {
    const newItems: QueuedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.name.startsWith("~$") || f.name.startsWith(".")) continue;
      const ext = "." + f.name.split(".").pop()?.toLowerCase();
      if (!ACCEPT.split(",").includes(ext)) continue;
      newItems.push({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        name: f.name,
        size: f.size,
        status: "pending",
      });
    }
    if (newItems.length === 0) {
      setNotice("No supported files found in selection.");
      return;
    }
    setQueue((prev) => [...prev, ...newItems]);
    setNotice(`Added ${newItems.length} file(s) to the conversion queue.`);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const clearQueue = () => {
    if (converting || embedding) return;
    setQueue([]);
    setBatchId(null);
    setSelectedFileId(null);
    setNotice("Cleared queue.");
    setEmbedSummary(null);
    setEmbedProgress(null);
  };

  // Start batch conversion
  const startBatch = async () => {
    if (queue.length === 0 || converting || embedding) return;

    setConverting(true);
    setStartTime(Date.now());
    setElapsedSeconds(0);
    setEmbedSummary(null);
    setEmbedProgress(null);

    // Reset all queue statuses
    setQueue((prev) => prev.map((q) => ({ ...q, status: "pending", error: undefined, embed: undefined })));

    try {
      // 1. Upload files
      const formData = new FormData();
      queue.forEach((q) => {
        formData.append("files", q.file, q.name);
      });

      const upRes = await fetch("/api/batch/upload", {
        method: "POST",
        body: formData,
      });

      if (!upRes.ok) {
        const errJson = await upRes.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload failed (${upRes.status})`);
      }

      const upData = await upRes.json();
      const currentBatchId = upData.batch_id;
      setBatchId(currentBatchId);

      // 2. Start SSE conversion stream
      const convRes = await fetch(`/api/batch/convert/${currentBatchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vlm, provider }),
      });

      if (!convRes.ok || !convRes.body) {
        throw new Error(`Batch conversion failed to start (${convRes.status})`);
      }

      const reader = convRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;
          let eventType = "message";
          let dataStr = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === "progress") {
              setQueue((prev) =>
                prev.map((item) => (item.name === data.filename ? { ...item, status: "converting" } : item))
              );
            } else if (eventType === "file_done") {
              const resFile: ConvertedFile = {
                index: data.index,
                filename: data.filename,
                dest_name: data.dest_name,
                markdown: data.markdown,
                tools: data.tools,
              };
              setQueue((prev) =>
                prev.map((item) =>
                  item.name === data.filename ? { ...item, status: "done", result: resFile } : item
                )
              );
              // Auto-select first converted file if nothing selected
              setSelectedFileId((prev) => prev || queue.find((q) => q.name === data.filename)?.id || null);
            } else if (eventType === "file_error") {
              setQueue((prev) =>
                prev.map((item) =>
                  item.name === data.filename ? { ...item, status: "error", error: data.error } : item
                )
              );
            } else if (eventType === "batch_done") {
              setNotice(`Batch finished: ${data.converted} converted, ${data.failed} failed.`);
            }
          } catch {
            /* ignore parse errors on malformed chunks */
          }
        }
      }
    } catch (err) {
      setNotice(`Batch conversion error: ${(err as Error).message}`);
    } finally {
      setConverting(false);
    }
  };

  // Bulk insert converted Markdown files into pgvector Knowledge Base
  const embedBatch = async () => {
    if (!batchId || embedding || converting) return;
    setEmbedding(true);
    setEmbedSummary(null);
    setNotice("Connecting to pgvector knowledge base...");

    try {
      const res = await fetch(`/api/batch/${batchId}/embed`, {
        method: "POST",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Embedding failed (${res.status})`);
      }

      if (!res.body) throw new Error("No response body from server");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;
          let eventType = "message";
          let dataStr = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === "progress") {
              setEmbedProgress({
                current: data.index,
                total: data.total,
                filename: data.filename,
              });
            } else if (eventType === "file_done") {
              setQueue((prev) =>
                prev.map((item) => {
                  const match =
                    item.result?.dest_name === data.filename ||
                    item.name === data.filename ||
                    data.filename.startsWith(item.name.replace(/\.[^/.]+$/, ""));
                  if (match) {
                    return {
                      ...item,
                      embed: {
                        status: data.status,
                        chunks: data.chunks,
                        tokens: data.tokens,
                        duplicates: data.duplicates,
                      },
                    };
                  }
                  return item;
                })
              );
            } else if (eventType === "file_error") {
              setQueue((prev) =>
                prev.map((item) => {
                  const match =
                    item.result?.dest_name === data.filename ||
                    item.name === data.filename ||
                    data.filename.startsWith(item.name.replace(/\.[^/.]+$/, ""));
                  if (match) {
                    return {
                      ...item,
                      embed: {
                        status: "error",
                        error: data.error,
                      },
                    };
                  }
                  return item;
                })
              );
            } else if (eventType === "batch_done") {
              setEmbedSummary({
                total: data.total,
                succeeded: data.succeeded,
                failed: data.failed,
                total_chunks: data.total_chunks,
                total_tokens: data.total_tokens,
                db_documents: data.db_documents,
                db_chunks: data.db_chunks,
                seconds: data.seconds,
              });
              setNotice(
                `Bulk embedding complete: ${data.succeeded} document(s) stored in pgvector (${data.total_chunks} chunks) in ${data.seconds}s.`
              );
            } else if (eventType === "error") {
              setNotice(`Embedding error: ${data.error}`);
            }
          } catch {
            /* ignore parse errors on partial chunks */
          }
        }
      }
    } catch (err) {
      setNotice(`Bulk embedding error: ${(err as Error).message}`);
    } finally {
      setEmbedding(false);
      setEmbedProgress(null);
    }
  };

  const goToAskPage = () => {
    history.pushState(null, "", "/ask");
    dispatchEvent(new PopStateEvent("popstate"));
  };

  const completedFiles = queue.filter((q) => q.status === "done" && q.result).map((q) => q.result!);
  const completedCount = completedFiles.length;
  const errorCount = queue.filter((q) => q.status === "error").length;

  const embeddedItems = queue.filter((q) => q.embed && q.embed.status !== "error");
  const isAllEmbedded =
    completedCount > 0 &&
    queue.filter((q) => q.status === "done").every((q) => q.embed && q.embed.status !== "error");

  // Selected file for inspection
  const selectedItem = queue.find((q) => q.id === selectedFileId) || queue.find((q) => q.result);
  const selectedResult = selectedItem?.result;

  // Aggregate stats across all completed files
  const totalClaudeVlm = completedFiles.reduce((acc, f) => acc + (f.tools.claude_vlm_images || 0), 0);
  const totalTesseract = completedFiles.reduce((acc, f) => acc + (f.tools.tesseract_ocr_images || 0), 0);
  const totalCvTables = completedFiles.reduce((acc, f) => acc + (f.tools.table_cv_tables || 0), 0);
  const totalFlows = completedFiles.reduce((acc, f) => acc + (f.tools.flowcharts || 0), 0);
  const totalUnits = completedFiles.reduce((acc, f) => acc + (f.tools.pages_or_sheets || 0), 0);

  const handleCopyMarkdown = async () => {
    if (!selectedResult?.markdown) return;
    await navigator.clipboard.writeText(selectedResult.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setNotice(`Copied ${selectedResult.filename} markdown.`);
  };

  const handleDownloadSingle = () => {
    if (!selectedResult?.markdown) return;
    const blob = new Blob([selectedResult.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedResult.dest_name || `${selectedResult.filename}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Hidden file inputs */}
      <input
        id={filesInputId}
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) addFilesToQueue(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <input
        id={folderInputId}
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard in browsers
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) addFilesToQueue(e.target.files);
          if (folderInputRef.current) folderInputRef.current.value = "";
        }}
      />

      {/* Top Controls Toolbar */}
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
              <FolderArchive size={18} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "text.primary" }}>
              Batch Document Conversion
            </Typography>
          </Stack>

          <Box sx={{ flex: 1 }} />

          {/* AI Vision Toggle */}
          <Tooltip title="Read images & screenshots with Vision AI models (Claude, OpenAI, or local Qwen)">
            <FormControlLabel
              control={<Switch checked={vlm} onChange={(e) => setVlm(e.target.checked)} size="small" />}
              label={
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <Sparkles size={15} />
                  <span>Read images with AI</span>
                </Stack>
              }
              sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 13.5 } }}
            />
          </Tooltip>

          <Select
            size="small"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!vlm}
            sx={{ fontSize: 13, minWidth: 190, height: 32 }}
          >
            {PROVIDERS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </Select>

          {/* Start Conversion Button */}
          <Button
            variant="contained"
            size="small"
            startIcon={converting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            onClick={startBatch}
            disabled={queue.length === 0 || converting}
            sx={{ minHeight: 32, px: 2 }}
          >
            {converting ? "Converting Batch..." : `Convert All (${queue.length})`}
          </Button>

          {/* Bulk Download ZIP */}
          <Tooltip title={completedCount === 0 ? "Convert documents first to download archive" : "Download all converted Markdown files in a ZIP archive"}>
            <span>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<Archive size={15} />}
                component={batchId && completedCount > 0 ? "a" : "button"}
                href={batchId && completedCount > 0 ? `/api/batch/${batchId}/download` : undefined}
                download={batchId && completedCount > 0 ? "converted_markdown.zip" : undefined}
                disabled={!batchId || completedCount === 0 || converting}
                sx={{ minHeight: 32 }}
              >
                Download All .zip{completedCount > 0 ? ` (${completedCount})` : ""}
              </Button>
            </span>
          </Tooltip>

          {/* Bulk Insert into pgvector Knowledge Base */}
          <Tooltip
            title={
              completedCount === 0
                ? "Convert documents first before inserting into Knowledge Base"
                : "Chunk, embed with Ollama bge-m3 (1024d), and store all converted Markdown documents in PostgreSQL pgvector knowledge base"
            }
          >
            <span>
              <Button
                variant={isAllEmbedded ? "outlined" : "contained"}
                color={isAllEmbedded ? "success" : "primary"}
                size="small"
                startIcon={
                  embedding ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : isAllEmbedded ? (
                    <Check size={15} />
                  ) : (
                    <DatabaseZap size={15} />
                  )
                }
                onClick={embedBatch}
                disabled={!batchId || completedCount === 0 || converting || embedding}
                sx={{ minHeight: 32 }}
              >
                {embedding
                  ? `Embedding (${embedProgress ? `${embedProgress.current}/${embedProgress.total}` : "..."})`
                  : isAllEmbedded
                  ? `In Knowledge Base (${embeddedItems.length})`
                  : completedCount > 0
                  ? `Insert into Knowledge Base (${completedCount})`
                  : "Insert into Knowledge Base"}
              </Button>
            </span>
          </Tooltip>

          {queue.length > 0 && !converting && !embedding && (
            <Tooltip title="Clear queue">
              <IconButton size="small" onClick={clearQueue} sx={{ p: 0.75 }}>
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Paper>

      {/* Real-time Knowledge Base Embedding Progress */}
      {embedding && embedProgress && (
        <Paper
          square
          sx={{
            px: 2,
            py: 0.8,
            bgcolor: (t) => alpha(t.palette.info.main, 0.08),
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Stack spacing={0.5}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: "info.main",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                }}
              >
                <Loader2 size={13} className="animate-spin" />
                <span>
                  Embedding into pgvector: [{embedProgress.current}/{embedProgress.total}]{" "}
                  <strong>{embedProgress.filename}</strong>
                </span>
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
                {Math.round((embedProgress.current / embedProgress.total) * 100)}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.round((embedProgress.current / embedProgress.total) * 100)}
              color="info"
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Stack>
        </Paper>
      )}

      {/* Main Split Screen */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Group orientation="horizontal" style={{ height: "100%" }}>
          {/* Left Panel: Upload & Queue */}
          <Panel defaultSize="38" minSize="25">
            <Box
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                borderRight: 1,
                borderColor: "divider",
                bgcolor: "background.default",
              }}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* Left Panel Header */}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  px: 2,
                  py: 1,
                  minHeight: 48,
                  borderBottom: 1,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  alignItems: "center",
                }}
              >
                <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
                  Input Queue ({queue.length})
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FileUp size={14} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={converting}
                  sx={{ fontSize: 12, py: 0.25, px: 1 }}
                >
                  Add Files
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FolderUp size={14} />}
                  onClick={() => folderInputRef.current?.click()}
                  disabled={converting}
                  sx={{ fontSize: 12, py: 0.25, px: 1 }}
                >
                  Add Folder
                </Button>
              </Stack>

              {/* Progress status bar when converting */}
              {converting && (
                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      Converting {completedCount + errorCount} of {queue.length} files...
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "text.secondary" }}>
                      <Clock size={12} />
                      <Typography variant="caption">{elapsedSeconds}s</Typography>
                    </Stack>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={queue.length > 0 ? ((completedCount + errorCount) / queue.length) * 100 : 0}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </Box>
              )}

              {/* Queue List */}
              <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
                {queue.length === 0 ? (
                  <Box
                    sx={{
                      height: "100%",
                      minHeight: 220,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      p: 3,
                      textAlign: "center",
                      border: "2px dashed",
                      borderColor: "divider",
                      borderRadius: 3,
                      bgcolor: (t) => alpha(t.palette.action.hover, 0.4),
                    }}
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
                        mb: 1.5,
                      }}
                    >
                      <FolderUp size={24} />
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      No Documents Queued
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13, mt: 0.5, maxWidth: 280 }}>
                      Drag and drop files or a folder here, or click <strong>Add Files</strong> or <strong>Add Folder</strong>.
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={1}>
                    {queue.map((item, idx) => {
                      const isSelected = selectedItem?.id === item.id;
                      return (
                        <Paper
                          key={item.id}
                          onClick={() => item.result && setSelectedFileId(item.id)}
                          sx={{
                            p: 1.25,
                            borderRadius: 2,
                            display: "flex",
                            alignItems: "center",
                            gap: 1.25,
                            cursor: item.result ? "pointer" : "default",
                            bgcolor: isSelected
                              ? (t) => alpha(t.palette.primary.main, 0.08)
                              : "background.paper",
                            borderColor: isSelected ? "primary.main" : "divider",
                            transition: "all 0.15s ease",
                            "&:hover": {
                              borderColor: item.result ? "primary.main" : "divider",
                            },
                          }}
                        >
                          <Typography variant="caption" sx={{ color: "text.disabled", width: 22, textAlign: "right" }}>
                            {idx + 1}
                          </Typography>

                          <Box sx={{ color: "primary.main", display: "flex" }}>
                            {item.name.endsWith(".xlsx") || item.name.endsWith(".xls") ? (
                              <Table2 size={16} />
                            ) : item.name.endsWith(".xml") ? (
                              <FileCode size={16} />
                            ) : (
                              <FileText size={16} />
                            )}
                          </Box>

                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: 13 }}>
                              {item.name}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                              {formatBytes(item.size)}
                            </Typography>
                          </Box>

                          {/* Status Badge */}
                          {item.status === "pending" && (
                            <Chip size="small" label="Pending" variant="outlined" sx={{ fontSize: 11, height: 20 }} />
                          )}
                          {item.status === "converting" && (
                            <Chip
                              size="small"
                              icon={<Loader2 size={12} className="animate-spin" />}
                              label="Converting"
                              color="primary"
                              variant="outlined"
                              sx={{ fontSize: 11, height: 20 }}
                            />
                          )}
                          {item.status === "done" && item.result && (
                            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                              <Chip
                                size="small"
                                icon={<Check size={12} />}
                                label={`${item.result.tools.elapsed}s`}
                                color="success"
                                variant="filled"
                                sx={{ fontSize: 11, height: 20 }}
                              />
                              {item.embed && item.embed.status !== "error" && (
                                <Tooltip
                                  title={`${item.embed.status === "unchanged" ? "Up-to-date" : "Indexed"}: ${item.embed.chunks} chunks in pgvector`}
                                >
                                  <Chip
                                    size="small"
                                    icon={<DatabaseZap size={11} />}
                                    label="KB"
                                    color="success"
                                    variant="outlined"
                                    sx={{ fontSize: 10, height: 20, px: 0.25 }}
                                  />
                                </Tooltip>
                              )}
                              {item.embed && item.embed.status === "error" && (
                                <Tooltip title={item.embed.error || "Knowledge base indexing error"}>
                                  <Chip
                                    size="small"
                                    label="KB Err"
                                    color="error"
                                    variant="outlined"
                                    sx={{ fontSize: 10, height: 20, px: 0.25 }}
                                  />
                                </Tooltip>
                              )}
                            </Stack>
                          )}
                          {item.status === "error" && (
                            <Tooltip title={item.error || "Failed"}>
                              <Chip
                                size="small"
                                icon={<AlertCircle size={12} />}
                                label="Failed"
                                color="error"
                                variant="filled"
                                sx={{ fontSize: 11, height: 20 }}
                              />
                            </Tooltip>
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            </Box>
          </Panel>

          <Separator className="pane-separator" />

          {/* Right Panel: Converted Results, Tool Breakdown & Markdown Viewer */}
          <Panel defaultSize="62" minSize="35">
            <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
              {/* Right Panel Header Bar */}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  px: 2,
                  py: 1,
                  minHeight: 48,
                  borderBottom: 1,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  alignItems: "center",
                }}
              >
                <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
                  Conversion Results ({completedCount}/{queue.length})
                </Typography>

                <Box sx={{ flex: 1 }} />

                {selectedResult && (
                  <>
                    <ToggleButtonGroup
                      size="small"
                      value={viewMode}
                      exclusive
                      onChange={(_, v) => v && setViewMode(v)}
                      sx={{ height: 28 }}
                    >
                      <ToggleButton value="rendered" sx={{ px: 1, py: 0 }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", fontSize: 12 }}>
                          <Eye size={13} />
                          <span>Preview</span>
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
                      <IconButton size="small" onClick={handleCopyMarkdown} sx={{ p: 0.5 }}>
                        {copied ? <Check size={15} color="var(--mui-palette-success-main)" /> : <Copy size={15} />}
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Download this Markdown">
                      <IconButton size="small" onClick={handleDownloadSingle} sx={{ p: 0.5 }}>
                        <Download size={15} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>

              {/* Aggregate Batch Dashboard Summary */}
              {completedCount > 0 && (
                <Box
                  sx={{
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: (t) => alpha(t.palette.background.paper, 0.7),
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                    <Chip
                      size="small"
                      icon={<CheckCircle2 size={13} />}
                      label={`${completedCount} Converted`}
                      color="success"
                      sx={{ fontWeight: 600, fontSize: 11.5 }}
                    />
                    <Chip
                      size="small"
                      icon={<Layers size={13} />}
                      label={`${totalUnits} Sheets / Pages`}
                      variant="outlined"
                      sx={{ fontSize: 11.5 }}
                    />
                    {totalClaudeVlm > 0 && (
                      <Chip
                        size="small"
                        icon={<Sparkles size={13} />}
                        label={`${totalClaudeVlm} Claude VLM Images`}
                        color="primary"
                        variant="outlined"
                        sx={{ fontSize: 11.5 }}
                      />
                    )}
                    {totalTesseract > 0 && (
                      <Chip
                        size="small"
                        icon={<Cpu size={13} />}
                        label={`${totalTesseract} Tesseract OCR Images`}
                        variant="outlined"
                        sx={{ fontSize: 11.5 }}
                      />
                    )}
                    {totalCvTables > 0 && (
                      <Chip
                        size="small"
                        icon={<Table2 size={13} />}
                        label={`${totalCvTables} CV Tables`}
                        variant="outlined"
                        sx={{ fontSize: 11.5 }}
                      />
                    )}
                    {totalFlows > 0 && (
                      <Chip
                        size="small"
                        icon={<ArrowRight size={13} />}
                        label={`${totalFlows} Flowcharts`}
                        variant="outlined"
                        sx={{ fontSize: 11.5 }}
                      />
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Button
                      variant={isAllEmbedded ? "outlined" : "contained"}
                      color={isAllEmbedded ? "success" : "primary"}
                      size="small"
                      startIcon={
                        embedding ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : isAllEmbedded ? (
                          <Check size={13} />
                        ) : (
                          <DatabaseZap size={13} />
                        )
                      }
                      onClick={embedBatch}
                      disabled={converting || embedding}
                      sx={{ fontSize: 11.5, height: 26, px: 1.25 }}
                    >
                      {embedding
                        ? "Embedding into pgvector..."
                        : isAllEmbedded
                        ? "Indexed in KB"
                        : `Insert into Knowledge Base (${completedCount})`}
                    </Button>
                  </Stack>
                </Box>
              )}

              {/* Main Result Content & Per-file Tool Breakdown */}
              <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
                {selectedResult ? (
                  <Stack spacing={2} sx={{ maxWidth: 900, mx: "auto" }}>
                    {/* Knowledge Base Ingestion Summary Banner */}
                    {embedSummary && (
                      <Paper
                        sx={{
                          p: 1.75,
                          borderRadius: 2.5,
                          bgcolor: (t) => alpha(t.palette.success.main, 0.08),
                          border: 1,
                          borderColor: (t) => alpha(t.palette.success.main, 0.3),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 1.5,
                        }}
                      >
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                          <Box
                            sx={{
                              width: 34,
                              height: 34,
                              borderRadius: 2,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: (t) => alpha(t.palette.success.main, 0.2),
                              color: "success.main",
                            }}
                          >
                            <DatabaseZap size={18} />
                          </Box>
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "text.primary" }}>
                              pgvector Knowledge Base Ingestion Complete
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                              Stored {embedSummary.succeeded} document(s) ({embedSummary.total_chunks} chunks, ~{embedSummary.total_tokens} tokens) in {embedSummary.seconds}s. Total documents in DB: {embedSummary.db_documents} ({embedSummary.db_chunks} chunks).
                            </Typography>
                          </Box>
                        </Stack>
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          startIcon={<ExternalLink size={14} />}
                          onClick={goToAskPage}
                          sx={{ fontSize: 12.5, height: 32, px: 2, borderRadius: 1.5 }}
                        >
                          Query in Ask Tab
                        </Button>
                      </Paper>
                    )}

                    {/* Tool & Library Breakdown Card */}
                    <Paper
                      sx={{
                        p: 2,
                        borderRadius: 2.5,
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                      }}
                    >
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            borderRadius: 2,
                            display: "grid",
                            placeItems: "center",
                            bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                            color: "primary.main",
                          }}
                        >
                          <Cpu size={18} />
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {selectedResult.filename}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            Tools & Libraries Execution Breakdown
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={`${selectedResult.tools.elapsed}s conversion`}
                          variant="outlined"
                          sx={{ fontSize: 11 }}
                        />
                      </Stack>

                      {/* Tool Badges Grid */}
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
                          gap: 1.25,
                        }}
                      >
                        {/* Primary Engine */}
                        <ToolDetailTile
                          label="Primary Parser Engine"
                          value={selectedResult.tools.primary_engine}
                          highlight
                        />

                        {/* Claude / VLM */}
                        <ToolDetailTile
                          label="Vision Model (VLM)"
                          value={
                            selectedResult.tools.vlm_images > 0
                              ? `${selectedResult.tools.claude_vlm_images || selectedResult.tools.vlm_images} image(s) via ${selectedResult.tools.vlm_provider || "AI"}`
                              : "None (Direct Text Extraction)"
                          }
                          color={selectedResult.tools.vlm_images > 0 ? "primary" : "default"}
                        />

                        {/* Tesseract OCR */}
                        <ToolDetailTile
                          label="Tesseract Optical OCR"
                          value={
                            selectedResult.tools.tesseract_ocr_images > 0
                              ? `${selectedResult.tools.tesseract_ocr_images} image(s) processed`
                              : "None"
                          }
                        />

                        {/* Document Scope */}
                        <ToolDetailTile
                          label="Document Scope"
                          value={`${selectedResult.tools.pages_or_sheets} ${selectedResult.tools.unit}`}
                        />

                        {/* Embedded Pictures */}
                        <ToolDetailTile
                          label="Embedded Media"
                          value={`${selectedResult.tools.total_pictures} image(s) total (${selectedResult.tools.skipped_images} decorative/skipped)`}
                        />

                        {/* Output Markdown Size */}
                        <ToolDetailTile
                          label="Markdown Output"
                          value={`${selectedResult.tools.markdown_length.toLocaleString()} characters`}
                        />

                        {/* pgvector Knowledge Base Status */}
                        <ToolDetailTile
                          label="pgvector Knowledge Base"
                          value={
                            selectedItem?.embed
                              ? selectedItem.embed.status === "error"
                                ? `Error: ${selectedItem.embed.error || "Failed"}`
                                : `${selectedItem.embed.status === "unchanged" ? "Up-to-date" : "Indexed"} (${selectedItem.embed.chunks || 0} chunks, ~${selectedItem.embed.tokens || 0} tokens)`
                              : isAllEmbedded
                              ? "Indexed"
                              : "Not Indexed (Click 'Insert into Knowledge Base' above)"
                          }
                          color={
                            selectedItem?.embed?.status === "error"
                              ? "error"
                              : selectedItem?.embed
                              ? "success"
                              : "default"
                          }
                          highlight={Boolean(selectedItem?.embed)}
                        />
                      </Box>
                    </Paper>

                    {/* Markdown Viewer */}
                    <Paper sx={{ borderRadius: 2.5, overflow: "hidden" }}>
                      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          Converted Output Preview
                        </Typography>
                      </Box>
                      {viewMode === "rendered" ? (
                        <Box sx={{ p: 3 }}>
                          <Markdown source={selectedResult.markdown} diagrams sx={{ maxWidth: "85ch", mx: "auto" }} />
                        </Box>
                      ) : (
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            p: 3,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            font: "12.5px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {selectedResult.markdown}
                        </Box>
                      )}
                    </Paper>
                  </Stack>
                ) : (
                  <Box
                    sx={{
                      height: "100%",
                      minHeight: 280,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      p: 3,
                    }}
                  >
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: 3,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: (t) => alpha(t.palette.text.secondary, 0.08),
                        color: "text.secondary",
                        mb: 1.5,
                      }}
                    >
                      <Layers size={28} />
                    </Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      No Converted Document Selected
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13, mt: 0.5, maxWidth: 360 }}>
                      When you start batch conversion, each completed document will stream in here with its full tool & library execution breakdown.
                    </Typography>
                  </Box>
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

function ToolDetailTile({
  label,
  value,
  highlight,
  color,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  color?: "primary" | "default" | "success" | "error";
}) {
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 2,
        bgcolor: (t) =>
          color === "success"
            ? alpha(t.palette.success.main, 0.08)
            : color === "error"
              ? alpha(t.palette.error.main, 0.08)
              : highlight
                ? alpha(t.palette.primary.main, 0.06)
                : color === "primary"
                  ? alpha(t.palette.primary.main, 0.04)
                  : alpha(t.palette.action.hover, 0.5),
        border: (t) =>
          color === "success"
            ? `1px solid ${alpha(t.palette.success.main, 0.3)}`
            : color === "error"
              ? `1px solid ${alpha(t.palette.error.main, 0.3)}`
              : highlight
                ? `1px solid ${alpha(t.palette.primary.main, 0.25)}`
                : `1px solid ${t.palette.divider}`,
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", fontSize: 11 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: highlight ? 700 : 600,
          color:
            color === "success"
              ? "success.main"
              : color === "error"
                ? "error.main"
                : highlight
                  ? "primary.main"
                  : "text.primary",
          fontSize: 12.5,
          mt: 0.25,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
