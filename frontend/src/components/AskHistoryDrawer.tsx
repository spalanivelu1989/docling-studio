import {
  Alert, Box, Button, Chip, CircularProgress, Drawer, IconButton, Stack, TextField,
  Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { History, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { askHistory, type AskRunSummary } from "../api";
import { clearAdornment } from "./ClearAdornment";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Relative time, the same wording the Evidence Agent's history uses. */
function when(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return plural(mins, "minute") + " ago";
  const hours = Math.round(mins / 60);
  if (hours < 24) return plural(hours, "hour") + " ago";
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const STATUS_COLOR: Record<AskRunSummary["status"], "default" | "success" | "warning" | "error"> = {
  done: "success",
  running: "default",
  abandoned: "warning",
  failed: "error",
};

export default function AskHistoryDrawer({
  open,
  onClose,
  onOpenRun,
  onAskAgain,
  reloadKey,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  /** Reopen a past question: its answer and its excerpts, as they were. */
  onOpenRun: (id: string) => void;
  /** Put the question back in the box so it can be asked against today's corpus. */
  onAskAgain: (question: string) => void;
  /** Bumped when a question finishes, so the panel is not stale when reopened. */
  reloadKey: number;
  busy: boolean;
}) {
  const theme = useTheme();
  const [runs, setRuns] = useState<AskRunSummary[]>([]);
  const [retention, setRetention] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // Debounced, so typing in the filter does not fire a query per keystroke.
    const t = setTimeout(() => {
      askHistory
        .runs(50, search)
        .then((r) => {
          if (cancelled) return;
          setRuns(r.runs);
          setRetention(r.retention);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search, reloadKey]);

  const remove = async (id: string) => {
    setRuns((rs) => rs.filter((r) => r.id !== id));
    try {
      await askHistory.deleteRun(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" } },
        paper: {
          sx: {
            width: { xs: "100%", sm: 480, md: 540 },
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
      {/* ---------- header ---------- */}
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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
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
            <History size={18} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
              Previous questions
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {loading && !runs.length
                ? "Loading…"
                : runs.length
                  ? `${plural(runs.length, "question")}${retention ? ` · newest ${retention} kept` : ""}`
                  : "Nothing asked yet"}
            </Typography>
          </Box>
          {loading && runs.length > 0 && <CircularProgress size={14} />}
          <IconButton size="small" onClick={onClose} aria-label="Close history">
            <X size={16} />
          </IconButton>
        </Stack>

        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by question text…"
          slotProps={{
            input: {
              endAdornment: clearAdornment(search, () => setSearch(""), { label: "Clear filter" }),
              sx: { fontSize: 13, borderRadius: 1.75 },
            },
          }}
        />
      </Box>

      {/* ---------- list ---------- */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {error && (
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !runs.length && !error && (
          <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
            {search
              ? "No past question matches that text."
              : "Questions are recorded as they are asked. Ask one and it will appear here."}
          </Typography>
        )}

        <Stack spacing={1.25}>
          {runs.map((r) => (
            <Box
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenRun(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenRun(r.id);
                }
              }}
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
                cursor: "pointer",
                transition: "border-color .15s ease, background-color .15s ease",
                "&:hover, &:focus-visible": {
                  borderColor: (t) => alpha(t.palette.primary.main, 0.5),
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
                },
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 650, lineHeight: 1.45 }}>
                  {r.question}
                </Typography>
                <Tooltip title="Delete this question">
                  <IconButton
                    size="small"
                    aria-label="Delete this question"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(r.id);
                    }}
                    sx={{ mt: -0.25, color: "text.disabled", "&:hover": { color: "error.main" } }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </Tooltip>
              </Stack>

              {r.summary && (
                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.75,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "text.secondary",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {r.summary.replace(/^#+\s*/gm, "").replace(/\*\*/g, "")}
                </Typography>
              )}

              {r.error && (
                <Typography variant="caption" sx={{ color: "error.main", fontSize: 11 }}>
                  {r.error}
                </Typography>
              )}

              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
              >
                {r.status !== "done" && (
                  <Chip
                    size="small"
                    color={STATUS_COLOR[r.status]}
                    label={r.status}
                    sx={{ height: 18, fontSize: 10, fontWeight: 700, borderRadius: 1 }}
                  />
                )}
                <Typography variant="caption" sx={{ fontSize: 11, color: "text.disabled" }}>
                  {when(r.started_at)}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                  · {r.mode} · {plural(r.sources, "excerpt")}
                  {r.seconds ? ` · ${r.seconds}s` : ""}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="text"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAgain(r.question);
                  }}
                  sx={{ fontSize: 11, fontWeight: 650, textTransform: "none", minWidth: 0, px: 0.75 }}
                >
                  Ask again
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    </Drawer>
  );
}
