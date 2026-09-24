import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, IconButton,
  LinearProgress, Menu, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField,
  Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Download, FileDown, FileText, Gavel, Globe2,
  History, Layers, ListChecks, Paperclip, Scale, Search, ShieldCheck, Sparkles, Square,
  Target, Trash2, Upload, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  fitgap, rollout, runRollout, sessionUploads, uploadSessionDocuments,
  type AgentToolCall, type AsIsModel, type BpmlProcess, type Deviation, type LocalizationState,
  type Materiality, type RolloutAnalysis, type RolloutDecision, type RolloutGates,
  type RolloutSourceChunk, type RolloutSourceDocument, type RolloutSources,
  type RolloutSubject,
  type RolloutPreview,
  type RolloutRunSummary, type RolloutScores, type RolloutStatus, type UploadRole,
  type UploadSession,
} from "../api";
import { clearAdornment, clearOnEscape } from "../components/ClearAdornment";
import AgentTraceDrawer from "../components/AgentTraceDrawer";

/* ------------------------------------------------------------------ palette */

/** Semantic colours for the process overlay and the heatmap (§16.2). Green
 *  fit, amber configurable, red material decision, blue confirmed
 *  localization, grey insufficient evidence — the specification's own legend,
 *  taken from the theme so each has a light and a dark variant. */
function useSemantic() {
  const t = useTheme();
  return {
    fit: t.palette.success.main,
    minor: t.palette.warning.main,
    material: t.palette.error.main,
    localization: t.palette.info.main,
    unknown: t.palette.text.disabled,
  };
}

const MATERIALITY_HUE: Record<Materiality, "error" | "warning" | "info" | "success" | "default"> = {
  Critical: "error", High: "error", Medium: "warning", Low: "info", Informational: "default",
};

/** The two states that are a real legal obligation. Everything else is a
 *  choice, however local — which is the whole point of §5.3. */
const MANDATORY: LocalizationState[] = ["CONFIRMED_STATUTORY", "SAP_DELIVERED"];

/* ------------------------------------------------------------------ pieces */

/** One colour per engine, the same three the Evidence Agent's log uses, so a
 *  reader moving between the two agents reads the same signal. */
const ENGINE_COLOUR: Record<string, string> = {
  rag: "primary.main",
  graph: "info.main",
  bpml: "success.main",
  session: "text.secondary",
};

function SectionLabel({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.75 }}>
      {icon}
      <Typography variant="overline" sx={{ letterSpacing: ".08em", color: "text.secondary" }}>
        {children}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {right}
    </Stack>
  );
}

/** One of the four scores. `null` is rendered as "not assessable" rather than
 *  as a zero — §26 forbids inventing an SAP Best Practice number, so the page
 *  has to be able to show the absence of one. */
function ScoreTile({ label, value, band, hint, accent }: {
  label: string; value: number | null; band: string; hint?: string; accent?: string;
}) {
  const theme = useTheme();
  const colour = accent ?? theme.palette.primary.main;
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: "1 1 190px", minWidth: 180 }}>
      <Typography sx={{ fontSize: 11, color: "text.secondary", textTransform: "uppercase", letterSpacing: ".06em" }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mt: 0.75 }}>
        <Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: value === null ? "text.disabled" : colour }}>
          {value === null ? "—" : value}
        </Typography>
        {value !== null && <Typography sx={{ fontSize: 15, fontWeight: 600, color: colour }}>%</Typography>}
      </Stack>
      {value !== null && (
        <Box sx={{ mt: 1, height: 5, borderRadius: 3, bgcolor: alpha(colour, 0.15), overflow: "hidden" }}>
          <Box component={motion.div} initial={{ width: 0 }} animate={{ width: `${value}%` }}
               transition={{ duration: 0.7 }} sx={{ height: "100%", bgcolor: colour }} />
        </Box>
      )}
      <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.75, minHeight: 28 }}>
        {value === null ? (hint || "Not assessable") : band}
      </Typography>
    </Paper>
  );
}

function Dot({ colour, title }: { colour: string; title: string }) {
  return (
    <Tooltip title={title}>
      <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: colour, display: "inline-block" }} />
    </Tooltip>
  );
}

/* ------------------------------------------------------- source attachments */

/** The country's As-Is and its baselines, each tagged with the role it plays.
 *
 *  Roles are the part that makes this a three-way comparison rather than a
 *  two-document diff: without them the agent cannot tell a country SOP from a
 *  template extract. The panel also states plainly where the file goes, since
 *  an analyst dropping a confidential country SOP into a chat box has every
 *  reason to assume it joins the corpus. It does not. */
function Sources({
  data, busy, error, disabled, accepted, roles, maxFiles, subject, subjects,
  onAdd, onRetag, onRemove, onClear, onSubject,
}: {
  data: UploadSession | null;
  busy: { filename: string; index: number; total: number; stage: string } | null;
  error: string | null;
  disabled: boolean;
  accepted: string[];
  roles: { value: UploadRole; label: string }[];
  maxFiles: number;
  /** What this run analyses. Decides which role has to be present, so the
   *  panel asks for the right document instead of always asking for an
   *  As-Is. */
  subject: RolloutSubject;
  /** Every subject a run can have, so the panel can offer the one the
   *  attached documents actually support. */
  subjects: RolloutSubject[];
  onSubject: (value: string) => void;
  onAdd: (files: File[], role: UploadRole) => void;
  onRetag: (name: string, role: UploadRole) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const input = useRef<HTMLInputElement | null>(null);
  const [role, setRole] = useState<UploadRole>(subject.role);
  const [over, setOver] = useState(false);
  // Which chip's role menu is open. This used to advance to the next role in
  // the list on every click, which is a poor way to reach a specific one of
  // five -- and re-tagging is exactly what the missing-As-Is warning asks the
  // analyst to do, so it should not be a guessing game.
  const [retag, setRetag] = useState<{ el: HTMLElement; name: string; role: UploadRole } | null>(null);
  const files = data?.files ?? [];
  const full = files.length >= maxFiles;
  const hasSubject = files.some((f) => f.role === subject.role);
  // A subject this session could be analysed as instead: its document is
  // attached and the selected one's is not. That is the whole of the
  // "you attached a Best Practice document and were asked for an As-Is"
  // problem, so the panel offers the switch rather than demanding a file.
  const alternative = subjects.find(
    (x) => x.value !== subject.value && files.some((f) => f.role === x.role));

  // Follow the subject when it changes, so switching the run type does not
  // leave the next upload filed under the old subject's role.
  useEffect(() => { setRole(subject.role); }, [subject.role]);

  const STAGES: Record<string, string> = {
    converting: "converting with Docling",
    embedding: "chunking and embedding",
    graph: "extracting entities",
  };

  const expiry = (() => {
    if (!data?.expires_at) return "";
    const mins = Math.round((new Date(data.expires_at).getTime() - Date.now()) / 60000);
    if (mins <= 0) return "expired";
    return mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`;
  })();

  const grouped = roles
    .map((r) => ({ ...r, items: files.filter((f) => f.role === r.value) }))
    .filter((g) => g.items.length > 0);

  return (
    <Box
      onDragOver={(e) => { e.preventDefault(); if (!disabled && !full) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled || full) return;
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length) onAdd(dropped, role);
      }}
      sx={{
        mt: 1.5, px: 1.75, py: 1.5, borderRadius: 2,
        border: "1px dashed",
        borderColor: over ? "primary.main" : hasSubject ? "divider" : alpha(theme.palette.warning.main, 0.6),
        bgcolor: over ? alpha(theme.palette.primary.main, 0.06) : "transparent",
        transition: "background-color .15s, border-color .15s",
      }}
    >
      <input
        ref={input} type="file" multiple hidden accept={accepted.join(",")}
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          if (chosen.length) onAdd(chosen, role);
          e.target.value = "";
        }}
      />

      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
        <Paperclip size={14} color={theme.palette.text.secondary} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>Sources</Typography>
        {files.length > 0 && (
          <Chip size="small" label={`${files.length} · ${(data?.chunks ?? 0).toLocaleString()} chunks`}
                sx={{ height: 19, fontSize: 10.5 }} />
        )}
        <Box sx={{ flex: 1 }} />
        {files.length > 0 && (
          <Button size="small" variant="text" color="inherit" disabled={disabled}
                  startIcon={<Trash2 size={13} />} onClick={onClear}
                  sx={{ fontSize: 12.5, color: "text.secondary" }}>
            Discard all
          </Button>
        )}
        <Select
          size="small" value={role} disabled={disabled || !!busy}
          onChange={(e) => setRole(e.target.value as UploadRole)}
          title="What the next upload is in the analysis"
          sx={{ fontSize: 12.5, minWidth: 168 }}
        >
          {roles.map((r) => (
            <MenuItem key={r.value} value={r.value} sx={{ fontSize: 12.5 }}>
              {r.label}
              <Typography component="span"
                          sx={{ fontSize: 10.5, ml: 1,
                                color: r.value === subject.role ? "warning.main" : "text.secondary" }}>
                {r.value === subject.role ? "required" : "baseline"}
              </Typography>
            </MenuItem>
          ))}
        </Select>
        <Button size="small" variant="outlined" startIcon={<Upload size={14} />}
                disabled={disabled || full || !!busy} onClick={() => input.current?.click()}
                sx={{ fontSize: 12.5 }}>
          Attach
        </Button>
      </Stack>

      {files.length === 0 && !busy && (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.75 }}>
          Start with the <b>{subject.label}</b> — {subject.value === "country_as_is"
            ? "an SOP, work instruction, process narrative or workshop transcript describing how"
              + " the country works today"
            : "SAP's delivered process: a scope item description, process flow or test script"}.
          That one is <b>required</b>: it is what the run analyses. PDF, Word, Excel, PowerPoint,
          HTML, XML or plain text.
          <Box component="span" sx={{ display: "block", mt: 0.85 }}>
            The other roles are optional baselines to compare it against, so the comparison rests
            on your documents rather than on the indexed corpus alone.
          </Box>
          <Box component="span" sx={{ display: "block", mt: 0.85 }}>
            Everything is converted, embedded and graphed in a store of its own, and is never
            added to the permanent knowledge bases.
          </Box>
        </Typography>
      )}

      <AnimatePresence initial={false}>
        {busy && (
          <Box component={motion.div} key="busy"
               initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
               exit={{ opacity: 0, height: 0 }} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 0.5 }}>
              <CircularProgress size={12} />
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                {busy.total > 1 ? `${busy.index}/${busy.total} · ` : ""}
                {busy.filename} — {STAGES[busy.stage] ?? busy.stage}
              </Typography>
            </Stack>
            <LinearProgress sx={{ height: 3, borderRadius: 2 }} />
          </Box>
        )}
      </AnimatePresence>

      {grouped.map((g) => (
        <Box key={g.value} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 10.5, color: "text.secondary", textTransform: "uppercase", letterSpacing: ".07em", mb: 0.4 }}>
            {g.label}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.75 }}>
            {g.items.map((f) => (
              <Chip
                key={f.name} size="small" icon={<FileText size={12} />}
                label={`${f.name} · ${f.chunks} chunk${f.chunks === 1 ? "" : "s"}`}
                onDelete={disabled || busy ? undefined : () => onRemove(f.name)}
                deleteIcon={<X size={12} />}
                onClick={disabled || busy
                  ? undefined
                  : (e) => setRetag({ el: e.currentTarget, name: f.name, role: f.role })}
                title="Click to change what this document is in the analysis"
                sx={{ height: 23, fontSize: 11, maxWidth: 400 }}
              />
            ))}
          </Stack>
        </Box>
      ))}

      <Menu anchorEl={retag?.el ?? null} open={!!retag} onClose={() => setRetag(null)}>
        <Typography sx={{ fontSize: 10.5, color: "text.secondary", px: 2, py: 0.5 }}>
          What is this document in the analysis?
        </Typography>
        {roles.map((r) => (
          <MenuItem
            key={r.value} selected={r.value === retag?.role} sx={{ fontSize: 12.5 }}
            onClick={() => {
              if (retag && r.value !== retag.role) onRetag(retag.name, r.value);
              setRetag(null);
            }}
          >
            {r.label}
            {r.value === subject.role && (
              <Typography component="span" sx={{ fontSize: 10.5, color: "text.secondary", ml: 1 }}>
                required
              </Typography>
            )}
          </MenuItem>
        ))}
      </Menu>

      {error && <Typography sx={{ fontSize: 12.5, color: "error.main", mt: 0.75 }}>{error}</Typography>}

      {files.length > 0 && !hasSubject && alternative && (
        <Alert severity="info" sx={{ mt: 2, py: 0.85, fontSize: 12.5 }}
               action={<Button size="small" onClick={() => onSubject(alternative.value)}
                               sx={{ fontSize: 12 }}>Analyse {alternative.label}</Button>}>
          You have attached <b>{alternative.label}</b> content and nothing tagged{" "}
          <b>{subject.label}</b>. Analyse what you have against the Global Template instead?
        </Alert>
      )}

      {files.length > 0 && !hasSubject && !alternative && (
        <Alert severity="warning" sx={{ mt: 2, py: 0.85, fontSize: 12.5 }}>
          <b>The {subject.label} document is missing.</b>{" "}
          {grouped.map((g) => g.label).join(" and ")}
          {grouped.length === 1 ? " is a baseline" : " are baselines"} to compare
          <i>against</i>; this run analyses the {subject.label}, so one document has to be
          tagged <b>{subject.label}</b>.
          <Box component="span" sx={{ display: "block", mt: 0.85, color: "text.secondary" }}>
            {subject.value === "country_as_is"
              ? "Attach the SOP, work instruction, process narrative or workshop transcript that"
                + " describes how the country works today. If one of the documents above is that,"
                + " click its chip and re-tag it — but do not re-tag a template or Best Practice"
                + " extract, which would have the agent report SAP's process as the country's own."
              : "Attach the SAP Best Practice process documentation — a scope item description,"
                + " process flow or test script. If one of the documents above is that, click its"
                + " chip and re-tag it."}
          </Box>
        </Alert>
      )}

      {files.length > 0 && (
        <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 1 }}>
          Held in <code>{data?.database}.{data?.schema}</code> · deleted in {expiry} of no use ·
          not searchable from the Ask page, the Copilot or any other run
        </Typography>
      )}
    </Box>
  );
}

/** One piece of evidence, with where it came from.
 *
 *  The quote alone was all a reader used to get: a document title, a chunk id
 *  and no way to ask where in the document it was, how it came up, or what
 *  else that passage says. Everything needed to answer that is gathered
 *  during the run -- see rollout/sources.py -- so here it is attached to the
 *  quote it justifies. Collapsed by default: the quote is the finding, the
 *  provenance is what you open when you doubt it. */
function EvidenceRow({ ev, chunk, session }: {
  ev: { quote: string; side: string; evidence_class: string; doc: string; chunk_id: string;
        heading_path?: string };
  chunk?: RolloutSourceChunk;
  session: string;
}) {
  const [open, setOpen] = useState(false);
  const href = chunk ? rollout.sourceUrl(chunk, session) : "";
  const heading = chunk?.heading_path || ev.heading_path || "";
  return (
    <Box sx={{ mt: 0.6, pl: 1, borderLeft: 2, borderColor: "divider" }}>
      <Typography sx={{ fontSize: 12.5, fontStyle: "italic" }}>“{ev.quote}”</Typography>
      <Stack direction="row" spacing={1}
             sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75, mt: 0.25 }}>
        <Chip size="small" label={ev.side} sx={{ height: 17, fontSize: 10.5 }} />
        <Chip size="small" label={ev.evidence_class} sx={{ height: 17, fontSize: 10.5 }} />
        {chunk?.category && (
          <Chip size="small" color={chunk.kind === "upload" ? "warning" : "default"}
                label={chunk.kind === "upload" ? "attached" : chunk.category}
                sx={{ height: 17, fontSize: 10.5 }} />
        )}
        <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
          {chunk?.document || ev.doc}
        </Typography>
        {chunk?.score != null && (
          <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>
            score {chunk.score.toFixed(4)}
            {chunk.vector_rank != null ? ` · vector #${chunk.vector_rank}` : ""}
            {chunk.keyword_rank != null ? ` · keyword #${chunk.keyword_rank}` : ""}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="text" onClick={() => setOpen((v) => !v)}
                sx={{ fontSize: 10.5, minWidth: 0, py: 0 }}>
          {open ? "less" : "source"}
        </Button>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ mt: 0.85, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
          {heading && (
            <Typography sx={{ fontSize: 10.5, color: "text.secondary", mb: 0.5 }}>
              {heading}
            </Typography>
          )}
          {chunk?.known === false ? (
            <Typography sx={{ fontSize: 12, color: "warning.main" }}>
              This chunk is not in the run's retrieval log — the quote gate dropped it, so
              there is no passage to show.
            </Typography>
          ) : chunk ? (
            <>
              <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                {chunk.snippet}{chunk.truncated ? " …" : ""}
              </Typography>
              <Stack direction="row" spacing={1.25} sx={{ mt: 0.75, alignItems: "center" }}>
                <Typography sx={{ fontSize: 10.5, color: "text.disabled", fontFamily: "monospace" }}>
                  {ev.chunk_id}
                </Typography>
                {href && (
                  <Button size="small" variant="text" href={href} target="_blank" rel="noreferrer"
                          startIcon={<FileText size={12} />} sx={{ fontSize: 10.5, py: 0 }}>
                    Open {chunk.file || chunk.document}
                  </Button>
                )}
              </Stack>
            </>
          ) : (
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              No source record for this run. Traceability is kept from this version on;
              runs made earlier show the quote only. <code>{ev.chunk_id}</code>
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** One document the analysis drew on, and what it actually supported.
 *
 *  Grouped by document rather than listed per citation: a workshop deck cited
 *  by nine deviations is one thing a reader wants to open, not nine rows. The
 *  chunks under it say which passage carried which finding, and clicking a
 *  finding goes to it. */
function SourceDocument({ doc, sources, session, onGap }: {
  doc: RolloutSourceDocument;
  sources: RolloutSources;
  session: string;
  onGap: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chunks = Object.values(sources.chunks)
    .filter((c) => c.document === doc.document)
    .sort((a, b) => (b.used_by.length - a.used_by.length));
  const href = chunks[0] ? rollout.sourceUrl(chunks[0], session) : "";
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
        <FileText size={14} />
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: "1 1 260px", minWidth: 0 }}>
          {doc.document || "(unrecorded document)"}
        </Typography>
        <Chip size="small" color={doc.kind === "upload" ? "warning" : "default"}
              label={doc.kind === "upload" ? "attached" : doc.category}
              sx={{ height: 19, fontSize: 10.5 }} />
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          {doc.citations} citation{doc.citations === 1 ? "" : "s"} · {doc.chunks} passage
          {doc.chunks === 1 ? "" : "s"}
          {doc.best_score != null ? ` · best score ${doc.best_score.toFixed(4)}` : ""}
        </Typography>
        {href && (
          <Button size="small" variant="text" href={href} target="_blank" rel="noreferrer"
                  sx={{ fontSize: 10.5 }}>Open</Button>
        )}
        <Button size="small" variant="text" onClick={() => setOpen((v) => !v)}
                sx={{ fontSize: 10.5 }}>{open ? "Hide passages" : "Passages"}</Button>
      </Stack>

      <Collapse in={open}>
        <Divider sx={{ my: 1.5 }} />
        <Stack spacing={1.25}>
          {chunks.map((c) => (
            <Box key={c.chunk_id} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
              <Stack direction="row" spacing={1}
                     sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  {c.heading_path || "(no heading)"}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.disabled", fontFamily: "monospace" }}>
                  {c.chunk_id}
                </Typography>
                {c.score != null && (
                  <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>
                    score {c.score.toFixed(4)}
                  </Typography>
                )}
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.75,
                                whiteSpace: "pre-wrap" }}>
                {c.snippet}{c.truncated ? " …" : ""}
              </Typography>
              <Stack direction="row" spacing={0.85}
                     sx={{ mt: 0.85, flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>supports</Typography>
                {c.used_by.map((u, i) => (
                  <Chip key={i} size="small" clickable={u.kind === "deviation"}
                        onClick={u.kind === "deviation" ? () => onGap(u.ref) : undefined}
                        label={`${u.ref || u.kind}${u.side ? ` · ${u.side}` : ""}`}
                        title={u.label}
                        sx={{ height: 18, fontSize: 10.5 }} />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

/** A dimension's score, and the findings underneath it.
 *
 *  A bar and a rating out of four is a conclusion with its working hidden.
 *  The rating comes from the deviations recorded on that dimension -- the
 *  submission is rejected if it does not, see the Analysis validator -- so
 *  those deviations, with their evidence, are what the row should open into.
 *  Nothing here is new information; it is the same register, reached from the
 *  number it produced. */
function AlignmentRow({ deviations, chunks, session, onGap, children }: {
  deviations: Deviation[];
  chunks?: Record<string, RolloutSourceChunk>;
  session: string;
  onGap: (ref: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const can = deviations.length > 0;
  return (
    <Box>
      <Box onClick={can ? () => setOpen((v) => !v) : undefined}
           sx={{ cursor: can ? "pointer" : "default", borderRadius: 1,
                 "&:hover": can ? { bgcolor: "action.hover" } : {} }}>
        {children}
        <Typography sx={{ fontSize: 10.5, color: "text.disabled", ml: "228px" }}>
          {can
            ? `${deviations.length} deviation${deviations.length === 1 ? "" : "s"} on this dimension — click to ${open ? "hide" : "see"} them`
            : "no deviation recorded on this dimension"}
        </Typography>
      </Box>
      <Collapse in={open}>
        <Stack spacing={1.25} sx={{ ml: "228px", mt: 0.75, mb: 1 }}>
          {deviations.map((d) => (
            <Paper key={d.gap_id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, fontFamily: "monospace" }}>
                  {d.gap_id}
                </Typography>
                <Chip size="small" label={d.materiality} sx={{ height: 18, fontSize: 10.5 }} />
                <Chip size="small" label={`GT fit ${d.gt_fit_rating}/4`} sx={{ height: 18, fontSize: 10.5 }} />
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant="text" sx={{ fontSize: 10.5, py: 0 }}
                        onClick={() => onGap(d.gap_id)}>Open in Deviations</Button>
              </Stack>
              <Typography sx={{ fontSize: 12.5, mt: 0.75 }}>{d.exact_difference}</Typography>
              {d.evidence.length > 0 && (
                <Box sx={{ mt: 0.85 }}>
                  {d.evidence.map((e, i) => (
                    <EvidenceRow key={i} ev={e} chunk={chunks?.[e.chunk_id]} session={session} />
                  ))}
                </Box>
              )}
            </Paper>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

/* --------------------------------------------------------------- gap detail */

function GapCard({ gap, types, dispositions, states, onDecide, decisions = [], reviewer = "",
                  busy, subjectLabel = "As-Is", chunks, session = "" }: {
  gap: Deviation;
  types: Record<string, string>;
  dispositions: Record<string, string>;
  states: Record<string, string>;
  onDecide?: (verdict: "accept" | "reject" | "defer") => void;
  decisions?: RolloutDecision[];
  reviewer?: string;
  busy?: string;
  /** The subject side's name. A deviation is a difference between two sides,
   *  and labelling one of them "As-Is" in a run with no country in it names
   *  the wrong document. */
  subjectLabel?: string;
  /** The run's source index, keyed by chunk id. */
  chunks?: Record<string, RolloutSourceChunk>;
  session?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const mandatory = MANDATORY.includes(gap.localization_state);
  // The log is append-only, so the last row is the standing verdict and the
  // ones above it are the history of how it got there.
  const latest = decisions.length ? decisions[decisions.length - 1] : null;
  const named = reviewer.trim().length > 0;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderLeft: 3, borderLeftColor:
      gap.workshop_bucket === "MUST_DISCUSS" ? "error.main"
        : gap.workshop_bucket === "CONFIRM" ? "warning.main" : "success.main" }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{gap.gap_id}</Typography>
        <Chip size="small" label={gap.materiality} color={MATERIALITY_HUE[gap.materiality]}
              sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
        <Tooltip title={types[gap.primary_type] ?? gap.primary_type}>
          <Chip size="small" variant="outlined" label={gap.primary_type} sx={{ height: 20, fontSize: 10.5 }} />
        </Tooltip>
        {gap.secondary_types.map((t) => (
          <Tooltip key={t} title={types[t] ?? t}>
            <Chip size="small" variant="outlined" label={t}
                  sx={{ height: 20, fontSize: 10.5, opacity: 0.7 }} />
          </Tooltip>
        ))}
        {mandatory && (
          <Chip size="small" icon={<Globe2 size={11} />} label={states[gap.localization_state]}
                sx={{ height: 20, fontSize: 10.5, bgcolor: alpha(theme.palette.info.main, 0.14),
                      color: "info.main", fontWeight: 700 }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          GT fit {gap.gt_fit_rating}/4 · harmonisation {gap.harmonization_potential}%
        </Typography>
        <IconButton size="small" onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
        </IconButton>
      </Stack>

      <Typography sx={{ fontSize: 13.5, fontWeight: 600, mt: 1 }}>{gap.exact_difference}</Typography>

      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Row label={subjectLabel} value={gap.as_is_statement} />
        <Row label="Template" value={gap.gt_statement} />
        {gap.sap_bp_reference && <Row label="SAP standard" value={gap.sap_bp_reference} />}
        {!mandatory && <Row label="Localization" value={states[gap.localization_state] ?? gap.localization_state} />}
      </Stack>

      {gap.decision_question && (
        <Box sx={{ mt: 1.25, p: 2, borderRadius: 1.5, bgcolor: alpha(theme.palette.error.main, 0.06) }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <Gavel size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{gap.decision_question}</Typography>
              {gap.decision_options.length > 0 && (
                <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.75, mt: 0.6 }}>
                  {gap.decision_options.map((o, i) => (
                    <Chip key={i} size="small" label={o} sx={{ height: 21, fontSize: 10.5, maxWidth: 340 }} />
                  ))}
                </Stack>
              )}
              <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.6 }}>
                {gap.decision_owner.length ? `Owner: ${gap.decision_owner.join(", ")} · ` : ""}
                ~{gap.workshop_minutes || 10} min
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}

      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mt: 1, flexWrap: "wrap", gap: 0.75 }}>
        <Chip size="small" icon={<Target size={11} />}
              label={dispositions[gap.candidate_disposition] ?? gap.candidate_disposition}
              sx={{ height: 21, fontSize: 10.5, maxWidth: 420 }} />
        <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
          {latest ? "proposed" : "proposed · awaiting a decision"} · confidence{" "}
          {gap.evidence_confidence.toLowerCase()}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {onDecide && (
          <Stack direction="row" spacing={0.85}>
            <Button size="small" variant={latest?.verdict === "accept" ? "contained" : "text"}
                    color="success" disabled={!named || !!busy} sx={{ fontSize: 12 }}
                    startIcon={busy === "accept" ? <CircularProgress size={11} /> : undefined}
                    onClick={() => onDecide("accept")}>Accept</Button>
            <Button size="small" variant={latest?.verdict === "defer" ? "contained" : "text"}
                    color="warning" disabled={!named || !!busy} sx={{ fontSize: 12 }}
                    startIcon={busy === "defer" ? <CircularProgress size={11} /> : undefined}
                    onClick={() => onDecide("defer")}>Defer</Button>
            <Button size="small" variant={latest?.verdict === "reject" ? "contained" : "text"}
                    color="error" disabled={!named || !!busy} sx={{ fontSize: 12 }}
                    startIcon={busy === "reject" ? <CircularProgress size={11} /> : undefined}
                    onClick={() => onDecide("reject")}>Reject</Button>
          </Stack>
        )}
      </Stack>

      {onDecide && !named && (
        <Typography sx={{ fontSize: 10.5, color: "text.disabled", mt: 0.75 }}>
          A verdict needs a name against it — put yours in the run panel above.
        </Typography>
      )}

      {decisions.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {decisions.map((d, i) => (
            <Stack key={d.id} direction="row" spacing={1}
                   sx={{ alignItems: "center", opacity: i === decisions.length - 1 ? 1 : 0.55 }}>
              <Chip size="small" label={d.verdict}
                    color={d.verdict === "accept" ? "success" : d.verdict === "reject" ? "error" : "warning"}
                    sx={{ height: 18, fontSize: 10.5, fontWeight: 700 }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{d.reviewer}</Typography>
              <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
                {d.decided_at ? new Date(d.decided_at).toLocaleString() : ""}
                {i < decisions.length - 1 ? " · superseded" : ""}
              </Typography>
              {d.comment && (
                <Typography sx={{ fontSize: 12, color: "text.secondary", flex: 1, minWidth: 0 }} noWrap>
                  {d.comment}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      <Collapse in={open}>
        <Divider sx={{ my: 1.75 }} />
        {gap.standard_options_considered.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary" }}>
              Standard options considered first
            </Typography>
            {gap.standard_options_considered.map((o, i) => (
              <Typography key={i} sx={{ fontSize: 12.5 }}>· {o}</Typography>
            ))}
          </Box>
        )}
        {gap.impacts.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary" }}>Material impact</Typography>
            {gap.impacts.map((im, i) => (
              <Typography key={i} sx={{ fontSize: 12.5 }}>
                · <b>{im.area}</b> {im.score}/5 — {im.note}
              </Typography>
            ))}
          </Box>
        )}
        {gap.evidence.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary" }}>Evidence</Typography>
            {gap.evidence.map((e, i) => (
              <EvidenceRow key={i} ev={e} chunk={chunks?.[e.chunk_id]} session={session} />
            ))}
          </Box>
        )}
        {gap.open_questions.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary" }}>Open</Typography>
            {gap.open_questions.map((q, i) => (
              <Typography key={i} sx={{ fontSize: 12.5 }}>· {q}</Typography>
            ))}
          </Box>
        )}
      </Collapse>
    </Paper>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary", minWidth: 84, flexShrink: 0, pt: 0.15 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 12.5 }}>{value}</Typography>
    </Stack>
  );
}

/* -------------------------------------------------------------------- page */

interface Props { active: boolean }

export default function RolloutPage({ active }: Props) {
  const theme = useTheme();
  const semantic = useSemantic();
  const [status, setStatus] = useState<RolloutStatus | null>(null);
  // Older servers report no `pdf` block at all. Treat that as "yes" rather
  // than hiding the button: the endpoint answers with its own 503 and the
  // reason, which is better than a button that quietly is not there.
  const pdfReady = status?.pdf?.available !== false;

  const [subjectKey, setSubjectKey] = useState("country_as_is");
  // Whether the analyst has chosen the subject themselves. Until they do it
  // follows the documents: attaching Best Practice content and being asked
  // for a country As-Is was the whole complaint, and a second dropdown that
  // has to be set to match the first is not an answer to it.
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [scopeText, setScopeText] = useState("");
  const [matches, setMatches] = useState<BpmlProcess[]>([]);
  const [scope, setScope] = useState<BpmlProcess | null>(null);
  const [country, setCountry] = useState("");
  const [countryContext, setCountryContext] = useState("");
  const [sapRelease, setSapRelease] = useState("");
  const [gtVersion, setGtVersion] = useState("");
  const [question, setQuestion] = useState("");
  // Every run reads the whole corpus as the Global Template. Runs made while
  // the scope could be narrowed still record what they were pointed at.
  const [plan, setPlan] = useState<RolloutPreview | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const [session, setSession] = useState(() => {
    try { return localStorage.getItem("rollout.uploads") ?? ""; } catch { return ""; }
  });
  const [uploads, setUploads] = useState<UploadSession | null>(null);
  const [uploading, setUploading] =
    useState<{ filename: string; index: number; total: number; stage: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [stages, setStages] = useState<{ stage: string; status: string; detail: string }[]>([]);
  const [calls, setCalls] = useState<(AgentToolCall & { stage: string })[]>([]);
  // Which call's evidence is open. The log says a call happened; this says what
  // it brought back.
  const [traceCall, setTraceCall] = useState<AgentToolCall | null>(null);
  const [asis, setAsis] = useState<AsIsModel | null>(null);
  const [analysis, setAnalysis] = useState<RolloutAnalysis | null>(null);
  const [scores, setScores] = useState<RolloutScores | null>(null);
  const [gates, setGates] = useState<RolloutGates | null>(null);
  const [sources, setSources] = useState<RolloutSources | null>(null);
  // Which gap the Deviations tab should scroll to and flash, when a reader
  // arrives from a source citation rather than from the list.
  const [highlightGap, setHighlightGap] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [history, setHistory] = useState<RolloutRunSummary[]>([]);
  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);
  const [reviewer, setReviewer] = useState(() => {
    try { return localStorage.getItem("fitgap.reviewer") ?? ""; } catch { return ""; }
  });
  // Every verdict recorded against this run, oldest first. Loaded with a past
  // run and appended to as decisions are made, so a card can show what was
  // decided instead of looking exactly as it did before the click.
  const [decisions, setDecisions] = useState<RolloutDecision[]>([]);
  const [deciding, setDeciding] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Follow the tail of the live log, but stop following the moment the
  // analyst scrolls up to read an earlier line -- yanking them back to the
  // bottom every few seconds is worse than not following at all.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [calls.length, running]);

  const vocab = status?.vocabulary;
  const types = vocab?.deviation_types ?? {};
  const dispositions = vocab?.dispositions ?? {};
  const states = vocab?.localization_states ?? {};

  useEffect(() => {
    if (!active) return;
    rollout.status().then(setStatus).catch(() => setStatus(null));
    rollout.runs().then(setHistory).catch(() => setHistory([]));
  }, [active]);

  const refreshUploads = useCallback(async (id: string) => {
    if (!id) { setUploads(null); return; }
    try {
      const info = await sessionUploads.status(id);
      if (!info.exists) { setSession(""); setUploads(null); return; }
      setUploads(info);
    } catch { setUploads(null); }
  }, []);

  useEffect(() => {
    try {
      if (session) localStorage.setItem("rollout.uploads", session);
      else localStorage.removeItem("rollout.uploads");
    } catch { /* private mode */ }
  }, [session]);

  useEffect(() => { if (active) void refreshUploads(session); }, [active, session, refreshUploads]);

  useEffect(() => {
    try { localStorage.setItem("fitgap.reviewer", reviewer); } catch { /* private mode */ }
  }, [reviewer]);

  // The scope picker is the Copilot's — both agents read the Global Template
  // hierarchy out of the same BPML sheet.
  const [scopeUnknown, setScopeUnknown] = useState(false);

  useEffect(() => {
    const text = scopeText.trim();
    if (!text) { setMatches([]); setScope(null); setScopeUnknown(false); return; }
    const t = setTimeout(() => {
      fitgap.search(text)
        .then((r) => {
          setMatches(r.matches);
          setScope(r.matches[0] ?? null);
          setScopeUnknown(r.matches.length === 0);
        })
        .catch(() => setMatches([]));
    }, 220);
    return () => clearTimeout(t);
  }, [scopeText]);

  useEffect(() => {
    if (!session) { setPlan(null); return; }
    rollout.preview({ scope_bpml: scope?.code ?? "", upload_session: session, categories: [],
                      country, subject: subjectKey })
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [scope, session, country, uploads, subjectKey]);

  async function addUploads(files: File[], role: UploadRole) {
    setUploadError(null);
    let id = session;
    try {
      await uploadSessionDocuments(files, id, role, {
        session: (d) => { id = d.session; setSession(d.session); },
        start: (d) => setUploading({ ...d, stage: "converting" }),
        stage: (d) => setUploading({ index: d.index, total: d.total, filename: d.filename, stage: d.stage }),
        doneFile: () => undefined,
        fileError: (d) => setUploadError(`${d.filename}: ${d.message}`),
        done: (d) => { setUploads(d); setUploading(null); },
        error: (m) => setUploadError(m),
      });
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(null);
      await refreshUploads(id);
    }
  }

  async function retag(name: string, role: UploadRole) {
    try { setUploads(await sessionUploads.retag(session, name, role)); }
    catch (e) { setUploadError((e as Error).message); }
  }

  async function removeUpload(name: string) {
    try { await sessionUploads.remove(session, name); }
    catch (e) { setUploadError((e as Error).message); }
    await refreshUploads(session);
  }

  async function clearUploads() {
    const id = session;
    setSession(""); setUploads(null); setUploadError(null);
    try { if (id) await sessionUploads.drop(id); } catch { /* already swept */ }
  }

  async function start() {
    if (running || !session) return;
    setRunning(true);
    setError(null); setAsis(null); setAnalysis(null); setScores(null); setGates(null);
    setStages([]); setCalls([]); setRunId(null); setTab(0); setDecisions([]);
    setSources(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      await runRollout(
        {
          scope_bpml: scope?.code ?? "", upload_session: session, categories: [],
          subject: subjectKey,
          country: country.trim(), country_context: countryContext.trim(),
          sap_release: sapRelease.trim(), gt_version: gtVersion.trim(),
          question: question.trim() || null,
        },
        {
          scope: (d) => setRunId(d.run_id),
          stage: (d) => setStages((prev) => {
            const next = prev.filter((s) => s.stage !== d.stage);
            return [...next, { stage: d.stage, status: d.status, detail: d.detail }];
          }),
          toolCall: (d) => setCalls((prev) => [...prev, d]),
          asis: setAsis,
          gate: setGates,
          analysis: setAnalysis,
          scores: setScores,
          sources: setSources,
          done: () => undefined,
          error: setError,
        },
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
      controller.current = null;
      rollout.runs().then(setHistory).catch(() => undefined);
    }
  }

  // Which retrieved passages the analysis ended up resting on. Rollout records
  // this per chunk rather than per claim: `used_by` names the deviations and
  // fit areas a chunk carried, so an empty one was retrieved and never used.
  const citedChunks = useMemo(
    () => Object.values(sources?.chunks ?? {})
      .filter((c) => (c.used_by ?? []).length > 0)
      .map((c) => c.chunk_id),
    [sources],
  );

  // Deleting takes two presses. The first arms the button for five seconds and
  // then disarms itself, so a mis-click in a menu costs nothing; the second
  // removes the analysis and, by ON DELETE CASCADE, the decisions recorded
  // against it, which is why it is not a single click.
  const [armed, setArmed] = useState<string | null>(null);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (disarm.current) clearTimeout(disarm.current); }, []);

  async function remove(id: string) {
    if (armed !== id) {
      setArmed(id);
      if (disarm.current) clearTimeout(disarm.current);
      disarm.current = setTimeout(() => setArmed(null), 5000);
      return;
    }
    if (disarm.current) clearTimeout(disarm.current);
    setArmed(null);
    try {
      await rollout.deleteRun(id);
      // A deleted run must not be left on screen as though it were still there.
      if (runId === id) { setRunId(null); setCalls([]); setAsis(null); setAnalysis(null);
                          setScores(null); setGates(null); setSources(null); setDecisions([]); }
      setHistory(await rollout.runs());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadRun(id: string) {
    try {
      const run = await rollout.run(id);
      setRunId(run.id);
      setScopeText(run.scope_bpml);
      setCountry(run.country || "");
      setCountryContext(run.country_context || "");
      setSapRelease(run.sap_release || "");
      setGtVersion(run.gt_version || "");
      setQuestion(run.question || "");
      setSubjectKey(run.subject || "country_as_is");
      setSubjectTouched(true);   // the record decides, not the current uploads
      setAsis("steps" in run.asis ? (run.asis as AsIsModel) : null);
      setAnalysis("deviations" in run.analysis ? (run.analysis as RolloutAnalysis) : null);
      setScores("counts" in run.scores ? (run.scores as RolloutScores) : null);
      setGates("issues" in run.gates ? (run.gates as RolloutGates) : null);
      setDecisions(run.decisions ?? []);
      setSources("chunks" in (run.sources ?? {}) ? (run.sources as RolloutSources) : null);
      // The log is part of the record now, so a reopened run shows its working
      // rather than its conclusions alone.
      setCalls(run.calls ?? []);
      setStages([]); setError(null); setTab(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function decide(gapId: string, verdict: "accept" | "reject" | "defer") {
    // No anonymous verdicts. This used to fall back to "unnamed", which meant
    // a click with an empty name field wrote a row nobody could be asked
    // about -- the opposite of what a decision log is for. The buttons are
    // disabled without a name; this is the backstop.
    if (!runId || !reviewer.trim() || deciding[gapId]) return;
    setDeciding((d) => ({ ...d, [gapId]: verdict }));
    try {
      const saved = await rollout.decide(runId, {
        gap_id: gapId, reviewer: reviewer.trim(), verdict,
      });
      setDecisions((prev) => [...prev, saved]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeciding((d) => {
        const next = { ...d };
        delete next[gapId];
        return next;
      });
    }
  }

  // Grouped once per render rather than filtered inside every card.
  const decisionsByGap = useMemo(() => {
    const by: Record<string, RolloutDecision[]> = {};
    for (const d of decisions) (by[d.gap_id] ??= []).push(d);
    return by;
  }, [decisions]);

  // Arriving at a gap from somewhere else -- a source citation, an alignment
  // row -- should land on it, not at the top of a list of thirteen.
  useEffect(() => {
    if (!highlightGap || tab !== 1) return;
    const el = document.getElementById(`gap-${highlightGap}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setHighlightGap(""), 2200);
    return () => clearTimeout(t);
  }, [highlightGap, tab]);

  const runningStage = stages.find((s) => s.status === "running")?.stage ?? "";
  const counts = scores?.counts;
  const must = useMemo(
    () => (analysis?.deviations ?? []).filter((d) => d.workshop_bucket === "MUST_DISCUSS"),
    [analysis]);
  const confirm = useMemo(
    () => (analysis?.deviations ?? []).filter((d) => d.workshop_bucket === "CONFIRM"),
    [analysis]);
  const noTime = useMemo(
    () => (analysis?.deviations ?? []).filter((d) => d.workshop_bucket === "NO_WORKSHOP_TIME"),
    [analysis]);
  const attachedRoles = useMemo(
    () => new Set((uploads?.files ?? []).map((f) => f.role)),
    [uploads]);
  // An As-Is wins when both are attached: it is the richer analysis, and it
  // is what someone who attached one came for.
  const inferredSubject =
    attachedRoles.has("as_is") ? "country_as_is"
      : attachedRoles.has("sap_bp") ? "sap_best_practice"
        : null;

  useEffect(() => {
    if (!subjectTouched && inferredSubject && inferredSubject !== subjectKey) {
      setSubjectKey(inferredSubject);
    }
  }, [inferredSubject, subjectTouched, subjectKey]);

  const subject: RolloutSubject =
    status?.subjects?.find((x) => x.value === subjectKey)
    ?? { value: "country_as_is", label: "Country As-Is", role: "as_is",
         localization: true, score_b: true };
  const ready = !!plan?.ready && !scopeUnknown && !!status?.anthropic_key;

  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Box sx={{ maxWidth: 1320, mx: "auto", px: { xs: 2, md: 3 }, py: 4 }}>

        {/* ------------------------------------------------------- the header */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.25, flexWrap: "wrap", gap: 1 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, display: "grid", placeItems: "center",
                     bgcolor: alpha(theme.palette.primary.main, 0.12), color: "primary.main" }}>
            <Globe2 size={19} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-.02em" }}>
            Rollout Agent
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="text" startIcon={<History size={14} />}
                  onClick={(e) => setHistoryAnchor(e.currentTarget)} sx={{ fontSize: 12.5 }}>
            {history.length ? `${history.length} run${history.length === 1 ? "" : "s"}` : "History"}
          </Button>
          {runId && analysis && (
            <>
              <Tooltip title={pdfReady
                ? "The whole analysis as a PDF — every section, every table, ready to print or send"
                : `This server cannot render PDFs. ${status?.pdf?.detail ?? ""}`}>
                <span>
                  <Button size="small" variant="contained" disabled={!pdfReady}
                          startIcon={<FileDown size={14} />}
                          href={pdfReady ? rollout.exportUrl(runId, "pdf") : undefined}
                          sx={{ fontSize: 12.5 }}>
                    PDF
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="The same pack as Markdown, to paste into a wiki or Cloud ALM">
                <Button size="small" variant="outlined" startIcon={<Download size={14} />}
                        href={rollout.exportUrl(runId, "md")} sx={{ fontSize: 12.5 }}>
                  Markdown
                </Button>
              </Tooltip>
              <Button size="small" variant="text" href={rollout.exportUrl(runId, "json")}
                      sx={{ fontSize: 12.5 }}>JSON</Button>
            </>
          )}
        </Stack>
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.65, color: "text.secondary",
                           maxWidth: 860, mb: 3.5 }}>
          SAP Activate Fit-to-Standard. Reads one document set as the run's subject — a country's
          As-Is, or SAP Best Practice content to find where the template has drifted from standard
          — compares it against the Global Template, and turns the difference into a short list of
          decisions. It does not replace the workshop; it makes it decision-oriented instead of
          discovery-heavy.
        </Typography>

        <Menu anchorEl={historyAnchor} open={!!historyAnchor} onClose={() => setHistoryAnchor(null)}>
          {history.length === 0 && <MenuItem disabled sx={{ fontSize: 12.5 }}>No runs yet</MenuItem>}
          {history.map((r) => (
            <MenuItem key={r.id} onClick={() => { setHistoryAnchor(null); void loadRun(r.id); }}
                      sx={{ fontSize: 12.5, gap: 1.5, pr: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                  {r.scope_label}{r.country ? ` · ${r.country}` : ""}
                </Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {r.started_at?.slice(0, 16).replace("T", " ")} · {r.status}
                  {r.gt_alignment !== null ? ` · GT ${r.gt_alignment}%` : ""}
                  {r.deviations ? ` · ${r.deviations} deviations` : ""}
                </Typography>
              </Box>
              {/* Two presses, not a confirm dialog: a menu that opens a modal
                  over itself is worse than the accident it prevents, and an
                  analysis carries decisions somebody recorded against it. The
                  arming disarms itself, so a stray first click is harmless. */}
              <Tooltip title={armed === r.id
                ? "Press again to delete this analysis and any decisions recorded against it"
                : "Delete this analysis"}>
                <IconButton
                  size="small" aria-label={armed === r.id ? "Confirm delete" : "Delete analysis"}
                  onClick={(e) => { e.stopPropagation(); void remove(r.id); }}
                  sx={{ color: armed === r.id ? "error.main" : "text.disabled",
                        "&:hover": { color: "error.main" } }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </Tooltip>
            </MenuItem>
          ))}
        </Menu>

        {status && (!status.anthropic_key || status.error || !status.bpml.available) && (
          <Alert severity="warning" sx={{ mb: 3, fontSize: 12.5 }}>
            {!status.anthropic_key && <div>No <code>ANTHROPIC_API_KEY</code> is set, so no analysis can run.</div>}
            {!status.bpml.available && <div>The BPML sheet is not readable, so the Global Template hierarchy is unavailable.</div>}
            {status.error && <div>{status.error}</div>}
          </Alert>
        )}

        {/* --------------------------------------------------------- the setup */}
        <Paper sx={{ p: 2.75, mb: 3 }}>
          <TextField
            fullWidth multiline maxRows={3} value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Anything specific the rollout team needs from this analysis (optional)"
            slotProps={{ input: {
              sx: { fontSize: 14.5, alignItems: "flex-start" },
              startAdornment: <Box sx={{ pt: 0.35, pr: 1.25, color: "primary.main" }}><Sparkles size={17} /></Box>,
              endAdornment: clearAdornment(question, () => setQuestion(""),
                                           { size: 16, label: "Clear question", top: true }),
            } }}
          />

          <Sources
            data={uploads} busy={uploading} error={uploadError} disabled={running}
            accepted={status?.uploads?.accepted ?? [".pdf", ".docx", ".xlsx", ".pptx", ".txt"]}
            roles={status?.uploads?.roles ?? [{ value: "as_is", label: "Country As-Is" }]}
            subject={subject}
            subjects={status?.subjects ?? []}
            onSubject={(v) => { setSubjectKey(v); setSubjectTouched(true); }}
            maxFiles={status?.uploads?.max_files ?? 12}
            onAdd={addUploads} onRetag={retag} onRemove={removeUpload} onClear={clearUploads}
          />

          <Divider sx={{ my: 2 }} />

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}
                 sx={{ alignItems: { md: "flex-start" }, mb: 3 }}>
            <Select size="small" value={subjectKey} disabled={running}
                    onChange={(e) => { setSubjectKey(e.target.value); setSubjectTouched(true); }}
                    sx={{ fontSize: 12.5, minWidth: 210 }}>
              {(status?.subjects ?? []).map((x) => (
                <MenuItem key={x.value} value={x.value} sx={{ fontSize: 12.5 }}>
                  Analyse: {x.label}
                </MenuItem>
              ))}
            </Select>
            <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, color: "text.secondary",
                               flex: 1, maxWidth: 620, pt: { md: 0.85 } }}>
              {subject.value === "country_as_is"
                ? "How far the country's current process is from the Global Template, with"
                  + " localization as a lens."
                : "How far the Global Template has drifted from SAP's delivered standard."
                  + " No country, no localization — the findings are about the template."}
              {!subjectTouched && inferredSubject === subject.value && (
                <Box component="span" sx={{ display: "block", color: "text.disabled", mt: 0.75 }}>
                  Chosen from what you attached — change it here if that is not what you meant.
                </Box>
              )}
            </Typography>
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} useFlexGap
                 sx={{ alignItems: { md: "center" }, flexWrap: "wrap", gap: 2, rowGap: 2.5 }}>
            <TextField
              size="small" label="Global Template process (optional)"
              placeholder="A BPML code or name — leave empty to let the agent find it"
              value={scopeText} onChange={(e) => setScopeText(e.target.value)}
              onKeyDown={clearOnEscape(() => setScopeText(""))}
              error={scopeUnknown}
              helperText={scopeUnknown
                ? "No BPML process matches. Correct it, or clear the field to let the agent choose."
                : undefined}
              sx={{ flex: "1 1 340px" }}
              slotProps={{ input: {
                startAdornment: <Box sx={{ pr: 1, color: "text.secondary" }}><Search size={15} /></Box>,
                // The helper text tells you to clear this field to let the agent
                // choose the scope itself, so it had better be one click.
                endAdornment: clearAdornment(scopeText, () => setScopeText(""), { label: "Clear scope" }),
              } }}
            />
            {subject.localization && (
              <TextField size="small" label="Country" value={country} sx={{ width: 150 }}
                         onChange={(e) => setCountry(e.target.value)} placeholder="India" />
            )}
            {scope ? (
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", px: 1.75, py: 1.15,
                        borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <Target size={14} color={theme.palette.primary.main} />
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{scope.code} {scope.name}</Typography>
              </Stack>
            ) : !scopeText.trim() ? (
              // Said here rather than left blank: an empty required-looking
              // field reads as something forgotten, not as a choice.
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", px: 1.75, py: 1.15,
                        borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.05) }}>
                <CircleHelp size={14} color={theme.palette.text.secondary} />
                <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                  The agent will identify the template process
                </Typography>
              </Stack>
            ) : null}
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="text"
                    endIcon={<ChevronDown size={15} style={{ transform: showOptions ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />}
                    onClick={() => setShowOptions((v) => !v)}>
              Context
            </Button>
            {running ? (
              <Button variant="outlined" color="error" startIcon={<Square size={15} />}
                      onClick={() => { controller.current?.abort(); setRunning(false); }}>Stop</Button>
            ) : (
              <Button variant="contained" size="large" disabled={!ready} onClick={start}
                      startIcon={<Scale size={16} />}>
                Analyse
              </Button>
            )}
          </Stack>

          {matches.length > 1 && (
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.85, mt: 2 }}>
              {matches.slice(0, 6).map((m) => (
                <Chip key={m.code} size="small" label={`${m.code} ${m.name}`}
                      variant={scope?.code === m.code ? "filled" : "outlined"}
                      onClick={() => { setScope(m); setScopeText(m.code); }}
                      sx={{ fontSize: 11.5, height: 26, maxWidth: 320 }} />
              ))}
            </Stack>
          )}

          <Collapse in={showOptions}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: "divider" }}>
              <TextField size="small" label="Country context" value={countryContext} multiline minRows={2}
                         onChange={(e) => setCountryContext(e.target.value)} sx={{ flex: "2 1 320px" }}
                         placeholder="Company codes, sales/purchasing organisations, legal entities, shared-service model, tax context" />
              <Stack spacing={1.5} sx={{ flex: "1 1 240px" }}>
                <TextField size="small" label="SAP target solution / release" value={sapRelease}
                           onChange={(e) => setSapRelease(e.target.value)}
                           placeholder="S/4HANA Cloud Private Edition 2023" />
                <TextField size="small" label="Global Template version" value={gtVersion}
                           onChange={(e) => setGtVersion(e.target.value)} />
              </Stack>
              <Box sx={{ flex: "1 1 220px" }}>
                <TextField size="small" fullWidth label="Your name (for decisions)" value={reviewer}
                           onChange={(e) => setReviewer(e.target.value)} />
              </Box>
            </Stack>
          </Collapse>

          {plan && !plan.ready && (
            <Alert severity="info" sx={{ mt: 2.5, py: 0.85, fontSize: 12.5 }}>{plan.blocker}</Alert>
          )}
          {plan?.ready && !running && !analysis && (
            <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 1.5 }}>
              Two passes — read the {subject.label}, then compare it — roughly {plan.estimated_minutes} minutes and
              ~{Math.round(plan.estimated_input_tokens / 1000)}k input tokens. Estimated, not measured.
              {!plan.sap_bp_available && " No SAP Best Practice source is attached, so Score B will be reported as not assessable rather than guessed."}
            </Typography>
          )}
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12.5 }}>{error}</Alert>}

        {/* ---------------------------------------------------------- progress */}
        {(running || stages.length > 0) && !analysis && (
          <Paper sx={{ p: 2.75, mb: 3 }}>
            <SectionLabel icon={<ListChecks size={14} />}>Progress</SectionLabel>
            <Stack spacing={1}>
              {["asis", "compare", "gates"].map((key) => {
                const s = stages.find((x) => x.stage === key);
                const label = key === "asis" ? `Read the ${subject.label}`
                  : key === "compare" ? "Compare against the Global Template" : "Quality gates";
                return (
                  <Stack key={key} direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                    {s?.status === "done" ? <CheckCircle2 size={14} color={semantic.fit} />
                      : s?.status === "running" ? <CircularProgress size={12} />
                        : <Box sx={{ width: 14 }} />}
                    <Typography sx={{ fontSize: 12.5, fontWeight: s ? 600 : 400,
                                      color: s ? "text.primary" : "text.disabled" }}>{label}</Typography>
                    {s?.detail && <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>— {s.detail}</Typography>}
                  </Stack>
                );
              })}
            </Stack>
          </Paper>
        )}

        {/* --------------------------------------------------- the investigation */}
        {/* Its own panel, not a corner of Progress. Progress renders only while
            there is no analysis yet, so the log used to vanish at the exact
            moment the run finished -- and a run reopened from history, which
            always has an analysis, never showed one at all. The log is the
            working behind the answer; it outlives the run that produced it. */}
        {(calls.length > 0 || running || (runId && !running)) && (
          <Paper sx={{ p: 2.75, mb: 3 }}>
            <SectionLabel icon={<ListChecks size={14} />}
              right={calls.length ? (
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {calls.length} call{calls.length === 1 ? "" : "s"}
                </Typography>
              ) : undefined}>
              Investigation
            </SectionLabel>
            {calls.length === 0 && !running ? (
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                This run was recorded before the log kept what each call returned.
                Run the analysis again to get a log you can open.
              </Typography>
            ) : (
            <Box ref={logRef}
                 sx={{ mt: 1.5, maxHeight: 220, overflowY: "auto", p: 1, borderRadius: 1.5,
                       bgcolor: alpha(theme.palette.text.primary, 0.035) }}>
              {calls.some((c) => c.trace) ? (
                <Typography sx={{ fontSize: 10.5, color: "text.disabled", mb: 0.75 }}>
                  Click a call to see what it returned.
                </Typography>
              ) : !running && calls.length > 0 ? (
                <Typography sx={{ fontSize: 10.5, color: "text.disabled", mb: 0.75 }}>
                  This run was recorded before the log kept what each call returned.
                </Typography>
              ) : null}
              {calls.map((c, i) => (
                <Stack key={i} direction="row" spacing={1}
                       onClick={c.trace ? () => setTraceCall(c) : undefined}
                       role={c.trace ? "button" : undefined}
                       tabIndex={c.trace ? 0 : undefined}
                       onKeyDown={c.trace ? (e) => {
                         if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTraceCall(c); }
                       } : undefined}
                       sx={{ alignItems: "baseline", fontFamily: "monospace",
                             // Only a call that kept a trace opens anything. A
                             // failed one stays a log line rather than a button
                             // that opens an apology.
                             cursor: c.trace ? "pointer" : "default",
                             borderRadius: 0.75, px: 0.5, mx: -0.5, py: 0.15,
                             transition: "background-color .12s",
                             "&:hover": c.trace
                               ? { bgcolor: alpha(theme.palette.text.primary, 0.06) }
                               : undefined,
                             "&:focus-visible": {
                               outline: `2px solid ${theme.palette.primary.main}`,
                               outlineOffset: 1,
                             } }}>
                  <Typography component="span" sx={{ fontSize: 10.5, color: "text.disabled",
                                                     minWidth: 22, textAlign: "right" }}>
                    {i + 1}
                  </Typography>
                  <Typography component="span"
                              sx={{ fontSize: 10.5, minWidth: 62,
                                    color: ENGINE_COLOUR[c.engine] ?? "primary.main",
                                    textDecoration: c.trace ? "underline" : "none",
                                    textDecorationStyle: "dotted",
                                    textUnderlineOffset: 3 }}>
                    {c.tool}
                  </Typography>
                  <Typography component="span"
                              sx={{ fontSize: 12, flex: 1,
                                    color: c.error ? "error.main" : "text.secondary",
                                    wordBreak: "break-word" }}>
                    {c.summary || c.error}
                    {/* Which store the call read. The corpus is one table
                        with a category per row and the attachment is in a
                        database of its own, so "searched" without saying
                        where is not an answer. */}
                    {c.sources?.label ? (
                      <Box component="span" sx={{ color: "text.disabled" }}>
                        {"  ·  "}{String(c.sources.label)}
                      </Box>
                    ) : null}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: 10.5, color: "text.disabled" }}>
                    {c.ms}ms
                  </Typography>
                </Stack>
              ))}
              {running && (
                // Between tool calls the agent is generating, which is most
                // of the wall clock. A log that goes quiet for a minute with
                // no line saying why reads as a hang.
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: calls.length ? 0.5 : 0 }}>
                  <CircularProgress size={9} />
                  <Typography sx={{ fontSize: 12, color: "text.disabled", fontStyle: "italic" }}>
                    {runningStage === "gates" ? "checking the analysis…" : "the agent is thinking…"}
                  </Typography>
                </Stack>
              )}
        </Box>
            )}
          </Paper>
        )}

        {/* ----------------------------------------------- §16.1 the fit header */}
        {scores && (
          <Paper sx={{ p: 2.75, mb: 3 }}>
            <SectionLabel icon={<Scale size={14} />}
              right={<Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {counts?.fit_areas ?? 0} fit · {counts?.deviations ?? 0} deviations ·
                {" "}{counts?.localization_confirmed ?? 0} confirmed localization
              </Typography>}>
              Fit summary{scope ? ` — ${scope.code} ${scope.name}` : ""}{country ? ` · ${country}` : ""}
            </SectionLabel>

            {!scope && analysis?.template_process && (
              <Alert severity="info" icon={<Target size={15} />} sx={{ mb: 2.5, py: 0.85, fontSize: 12.5 }}>
                No Global Template process was named, so the agent compared the {subject.label} against{" "}
                <b>{analysis.template_process}</b>.
              </Alert>
            )}

            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
              <ScoreTile label="Global Template" value={scores.gt_alignment} band={scores.gt_band} />
              <ScoreTile label="SAP Best Practice" value={scores.sap_bp_alignment} band={scores.sap_bp_band}
                         hint={scores.sap_bp_note || "No SAP Best Practice source"}
                         accent={theme.palette.secondary?.main} />
              <ScoreTile label="Localization-adjusted" value={scores.localization_adjusted}
                         band={`${scores.localization_share}% of divergence is confirmed localization`}
                         hint={scores.subject && scores.subject !== "country_as_is"
                           ? `Not applicable: localization is a country question and a ${
                               scores.subject_label ?? "non-country"} run has no country in it.`
                           : undefined}
                         accent={theme.palette.info.main} />
              <ScoreTile label="Harmonization potential" value={scores.harmonization_potential}
                         band={scores.harmonization_band} accent={theme.palette.success.main} />
            </Stack>

            {scores.pattern && (
              <Alert severity="info" icon={<CircleHelp size={15} />} sx={{ mt: 2.5, py: 0.85, fontSize: 12.5 }}>
                {scores.pattern}
              </Alert>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, alignItems: "center", flexWrap: "wrap", gap: 1.25 }}>
              <Chip size="small" color="error" label={`${counts?.workshop?.MUST_DISCUSS ?? 0} decisions`}
                    sx={{ height: 24, fontSize: 12.5, fontWeight: 700 }} />
              <Chip size="small" color="warning" label={`${counts?.workshop?.CONFIRM ?? 0} to confirm`}
                    sx={{ height: 24, fontSize: 12.5 }} />
              <Chip size="small" label={`${counts?.workshop?.NO_WORKSHOP_TIME ?? 0} need no floor time`}
                    sx={{ height: 24, fontSize: 12.5 }} />
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                ≈{counts?.workshop_minutes ?? 0} min of focused discussion
              </Typography>
            </Stack>

            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 2.5, fontStyle: "italic" }}>
              {scores.formula}
            </Typography>
            {analysis?.headline && (
              <Typography sx={{ fontSize: 14, lineHeight: 1.6, mt: 2.5, pt: 2.5,
                               borderTop: 1, borderColor: "divider" }}>{analysis.headline}</Typography>
            )}
          </Paper>
        )}

        {/* -------------------------------------------------------- the results */}
        {analysis && scores && (
          <Paper sx={{ mb: 3.5 }}>
            {/* Who is deciding, at the point of deciding. It lives in the run
                options too, but that panel is collapsed by default -- which is
                how a session's worth of verdicts ended up filed under no name
                at all. */}
            {runId && (
              <Stack direction="row" spacing={1.25}
                     sx={{ px: 2, pt: 1.75, alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <TextField size="small" placeholder="Your name" value={reviewer}
                           onChange={(e) => setReviewer(e.target.value)}
                           error={!reviewer.trim() && decisions.length === 0}
                           sx={{ width: 220, "& .MuiInputBase-input": { fontSize: 12.5 } }} />
                <Typography sx={{ fontSize: 12.5, color: reviewer.trim() ? "text.secondary" : "error.main" }}>
                  {reviewer.trim()
                    ? `Accept, defer and reject are recorded against ${reviewer.trim()}.`
                    : "Name yourself to accept, defer or reject a gap — a verdict nobody owns is not a decision."}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {decisions.length > 0 && (
                  <Chip size="small" label={`${new Set(decisions.map((d) => d.gap_id)).size} of `
                        + `${analysis.deviations.length} decided`}
                        sx={{ height: 22, fontSize: 11 }} />
                )}
              </Stack>
            )}
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
                  sx={{ borderBottom: 1, borderColor: "divider", px: 1 }}>
              <Tab label={`Workshop (${must.length})`} sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label={`Deviations (${analysis.deviations.length})`} sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label={subject.localization
                            ? `Localization (${analysis.localization.length})`
                            : "Localization — n/a"}
                   sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label="Alignment" sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label={`Backlog (${analysis.backlog.length})`} sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label={`${subject.label} (${asis?.steps.length ?? 0})`}
                   sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label="Quality" sx={{ fontSize: 12.5, minHeight: 44 }} />
              <Tab label={`Sources${sources ? ` (${sources.documents.length})` : ""}`}
                   sx={{ fontSize: 12.5, minHeight: 44 }} />
            </Tabs>

            <Box sx={{ p: 2 }}>
              {/* ------------------------------------------------ workshop scope */}
              {tab === 0 && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                    Legal and localization blockers first, then controls and financial impact, then the
                    rest by materiality. Every item carries an explicit decision, not a discussion topic.
                  </Typography>
                  {scores.agenda.map((item) => {
                    const gap = analysis.deviations.find((d) => d.gap_id === item.gap_id);
                    return gap ? (
                      <Box key={item.gap_id}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "text.secondary", mb: 0.4 }}>
                          {item.position}. ~{item.minutes} min
                        </Typography>
                        <GapCard gap={gap} types={types} dispositions={dispositions} states={states}
                                 onDecide={runId ? (v) => decide(gap.gap_id, v) : undefined}
                                 decisions={decisionsByGap[gap.gap_id]}
                                 reviewer={reviewer} busy={deciding[gap.gap_id]}
                                 subjectLabel={subject.label}
                                 chunks={sources?.chunks} session={session} />
                      </Box>
                    ) : null;
                  })}
                  {must.length === 0 && (
                    <Alert severity="success" sx={{ fontSize: 12.5 }}>
                      Nothing needs floor time. Every difference is either a confirmed fit or a
                      batch confirmation.
                    </Alert>
                  )}
                  {(confirm.length > 0 || analysis.fit_areas.length > 0) && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <SectionLabel icon={<CheckCircle2 size={14} />}>Batch-confirm, no discussion</SectionLabel>
                      {analysis.fit_areas.map((f, i) => (
                        <Stack key={i} direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
                          <CheckCircle2 size={13} color={semantic.fit} style={{ marginTop: 3, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 12.5 }}>
                            {f.statement}
                            {(f.as_is_step_id || f.gt_step_ref) && (
                              <Box component="span" sx={{ color: "text.secondary" }}>
                                {" "}({[f.as_is_step_id, f.gt_step_ref].filter(Boolean).join(" · ")})
                              </Box>
                            )}
                          </Typography>
                        </Stack>
                      ))}
                      {confirm.map((d) => (
                        <Stack key={d.gap_id} direction="row" spacing={1.25} sx={{ alignItems: "flex-start", mt: 0.85 }}>
                          <AlertTriangle size={13} color={semantic.minor} style={{ marginTop: 3, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 12.5 }}>
                            <b>{d.gap_id}</b> — {d.exact_difference}
                          </Typography>
                        </Stack>
                      ))}
                    </>
                  )}
                  {noTime.length > 0 && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      {noTime.length} further difference{noTime.length === 1 ? " needs" : "s need"} no
                      workshop time; see the Deviations tab.
                    </Typography>
                  )}
                </Stack>
              )}

              {/* --------------------------------------- the deviation register */}
              {tab === 1 && (
                <Stack spacing={1.5}>
                  {analysis.deviations.map((d) => (
                    <Box key={d.gap_id} id={`gap-${d.gap_id}`}
                         sx={{ scrollMarginTop: 80, borderRadius: 2,
                               transition: "box-shadow .4s",
                               boxShadow: highlightGap === d.gap_id
                                 ? `0 0 0 2px ${theme.palette.primary.main}` : "none" }}>
                      <GapCard gap={d} types={types} dispositions={dispositions}
                               states={states} onDecide={runId ? (v) => decide(d.gap_id, v) : undefined}
                               decisions={decisionsByGap[d.gap_id]}
                               reviewer={reviewer} busy={deciding[d.gap_id]}
                               subjectLabel={subject.label}
                               chunks={sources?.chunks} session={session} />
                    </Box>
                  ))}
                  {analysis.deviations.length === 0 && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      No material deviation was found between the {subject.label} and the Global Template.
                    </Typography>
                  )}
                </Stack>
              )}

              {/* ------------------------------------------ localization advisory */}
              {tab === 2 && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                    {subject.localization
                      ? "Only findings that interact with this process. A requirement is confirmed"
                        + " statutory only where an explicit source says so — country-specific is"
                        + " not the same as legally required."
                      : `Not applicable: this run analyses the ${subject.label} against the Global`
                        + " Template and has no country in it, so there is nobody for a statutory"
                        + " requirement to apply to. Localization findings are reported in a"
                        + " Country As-Is run."}
                  </Typography>
                  {analysis.localization.map((item, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                        <Globe2 size={14} color={theme.palette.info.main} />
                        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{item.topic}</Typography>
                        <Chip size="small" label={item.status}
                              color={item.status === "Confirmed" ? "info" : item.status === "Candidate" ? "warning" : "default"}
                              sx={{ height: 20, fontSize: 10.5 }} />
                      </Stack>
                      <Stack spacing={0.75} sx={{ mt: 1 }}>
                        <Row label="Relevance" value={item.relevance} />
                        <Row label="Requirement" value={item.requirement} />
                        <Row label="SAP" value={item.sap_capability} />
                        <Row label="Template" value={item.gt_capability} />
                        <Row label="Country" value={item.as_is_handling} />
                        <Row label="Path" value={item.recommended_path} />
                        <Row label="Decision" value={item.workshop_decision} />
                        <Row label="Owner" value={item.owner.join(", ")} />
                      </Stack>
                    </Paper>
                  ))}
                  {analysis.localization.length === 0 && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      No localization topic interacts with this process, on the evidence read.
                    </Typography>
                  )}
                </Stack>
              )}

              {/* --------------------------------------------- scores and heatmap */}
              {tab === 3 && (
                <Stack spacing={2}>
                  <Box>
                    <SectionLabel icon={<Scale size={14} />}>Alignment by dimension</SectionLabel>
                    <Stack spacing={1.25}>
                      {scores.dimensions.map((row) => (
                        <AlignmentRow key={row.dimension}
                                      deviations={analysis.deviations.filter(
                                        (d) => d.dimension === row.dimension)}
                                      chunks={sources?.chunks} session={session}
                                      onGap={(ref) => { setTab(1); setHighlightGap(ref); }}>
                          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                            <Typography sx={{ fontSize: 12.5, fontWeight: 600, minWidth: 220 }}>
                              {row.label}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: "text.secondary", minWidth: 34 }}>
                              {row.weight}%
                            </Typography>
                            <Box sx={{ flex: 1, height: 7, borderRadius: 4, bgcolor: "divider", overflow: "hidden" }}>
                              <Box sx={{ width: `${row.percent ?? 0}%`, height: "100%",
                                         bgcolor: (row.percent ?? 0) >= 75 ? semantic.fit
                                           : (row.percent ?? 0) >= 50 ? semantic.minor : semantic.material }} />
                            </Box>
                            <Typography sx={{ fontSize: 12.5, fontWeight: 700, minWidth: 54, textAlign: "right" }}>
                              {row.rating === null ? "—" : `${row.rating}/4`}
                            </Typography>
                          </Stack>
                          {row.note && (
                            <Typography sx={{ fontSize: 12, color: "text.secondary", ml: "228px" }}>{row.note}</Typography>
                          )}
                        </AlignmentRow>
                      ))}
                    </Stack>
                  </Box>

                  <Box>
                    <SectionLabel icon={<Layers size={14} />}>Deviation heatmap</SectionLabel>
                    <Stack spacing={0.85}>
                      {scores.heatmap.map((row) => (
                        <Stack key={row.dimension} direction="row" spacing={1.5}
                               onClick={row.deviations ? () => {
                                 const first = analysis.deviations.find(
                                   (d) => d.dimension === row.dimension);
                                 if (first) { setTab(1); setHighlightGap(first.gap_id); }
                               } : undefined}
                               sx={{ alignItems: "center", py: 1, borderBottom: 1,
                                     borderColor: "divider",
                                     cursor: row.deviations ? "pointer" : "default",
                                     "&:hover": row.deviations ? { bgcolor: "action.hover" } : {} }}>
                          <Typography sx={{ fontSize: 12.5, minWidth: 220 }}>{row.label}</Typography>
                          <Dot colour={row.focus === "High" ? semantic.material
                            : row.focus === "Medium" ? semantic.minor
                              : row.focus === "Low" ? semantic.fit : semantic.unknown}
                               title={`${row.focus} focus`} />
                          <Typography sx={{ fontSize: 12.5, color: "text.secondary", minWidth: 150 }}>
                            {row.deviations} deviation{row.deviations === 1 ? "" : "s"}
                            {row.must_discuss ? ` · ${row.must_discuss} to decide` : ""}
                          </Typography>
                          {row.localization > 0 && (
                            <Chip size="small" icon={<Globe2 size={10} />} label={`${row.localization} localization`}
                                  sx={{ height: 19, fontSize: 10.5, bgcolor: alpha(theme.palette.info.main, 0.12), color: "info.main" }} />
                          )}
                          <Box sx={{ flex: 1 }} />
                          <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontFamily: "monospace" }}>
                            {row.gap_ids.join(" ")}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>

                  {analysis.sap_bp_note && (
                    <Alert severity="info" sx={{ fontSize: 12.5 }}>{analysis.sap_bp_note}</Alert>
                  )}
                </Stack>
              )}

              {/* ------------------------------------------- backlog candidates */}
              {tab === 4 && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                    Candidates only. A hypothesis does not become project scope until the workshop
                    validates it — each one names the gap it came from.
                  </Typography>
                  {analysis.backlog.map((item, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{item.title}</Typography>
                        <Chip size="small" label={item.priority} sx={{ height: 20, fontSize: 10.5 }} />
                        <Chip size="small" variant="outlined" label={item.build_type} sx={{ height: 20, fontSize: 10.5 }} />
                        {item.localization_flag && (
                          <Chip size="small" icon={<Globe2 size={10} />} label="localization" color="info"
                                sx={{ height: 20, fontSize: 10.5 }} />
                        )}
                        <Box sx={{ flex: 1 }} />
                        <Typography sx={{ fontSize: 10.5, fontFamily: "monospace", color: "text.secondary" }}>
                          {item.gap_id}
                        </Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 12.5, mt: 0.75 }}>{item.requirement}</Typography>
                      {item.business_value && (
                        <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.75 }}>
                          {item.business_value}
                        </Typography>
                      )}
                      {item.acceptance_criteria.length > 0 && (
                        <Box sx={{ mt: 0.75 }}>
                          {item.acceptance_criteria.map((c, n) => (
                            <Typography key={n} sx={{ fontSize: 12.5 }}>· {c}</Typography>
                          ))}
                        </Box>
                      )}
                    </Paper>
                  ))}
                  {analysis.backlog.length === 0 && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      No finding is evidenced well enough to propose as a backlog candidate yet.
                    </Typography>
                  )}
                  {analysis.open_questions.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <SectionLabel icon={<CircleHelp size={14} />}>Evidence requests</SectionLabel>
                      {analysis.open_questions.map((q, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5 }}>· {q}</Typography>
                      ))}
                    </>
                  )}
                </Stack>
              )}

              {/* ------------------------------------------------ the As-Is model */}
              {tab === 5 && asis && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                    {asis.process_name}
                  </Typography>
                  {asis.steps.map((s) => (
                    <Paper key={s.step_id} variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                        <Typography sx={{ fontSize: 12.5, fontFamily: "monospace", color: "text.secondary" }}>
                          {s.step_id}
                        </Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{s.name}</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Chip size="small" label={s.confidence} sx={{ height: 19, fontSize: 10.5 }} />
                      </Stack>
                      <Stack spacing={0.6} sx={{ mt: 0.75 }}>
                        <Row label="Actor" value={s.actor} />
                        <Row label="System" value={s.system} />
                        <Row label="Rule" value={s.business_rule} />
                        <Row label="Decision" value={s.decision} />
                        <Row label="Control" value={s.control} />
                        <Row label="Output" value={s.output} />
                        <Row label="Exception" value={s.exception} />
                        <Row label="Timing" value={s.timing} />
                      </Stack>
                    </Paper>
                  ))}
                  {asis.normalisation_notes.length > 0 && (
                    <>
                      <SectionLabel icon={<ShieldCheck size={14} />}>Terminology normalised</SectionLabel>
                      {asis.normalisation_notes.map((n, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5 }}>· {n}</Typography>
                      ))}
                    </>
                  )}
                  {asis.evidence_gaps.length > 0 && (
                    <>
                      <SectionLabel icon={<CircleHelp size={14} />}>
                        Evidence gaps in the {subject.label}
                      </SectionLabel>
                      {asis.evidence_gaps.map((g, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5 }}>· {g}</Typography>
                      ))}
                    </>
                  )}
                </Stack>
              )}

              {/* -------------------------------------------------- quality gates */}
              {tab === 6 && (
                <Stack spacing={1.25}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                    <Chip size="small" color={gates?.hard ? "error" : "success"}
                          label={`${gates?.hard ?? 0} hard`} sx={{ height: 22, fontSize: 12.5, fontWeight: 700 }} />
                    <Chip size="small" label={`${gates?.soft ?? 0} soft`} sx={{ height: 22, fontSize: 12.5 }} />
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      Hard issues were repaired: bad evidence dropped, unevidenced statutory claims
                      demoted, extensions without standard options turned back into decisions.
                    </Typography>
                  </Stack>
                  {(gates?.items ?? []).map((issue, i) => (
                    <Stack key={i} direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
                      <Chip size="small" label={issue.gate} color={issue.severity === "hard" ? "error" : "default"}
                            sx={{ height: 19, fontSize: 10.5, minWidth: 40 }} />
                      <Typography sx={{ fontSize: 12.5 }}>
                        {issue.gap_id && <b>{issue.gap_id} — </b>}{issue.detail}
                      </Typography>
                    </Stack>
                  ))}
                  {(gates?.not_checked ?? []).length > 0 && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 1 }}>
                      Not checked mechanically: {(gates?.not_checked ?? []).join("; ")}.
                    </Typography>
                  )}
                </Stack>
              )}

              {/* --------------------------------------------- traceability */}
              {tab === 7 && (
                <Stack spacing={1.5}>
                  {!sources ? (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                      No source record for this run. The retrieval log is kept with a run from
                      this version on; a run made earlier shows its quotes but cannot show where
                      in a document they came from.
                    </Typography>
                  ) : (
                    <>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                        <Chip size="small" label={`${sources.documents.length} documents`}
                              sx={{ height: 22, fontSize: 12.5, fontWeight: 700 }} />
                        <Chip size="small" label={`${sources.cited_total} chunks cited`}
                              sx={{ height: 22, fontSize: 12.5 }} />
                        <Chip size="small" label={`${sources.unused_total} read, not used`}
                              sx={{ height: 22, fontSize: 12.5 }} />
                        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                          Everything the analysis rests on. The second number is the honest one:
                          it separates “the corpus does not say” from “the agent did not look”.
                        </Typography>
                      </Stack>

                      {sources.documents.map((doc) => (
                        <SourceDocument key={doc.document} doc={doc} sources={sources}
                                        session={session} onGap={(ref) => {
                                          setTab(1);
                                          setHighlightGap(ref);
                                        }} />
                      ))}
                    </>
                  )}
                </Stack>
              )}
            </Box>
          </Paper>
        )}
      </Box>

      {/* What one call in the log returned. The Evidence Agent's panel, on the
          Rollout Agent's calls -- the two share five of their tools, so the
          reader should not meet a different panel depending on which agent
          they happen to be reading. */}
      <AgentTraceDrawer
        open={Boolean(traceCall)}
        onClose={() => setTraceCall(null)}
        call={traceCall}
        cited={citedChunks}
        citedNodes={[]}
        citedEdges={[]}
      />
    </Box>
  );
}
