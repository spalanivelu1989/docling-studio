import {
  Alert, Box, Button, Chip, FormControlLabel, IconButton, LinearProgress, MenuItem, Paper, Select, Snackbar,
  Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, CloudUpload, CodeXml, Copy, DatabaseZap, Download, Eye, FileText, FileUp, GitMerge, Image, ScanText,
  Sparkles, Table2, Timer, TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api, type Conversion, type EmbedResult, type Upload } from "../api";
import Markdown from "../components/Markdown";

const ACCEPT = ".pptx,.ppt,.docx,.doc,.xlsx,.xlsm,.xls,.pdf,.html,.htm,.xml,.csv,.txt,.json,.msg,.eml,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif";
const PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic API)" },
  { value: "openai", label: "GPT (OpenAI API)" },
  { value: "qwen", label: "Qwen3-VL (local)" },
];

type Notice = { severity: "success" | "info" | "warning" | "error"; message: ReactNode; action?: ReactNode };

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function ExtractPage({ onAsk }: { onAsk: () => void }) {
  const [doc, setDoc] = useState<Upload | null>(null);
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "convert" | "embed">(null);
  const [busyStart, setBusyStart] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [vlm, setVlm] = useState(false);
  const [provider, setProvider] = useState("claude");
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewMissing, setPreviewMissing] = useState(false);
  const [embedded, setEmbedded] = useState<EmbedResult | null>(null);
  // Nothing is asked about where the document is filed. It lands in
  // knowledge_base/, which is the folder UNFILED claims, so that is what it is
  // filed as unless its own front matter says otherwise -- and since no run is
  // scoped to a category any more, every run reads it either way.
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    api.health().then((h) => setPreviewMissing(!h.preview_available)).catch(() => {});
  }, []);

  // A live seconds counter while the server works; conversions can take minutes.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [busy]);

  const start = (kind: "upload" | "convert" | "embed") => {
    setBusy(kind);
    setBusyStart(Date.now());
    setNow(Date.now());
  };

  async function upload(file?: File) {
    if (!file || busy) return;
    start("upload");
    setConversion(null);
    setEmbedded(null);
    try {
      const data = await api.upload(file);
      setDoc(data);
      if (data.warning) setNotice({ severity: "warning", message: "Preview unavailable — you can still convert the document." });
    } catch (err) {
      setNotice({ severity: "error", message: `Upload failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!doc || busy) return;
    start("convert");
    setEmbedded(null);
    try {
      const data = await api.convert(doc.id, vlm, provider);
      setConversion(data);
      if (data.vlm_notice) setNotice({ severity: "warning", message: data.vlm_notice });
    } catch (err) {
      setNotice({ severity: "error", message: `Conversion failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function embed() {
    if (!doc || busy) return;
    start("embed");
    try {
      const data = await api.embed(doc.id);
      setEmbedded(data);
      const message = {
        added: `Added to the knowledge base: ${plural(data.chunks, "chunk")} in ${data.seconds}s.`,
        updated: `Knowledge base updated: ${plural(data.chunks, "chunk")} replaced in ${data.seconds}s.`,
        unchanged: `Already in the knowledge base and unchanged (${plural(data.chunks, "chunk")}).`,
      }[data.status];
      setNotice({
        severity: data.duplicates.length ? "warning" : "success",
        message: (
          <>
            {message} The index now holds {plural(data.total_chunks, "chunk")} from {plural(data.documents, "document")}.
            {data.duplicates.length > 0 && (
              <Box component="span" sx={{ display: "block", mt: 0.5 }}>
                Also indexed from {data.duplicates.join(", ")}, so answers may cite both copies.
              </Box>
            )}
          </>
        ),
        action: (
          <Button color="inherit" size="small" onClick={onAsk}>
            Ask
          </Button>
        ),
      });
    } catch (err) {
      setNotice({ severity: "error", message: `Adding to the knowledge base failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!conversion) return;
    await navigator.clipboard.writeText(conversion.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const onDrag = (e: DragEvent, kind: "enter" | "leave" | "over" | "drop") => {
    e.preventDefault();
    if (kind === "enter") dragDepth.current += 1;
    if (kind === "leave") dragDepth.current -= 1;
    if (kind === "drop") {
      dragDepth.current = 0;
      upload(e.dataTransfer.files?.[0]);
    }
    setDragging(dragDepth.current > 0 && kind !== "drop");
  };

  const seconds = ((now - busyStart) / 1000).toFixed(0);
  const busyLabel = {
    upload: "Rendering preview",
    convert: !vlm
      ? "Extracting"
      : provider === "qwen"
        ? "Extracting — reading images with the local vision model"
        : `Extracting — sending images to ${PROVIDERS.find((p) => p.value === provider)?.label}`,
    embed: "Adding to knowledge base — chunking and embedding with Ollama bge-m3",
  };

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column" }}
      onDragEnter={(e) => onDrag(e, "enter")}
      onDragLeave={(e) => onDrag(e, "leave")}
      onDragOver={(e) => onDrag(e, "over")}
      onDrop={(e) => onDrag(e, "drop")}
    >
      {/* ---------- toolbar ---------- */}
      <Paper square sx={{ borderWidth: "0 0 1px 0", px: 2, py: 1, flex: "none" }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="outlined" startIcon={<FileUp size={16} />} onClick={() => fileInput.current?.click()} disabled={!!busy}>
            Open document
          </Button>
          <AnimatePresence>
            {doc && (
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <Chip
                  icon={<FileText size={14} />}
                  label={doc.filename}
                  variant="outlined"
                  sx={{ maxWidth: { xs: 200, md: 360 } }}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Read dense images with a vision model: recovers table structure from SAP screenshots and traces flattened process diagrams into a draft flow graph. Slower; with GPT or Claude the images are sent to that API.">
            <FormControlLabel
              control={<Switch checked={vlm} onChange={(e) => setVlm(e.target.checked)} size="small" />}
              label={
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <Sparkles size={15} />
                  <span>Read images with AI</span>
                </Stack>
              }
              sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 14 } }}
            />
          </Tooltip>
          <Select
            size="small"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!vlm}
            sx={{ fontSize: 14, minWidth: 200 }}
          >
            {PROVIDERS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </Select>
          <Button
            variant="contained"
            startIcon={<ScanText size={16} />}
            onClick={convert}
            disabled={!doc || (!!busy && busy !== "convert")}
            loading={busy === "convert"}
            loadingPosition="start"
          >
            Convert to Markdown
          </Button>
        </Stack>
        <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files?.[0])} />
      </Paper>

      <AnimatePresence>
        {busy && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }}>
              <Typography variant="body2" sx={{ color: "primary.main", fontWeight: 600 }}>
                {busyLabel[busy]}…
              </Typography>
              <Chip size="small" icon={<Timer size={13} />} label={`${seconds}s`} sx={{ fontVariantNumeric: "tabular-nums" }} />
            </Box>
            <LinearProgress sx={{ height: 2 }} />
          </motion.div>
        )}
      </AnimatePresence>

      {previewMissing && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          LibreOffice was not found, so documents cannot be previewed. Conversion still works.
        </Alert>
      )}

      {/* ---------- panes ---------- */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Group orientation="horizontal" style={{ height: "100%" }}>
          <Panel defaultSize="50" minSize="20">
            <Pane
              title="Original"
              meta={doc ? [doc.format.toUpperCase(), doc.pages ? plural(doc.pages, "page") : null, fileSize(doc.size)].filter(Boolean).join(" · ") : undefined}
            >
              {doc && !doc.warning && doc.pages > 0 ? (
                <Stack spacing={2.5} sx={{ p: 2.5 }}>
                  {Array.from({ length: doc.pages }, (_, i) => (
                    <PagePreview key={`${doc.id}-${i}`} src={api.previewUrl(doc.id, i + 1)} n={i + 1} total={doc.pages} />
                  ))}
                </Stack>
              ) : (
                <DropZone dragging={dragging} busy={busy === "upload"} onBrowse={() => fileInput.current?.click()} warning={doc?.warning} />
              )}
            </Pane>
          </Panel>
          <Separator className="pane-separator" />
          <Panel defaultSize="50" minSize="20">
            <Pane
              title="Markdown"
              meta={
                conversion
                  ? [conversion.pages ? `${conversion.pages} ${conversion.unit || "pages"}` : null, `${conversion.markdown.length.toLocaleString()} chars`].filter(Boolean).join(" · ")
                  : undefined
              }
              actions={
                <>
                  <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} disabled={!conversion}>
                    <ToggleButton value="rendered" sx={{ px: 1.25, py: 0.4, gap: 0.5 }}>
                      <Eye size={15} /> Rendered
                    </ToggleButton>
                    <ToggleButton value="raw" sx={{ px: 1.25, py: 0.4, gap: 0.5 }}>
                      <CodeXml size={15} /> Raw
                    </ToggleButton>
                  </ToggleButtonGroup>
                  <Tooltip title={copied ? "Copied" : "Copy Markdown"}>
                    <span>
                      <IconButton size="small" onClick={copy} disabled={!conversion} aria-label="Copy Markdown">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span key={String(copied)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} style={{ display: "flex" }}>
                            {copied ? <Check size={17} /> : <Copy size={17} />}
                          </motion.span>
                        </AnimatePresence>
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Download .md">
                    <span>
                      <IconButton size="small" component="a" href={doc ? api.downloadUrl(doc.id) : undefined} disabled={!conversion} aria-label="Download Markdown">
                        <Download size={17} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Chunk this Markdown, embed it with Ollama bge-m3 (1024d) and store it, so the Ask page can answer from it">
                    <span>
                      <Button
                        size="small"
                        variant={embedded ? "outlined" : "contained"}
                        color={embedded ? "success" : "primary"}
                        startIcon={embedded ? <Check size={15} /> : <DatabaseZap size={15} />}
                        onClick={embed}
                        disabled={!conversion || (!!busy && busy !== "embed")}
                        loading={busy === "embed"}
                        loadingPosition="start"
                      >
                        {embedded ? "In knowledge base" : "Add to knowledge base"}
                      </Button>
                    </span>
                  </Tooltip>
                </>
              }
            >
              <AnimatePresence>
                {conversion && <Stats key={conversion.elapsed + conversion.markdown.length} c={conversion} />}
              </AnimatePresence>
              {conversion ? (
                <motion.div key={conversion.markdown.length + view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  {view === "rendered" ? (
                    <Markdown source={conversion.markdown} diagrams sx={{ p: 2.5, maxWidth: "80ch" }} />
                  ) : (
                    <Box component="pre" sx={{ m: 0, p: 2.5, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {conversion.markdown}
                    </Box>
                  )}
                </motion.div>
              ) : (
                <Empty
                  icon={<Sparkles size={28} />}
                  title="Nothing extracted yet"
                  text={doc ? "Click Convert to Markdown to extract this document." : "Open or drop a document, then convert it to Markdown."}
                />
              )}
            </Pane>
          </Panel>
        </Group>
      </Box>

      <Snackbar
        open={!!notice}
        onClose={(_, reason) => reason !== "clickaway" && setNotice(null)}
        autoHideDuration={notice?.severity === "error" ? null : 8000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice ? (
          <Alert severity={notice.severity} variant="filled" onClose={() => setNotice(null)} action={notice.action} sx={{ maxWidth: 640, alignItems: "center" }}>
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}

function Pane({ title, meta, actions, children }: { title: string; meta?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap", px: 2, py: 0.75, minHeight: 48, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}
      >
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
      <Box
        sx={{ flex: 1, overflow: "auto", bgcolor: "background.default" }}
      >
        {children}
      </Box>
    </Box>
  );
}

function DropZone({ dragging, busy, onBrowse, warning }: { dragging: boolean; busy: boolean; onBrowse: () => void; warning?: string | null }) {
  return (
    <Box sx={{ p: 2.5, height: "100%" }}>
      <Box
        component={motion.div}
        animate={{ scale: dragging ? 1.015 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        sx={(t) => ({
          height: "100%", minHeight: 280, borderRadius: 4, p: 4, textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5,
          border: `2px dashed ${dragging ? t.palette.primary.main : t.palette.divider}`,
          bgcolor: dragging ? alpha(t.palette.primary.main, 0.06) : "transparent",
          color: "text.secondary", transition: "border-color .2s, background-color .2s",
        })}
      >
        <Box
          component={motion.div}
          animate={dragging ? { y: [0, -8, 0] } : { y: 0 }}
          transition={dragging ? { repeat: Infinity, duration: 1 } : {}}
          sx={(t) => ({ width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(t.palette.primary.main, 0.1), color: "primary.main" })}
        >
          {warning ? <TriangleAlert size={28} /> : <CloudUpload size={30} />}
        </Box>
        <Typography variant="h6" sx={{ color: "text.primary", fontWeight: 650 }}>
          {warning ? "Preview unavailable" : dragging ? "Drop to upload" : "Drop a document here"}
        </Typography>
        <Typography variant="body2" sx={{ maxWidth: "38ch" }}>
          {warning ??
            "PPTX, DOCX, XLSX, PDF, or a PNG / JPEG such as a screenshot or process diagram. Documents are rendered with LibreOffice so shapes and connectors look as they do in the source file."}
        </Typography>
        {!warning && (
          <Button variant="outlined" onClick={onBrowse} disabled={busy} startIcon={<FileUp size={16} />} sx={{ mt: 1 }}>
            Choose a file
          </Button>
        )}
      </Box>
    </Box>
  );
}

function PagePreview({ src, n, total }: { src: string; n: number; total: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Box component="figure" sx={{ m: 0 }}>
      <Typography component="figcaption" variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
        Page {n} of {total}
      </Typography>
      <Box
        sx={(t) => ({
          position: "relative", borderRadius: 2, overflow: "hidden", border: `1px solid ${t.palette.divider}`,
          bgcolor: "#fff", minHeight: loaded ? 0 : 200,
          boxShadow: t.palette.mode === "light" ? "0 1px 2px rgba(16,20,26,.06), 0 4px 12px rgba(16,20,26,.05)" : "none",
        })}
      >
        <motion.img
          src={src}
          alt={`Page ${n}`}
          // 144 slides is a lot of PNGs; fetch them as they scroll into view.
          loading="lazy"
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: loaded ? 1 : 0 }}
          transition={{ duration: 0.35 }}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </Box>
    </Box>
  );
}

function Stats({ c }: { c: Conversion }) {
  const conf = c.ocr.length ? c.ocr.reduce((s, b) => s + b.confidence, 0) / c.ocr.length : 0;
  const items: { icon: ReactNode; label: string; tip: string }[] = [
    { icon: <Timer size={13} />, label: `${c.elapsed}s`, tip: "Extraction time" },
  ];
  if (c.ocr.length) items.push({ icon: <ScanText size={13} />, label: `${c.ocr.length} OCR · ${conf.toFixed(0)}% conf.`, tip: "Images read by Tesseract OCR, with mean confidence" });
  if (c.flows) items.push({ icon: <GitMerge size={13} />, label: plural(c.flows, "slide flow"), tip: "Flowcharts rebuilt from PowerPoint connectors (exact)" });
  if (c.flow_images) items.push({ icon: <GitMerge size={13} />, label: `${c.flow_images} traced (draft)`, tip: "Diagrams traced by the vision model — check against the original" });
  if (c.cv_flow_images) items.push({ icon: <GitMerge size={13} />, label: `${c.cv_flow_images} traced by image processing (draft)`, tip: "Flows traced from pixels — check against the original" });
  if (c.table_images) items.push({ icon: <Table2 size={13} />, label: plural(c.table_images, "table image"), tip: "Images whose table structure was recovered" });
  if (c.vlm_images) items.push({ icon: <Sparkles size={13} />, label: `${c.vlm_images} by vision model`, tip: "Images read by the vision model" });
  if (c.skipped_images) items.push({ icon: <Image size={13} />, label: `${c.skipped_images} no text`, tip: "Images with no readable text" });
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", px: 2.5, pt: 2 }}>
        {items.map((it, i) => (
          <motion.div key={it.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
            <Tooltip title={it.tip}>
              <Chip size="small" variant="outlined" icon={<Box sx={{ display: "flex", pl: 0.5 }}>{it.icon}</Box>} label={it.label} sx={{ fontVariantNumeric: "tabular-nums" }} />
            </Tooltip>
          </motion.div>
        ))}
      </Stack>
    </motion.div>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Box sx={{ height: "100%", minHeight: 260, display: "grid", placeItems: "center", p: 3 }}>
      <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", maxWidth: "36ch", color: "text.secondary" }}>
        <Box
          component={motion.div}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          sx={(t) => ({ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(t.palette.primary.main, 0.1), color: "primary.main", mb: 1 })}
        >
          {icon}
        </Box>
        <Typography sx={{ fontWeight: 650, color: "text.primary" }}>{title}</Typography>
        <Typography variant="body2">{text}</Typography>
      </Stack>
    </Box>
  );
}
