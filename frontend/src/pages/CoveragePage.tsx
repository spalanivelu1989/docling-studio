import {
  Alert, Box, Chip, CircularProgress, IconButton, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CircleAlert, CircleCheck, Database, FileText, HardDrive, Info, Network,
  RefreshCw, Search, TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type CoverageDocument, type CoverageIssueKind, type CoverageReport } from "../api";
import { clearAdornment } from "../components/ClearAdornment";

/** Worst first, and the wording says what the gap COSTS rather than naming a
 *  state. "Retrievable but invisible to traversal" is actionable; "not in
 *  graph" is a fact nobody can act on. */
const ISSUE: Record<CoverageIssueKind, { label: string; hue: "error" | "warning" | "info" }> = {
  file_missing: { label: "File gone", hue: "error" },
  not_indexed: { label: "Not retrievable", hue: "warning" },
  not_in_graph: { label: "Not in graph", hue: "warning" },
  shadowed: { label: "Shadowed by a twin", hue: "warning" },
  category_mismatch: { label: "Category disagreement", hue: "info" },
  no_original: { label: "No original", hue: "info" },
};

const ORDER: CoverageIssueKind[] = [
  "file_missing", "not_indexed", "not_in_graph", "shadowed",
  "category_mismatch", "no_original",
];

function StoreCard({ icon, label, count, blurb }: {
  icon: ReactNode; label: string; count: number; blurb: string;
}) {
  return (
    <Paper sx={{ p: 1.75, flex: 1, minWidth: 170 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
        <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {count.toLocaleString()}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>{blurb}</Typography>
    </Paper>
  );
}

export default function CoveragePage({ active }: { active: boolean }) {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<"issues" | "all">("issues");

  const load = useCallback(() => {
    setLoading(true);
    api.coverage(true)
      .then((r) => { setReport(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (active) load(); }, [active, load]);

  const rows = useMemo(() => {
    const all = report?.documents ?? [];
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return all
      .filter((d) => (only === "all" ? true : d.issues.length > 0))
      .filter((d) => {
        if (!words.length) return true;
        const hay = `${d.title} ${d.name} ${d.source} ${d.corpus_category ?? ""} ${d.graph_category ?? ""} ${d.issues.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        const rank = (d: CoverageDocument) =>
          d.issues.length ? Math.min(...d.issues.map((i) => ORDER.indexOf(i))) : 99;
        return rank(a) - rank(b) || a.title.localeCompare(b.title);
      });
  }, [report, filter, only]);

  const s = report?.summary;

  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Stack spacing={2.5} sx={{ maxWidth: 1280, mx: "auto", p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
              Coverage
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
              A document lives in up to three places and nothing keeps them in step:
              indexing does not rebuild the graph, and rebuilding the graph does not index.
              This is where they disagree.
            </Typography>
          </Box>
          <Tooltip title="Re-read all three">
            <span>
              <IconButton onClick={load} disabled={loading} aria-label="Refresh">
                {loading ? <CircularProgress size={16} /> : <RefreshCw size={16} />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        {report?.corpus_error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>Corpus: {report.corpus_error}</Alert>
        )}
        {report?.graph_error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>Graph: {report.graph_error}</Alert>
        )}

        {s && (
          <>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
              <StoreCard icon={<HardDrive size={14} />} label="On disk" count={s.on_disk}
                         blurb="Markdown in the scanned folders" />
              <StoreCard icon={<Database size={14} />} label="Corpus" count={s.indexed}
                         blurb="Retrievable and citable" />
              <StoreCard icon={<Network size={14} />} label="Graph" count={s.in_graph}
                         blurb="Reachable by traversal" />
              <StoreCard icon={<CircleCheck size={14} />} label="Agree" count={s.clean}
                         blurb={`of ${s.documents} documents, no gaps`} />
            </Stack>

            {/* The counts that matter, in severity order. A zero is worth
                showing: "nothing is missing" is the answer people come for. */}
            <Paper sx={{ p: 1.75 }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {ORDER.map((kind) => {
                  const n = s[kind];
                  const { label, hue } = ISSUE[kind];
                  return (
                    <Tooltip key={kind} title={report.help[kind]}>
                      <Chip
                        size="small"
                        icon={n === 0 ? <CircleCheck size={13} />
                              : hue === "error" ? <CircleAlert size={13} />
                              : hue === "warning" ? <TriangleAlert size={13} /> : <Info size={13} />}
                        label={`${label}: ${n}`}
                        onClick={() => { setOnly("issues"); setFilter(kind); }}
                        sx={{
                          height: 24, fontSize: 11.5, fontWeight: 650, cursor: "pointer",
                          bgcolor: (t) => alpha(n === 0 ? t.palette.success.main : t.palette[hue].main, 0.12),
                          color: n === 0 ? "success.main" : `${hue}.main`,
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Stack>
            </Paper>
          </>
        )}

        <Paper sx={{ overflow: "hidden" }}>
          <Stack direction="row" spacing={1.25} useFlexGap
                 sx={{ alignItems: "center", flexWrap: "wrap", px: 2, py: 1.25,
                       borderBottom: 1, borderColor: "divider" }}>
            <ToggleButtonGroup size="small" exclusive value={only}
                               onChange={(_, v) => v && setOnly(v)} sx={{ height: 30 }}>
              <ToggleButton value="issues" sx={{ fontSize: 12, px: 1.25 }}>Needs a look</ToggleButton>
              <ToggleButton value="all" sx={{ fontSize: 12, px: 1.25 }}>Every document</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              size="small" value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by title, path, category or issue…"
              sx={{ flex: 1, minWidth: 220, "& .MuiInputBase-root": { height: 30, fontSize: 12.5 } }}
              slotProps={{ input: {
                startAdornment: (<Box sx={{ pl: 0.25, pr: 0.75, display: "flex", color: "text.secondary" }}>
                  <Search size={14} /></Box>),
                endAdornment: clearAdornment(filter, () => setFilter(""), { label: "Clear filter" }),
              } }}
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {rows.length} shown
            </Typography>
          </Stack>

          {!loading && !rows.length && (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {only === "issues"
                  ? "Every document is in all three places, filed the same way, with an original to review it against."
                  : "Nothing matches that filter."}
              </Typography>
            </Box>
          )}

          {rows.length > 0 && (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ "& td, & th": { fontSize: 12, whiteSpace: "nowrap" } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Document</TableCell>
                    <TableCell align="center">Disk</TableCell>
                    <TableCell align="center">Corpus</TableCell>
                    <TableCell align="center">Graph</TableCell>
                    <TableCell align="right">Chunks</TableCell>
                    <TableCell>Findings</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.source} hover>
                      <TableCell sx={{ maxWidth: 380 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden",
                                          textOverflow: "ellipsis" }}>
                          {d.title}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: "text.disabled", overflow: "hidden",
                                          textOverflow: "ellipsis" }}>
                          {d.source}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">{d.on_disk ? "✓" : "—"}</TableCell>
                      <TableCell align="center">
                        {d.indexed ? (d.corpus_category ?? "✓") : "—"}
                      </TableCell>
                      <TableCell align="center">
                        {d.in_graph ? (d.graph_category ?? "✓") : "—"}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {d.chunks?.toLocaleString() ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                          {d.issues.length === 0 && (
                            <Typography sx={{ fontSize: 11, color: "success.main" }}>agrees</Typography>
                          )}
                          {d.issues.map((k) => (
                            <Tooltip key={k} title={report?.help[k] ?? ""}>
                              <Chip size="small" label={ISSUE[k].label}
                                    sx={{ height: 18, fontSize: 10, fontWeight: 700,
                                          bgcolor: (t) => alpha(t.palette[ISSUE[k].hue].main, 0.14),
                                          color: `${ISSUE[k].hue}.main` }} />
                            </Tooltip>
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>

        <Typography variant="caption" sx={{ color: "text.disabled" }}>
          <FileText size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          Read-only. Every gap here has a fix that is a decision, not a repair: indexing a
          file changes what the agents can retrieve, and re-tagging one changes what a scoped
          run is allowed to read.
        </Typography>
      </Stack>
    </Box>
  );
}
