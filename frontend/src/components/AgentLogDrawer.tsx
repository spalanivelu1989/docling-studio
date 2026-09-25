/** The console: one investigation as a sequence, in the order it happened.
 *
 *  The page already shows WHAT an investigation did -- the calls, their
 *  traces, the memory it started from, the answer. What it never showed is the
 *  run as a story: the context the agent was actually handed (question, scope
 *  note and a page of recalled notes, not the sentence that was typed), the
 *  reasoning between one call and the next, the moment the budget ran out, a
 *  submission that was rejected and re-made. All of that existed only for
 *  whoever happened to be watching the stream.
 *
 *  Reading, not debugging: every line says what happened in a sentence, and
 *  the raw material sits behind a disclosure. A tool call opens the same trace
 *  drawer the log panel opens, because two ways to see one call is one too
 *  many to keep in step.
 */
import {
  Box, Chip, Drawer, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { Brain, ChevronDown, ChevronRight, CircleAlert, Copy, Download, FileText, GitBranch, Globe, MessageSquare, Network, ScanLine, Sigma, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { EvidenceLogEntry } from "../api";
import { surface } from "../theme";

/** What each kind looks like and what it is called. One table, so a new kind
 *  cannot be added to the backend and styled in four places here. */
const KIND: Record<string, { label: string; hue: (t: Theme) => string; icon: ReactNode }> = {
  question:  { label: "QUESTION", hue: (t) => t.palette.primary.main,   icon: <MessageSquare size={12} /> },
  memory:    { label: "MEMORY",   hue: (t) => t.palette.secondary.main, icon: <Brain size={12} /> },
  note:      { label: "NOTE",     hue: (t) => t.palette.text.secondary, icon: <FileText size={12} /> },
  thinking:  { label: "THINKING", hue: (t) => t.palette.info.main,      icon: <Sigma size={12} /> },
  tool_call: { label: "TOOL",     hue: (t) => t.palette.success.main,   icon: <ScanLine size={12} /> },
  answer:    { label: "ANSWER",   hue: (t) => t.palette.success.main,   icon: <FileText size={12} /> },
  error:     { label: "ERROR",    hue: (t) => t.palette.error.main,     icon: <CircleAlert size={12} /> },
};

const ENGINE_ICON: Record<string, ReactElement> = {
  rag: <ScanLine size={11} />, graph: <Network size={11} />,
  bpml: <GitBranch size={11} />, session: <FileText size={11} />,
  web: <Globe size={11} />,
};

/** Groups for the filter strip. Deliberately coarse: the point of a filter
 *  here is "hide the wall of reasoning", not a query language. */
const FILTERS = [
  { key: "all", label: "Everything", kinds: null as string[] | null },
  { key: "steps", label: "Steps only", kinds: ["question", "memory", "tool_call", "answer", "error"] },
  { key: "thinking", label: "Reasoning", kinds: ["thinking", "note"] },
];

function clock(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toTimeString().slice(0, 8);
}

/** Seconds since the run's first line — the number that actually says where
 *  the time went. A wall clock alone makes the reader do subtraction. */
function elapsed(at: string, from: string): string {
  const d = new Date(at).getTime() - new Date(from).getTime();
  if (!Number.isFinite(d) || d < 0) return "";
  return d < 1000 ? `+${d}ms` : `+${(d / 1000).toFixed(1)}s`;
}

function headline(e: EvidenceLogEntry): string {
  switch (e.kind) {
    case "question":
      return e.text ?? "";
    case "memory":
      return e.suppressed_by_holdout
        ? "Memory was requested but not read — this is a holdout run"
        : e.used
        ? `${e.recalled ?? 0} note(s) recalled from earlier investigations`
        : "Memory off — the agent started from the corpus";
    case "note":
      return e.title ?? e.note ?? "";
    case "thinking":
      return (e.text ?? "").split("\n")[0];
    case "tool_call":
      return `${e.tool} — ${e.summary ?? ""}`;
    case "answer":
      return e.title ?? `${e.state} · ${e.claims ?? 0} claim(s)`;
    case "error":
      return e.text ?? "";
    default:
      return "";
  }
}

/** The whole body of an entry, when it has one worth expanding into. */
function body(e: EvidenceLogEntry): string {
  if (e.kind === "memory") return (e.memories ?? []).map((m, i) => `${i + 1}. ${m}`).join("\n\n");
  if (e.kind === "tool_call") return JSON.stringify(e.arguments ?? {}, null, 2);
  // The Fit-Gap Copilot's opening line and final line carry the run's
  // particulars -- what was attached, what it cost -- beside the sentence.
  if ((e.kind === "question" || e.kind === "answer") && e.detail && Object.keys(e.detail).length) {
    return [e.text ?? "", JSON.stringify(e.detail, null, 2)].filter(Boolean).join("\n\n");
  }
  return e.text ?? "";
}

/** Whether the headline already showed everything there is. */
function hasMore(e: EvidenceLogEntry): boolean {
  const full = body(e);
  if (!full) return false;
  if (e.kind === "tool_call") return full !== "{}";
  return full.trim() !== headline(e).trim();
}

function Line({ entry, first, onOpenCall }: {
  entry: EvidenceLogEntry;
  first: string;
  onOpenCall?: (call: number) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const kind = KIND[entry.kind] ?? KIND.note;
  const hue = kind.hue(theme);
  const more = hasMore(entry);
  const failed = !!entry.error;

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider",
               bgcolor: failed ? alpha(theme.palette.error.main, 0.06) : "transparent",
               "&:hover": { bgcolor: surface(theme, 0.5) } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", px: 1.5, py: 0.85,
                                               cursor: more ? "pointer" : "default" }}
             onClick={() => more && setOpen((o) => !o)}>
        <Box sx={{ width: 12, pt: 0.2, color: "text.disabled", flex: "none" }}>
          {more ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </Box>
        <Typography sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5,
                          color: "text.disabled", flex: "none", pt: 0.2, width: 58 }}>
          {clock(entry.at)}
        </Typography>
        <Typography sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10,
                          color: "text.disabled", flex: "none", pt: 0.2, width: 46,
                          textAlign: "right" }}>
          {elapsed(entry.at, first)}
        </Typography>
        <Stack direction="row" spacing={0.4} sx={{ alignItems: "center", flex: "none",
                                                   width: 86, color: hue, pt: 0.1 }}>
          {kind.icon}
          <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em" }}>
            {kind.label}
          </Typography>
        </Stack>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 12.5, lineHeight: 1.5,
                            whiteSpace: open ? "normal" : "nowrap",
                            overflow: "hidden", textOverflow: "ellipsis" }}>
            {headline(entry)}
          </Typography>
          {entry.warning && (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.3 }}>
              <TriangleAlert size={11} color={theme.palette.warning.main} />
              <Typography sx={{ fontSize: 11, color: "warning.main" }}>{entry.warning}</Typography>
            </Stack>
          )}
        </Box>
        {entry.stage && (
          <Tooltip title={entry.stage === "asis" ? "Pass 1: reading the subject" : "Pass 2: comparing with the Global Template"}>
            <Chip size="small" label={entry.stage === "asis" ? "pass 1" : entry.stage === "compare" ? "pass 2" : entry.stage}
                  sx={{ height: 17, fontSize: 9.5, flex: "none" }} />
          </Tooltip>
        )}
        {entry.engine && (
          <Tooltip title={`Answered by the ${entry.engine} engine`}>
            <Chip size="small" variant="outlined" icon={ENGINE_ICON[entry.engine] ?? undefined}
                  label={entry.engine}
                  sx={{ height: 17, fontSize: 9.5, flex: "none",
                        "& .MuiChip-icon": { ml: 0.4 } }} />
          </Tooltip>
        )}
        {entry.ms != null && (
          <Typography sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10,
                            color: "text.disabled", flex: "none", width: 52, textAlign: "right" }}>
            {entry.ms}ms
          </Typography>
        )}
        {entry.kind === "tool_call" && (entry.call ?? -1) >= 0 && onOpenCall && (
          <Tooltip title="Open the evidence this call returned">
            <IconButton size="small" sx={{ p: 0.25, flex: "none" }}
                        onClick={(ev) => { ev.stopPropagation(); onOpenCall(entry.call!); }}>
              <ScanLine size={13} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {open && more && (
        <Box component="pre" sx={{ m: 0, mx: 1.5, mb: 1.25, ml: 12, p: 1.25, borderRadius: 1.5,
                                   border: 1, borderColor: "divider", bgcolor: surface(theme, 0.6),
                                   font: "11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
                                   whiteSpace: "pre-wrap", wordBreak: "break-word",
                                   maxHeight: 360, overflow: "auto" }}>
          {body(entry)}
        </Box>
      )}
    </Box>
  );
}

export default function AgentLogDrawer({ open, onClose, log, running, onOpenCall }: {
  open: boolean;
  onClose: () => void;
  log: EvidenceLogEntry[];
  running: boolean;
  onOpenCall?: (call: number) => void;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useState("all");
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
    return kinds ? log.filter((e) => kinds.includes(e.kind)) : log;
  }, [log, filter]);

  // Follow the tail while it is live, but stop the moment the reader scrolls
  // up: yanking somebody back to the bottom while they are reading a reasoning
  // block is how a live console becomes unusable.
  useEffect(() => {
    if (open && running && follow) bottom.current?.scrollIntoView({ block: "end" });
  }, [open, running, follow, shown.length]);

  const first = log[0]?.at ?? "";
  const asText = () => log.map((e) => {
    const head = `[${clock(e.at)}] ${(KIND[e.kind] ?? KIND.note).label.padEnd(8)} ${headline(e)}`;
    const rest = hasMore(e) ? `\n${body(e).split("\n").map((l) => `         ${l}`).join("\n")}` : "";
    return head + rest;
  }).join("\n");

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
            slotProps={{ paper: { sx: { width: { xs: "100%", md: "76vw", lg: 1080 },
                                        maxWidth: "100%" } } }}>
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" spacing={1.25} useFlexGap
               sx={{ alignItems: "center", flexWrap: "wrap", px: 2, py: 1.25,
                     borderBottom: 1, borderColor: "divider", flex: "none" }}>
          <Typography variant="overline" sx={{ lineHeight: 1, color: "text.secondary" }}>
            Investigation log
          </Typography>
          <Chip size="small" label={`${log.length} step${log.length === 1 ? "" : "s"}`}
                sx={{ height: 19, fontSize: 10.5, fontWeight: 700 }} />
          {running && (
            <Chip size="small" color="info" variant="outlined" label="live"
                  sx={{ height: 19, fontSize: 10.5, fontWeight: 700 }} />
          )}
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup size="small" exclusive value={filter} sx={{ height: 26 }}
                             onChange={(_, v) => v && setFilter(v)}>
            {FILTERS.map((f) => (
              <ToggleButton key={f.key} value={f.key} sx={{ fontSize: 11, px: 1.1 }}>
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {running && (
            <Tooltip title={follow ? "Following the newest line" : "Scrolling is yours"}>
              <ToggleButton size="small" value="follow" selected={follow}
                            onChange={() => setFollow((f) => !f)}
                            sx={{ fontSize: 11, px: 1.1, height: 26 }}>
                follow
              </ToggleButton>
            </Tooltip>
          )}
          <Tooltip title={copied ? "Copied" : "Copy the whole log as text"}>
            <IconButton size="small" onClick={async () => {
              await navigator.clipboard.writeText(asText());
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}><Copy size={15} /></IconButton>
          </Tooltip>
          <Tooltip title="Download as a .txt file">
            <IconButton size="small" onClick={() => {
              const url = URL.createObjectURL(new Blob([asText()], { type: "text/plain" }));
              const a = document.createElement("a");
              a.href = url; a.download = "investigation-log.txt"; a.click();
              URL.revokeObjectURL(url);
            }}><Download size={15} /></IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} aria-label="Close"><X size={16} /></IconButton>
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto",
                   bgcolor: alpha(theme.palette.background.default, 0.6) }}>
          {shown.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                {log.length === 0
                  ? "Nothing here yet. Ask a question and every step appears as it happens — "
                    + "the context the agent is handed, what it reasons, every engine it queries, "
                    + "and what it writes back."
                  : "Nothing of that kind in this run."}
              </Typography>
            </Box>
          ) : (
            <>
              {shown.map((e) => (
                <Line key={e.seq} entry={e} first={first} onOpenCall={onOpenCall} />
              ))}
              <div ref={bottom} />
            </>
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}
