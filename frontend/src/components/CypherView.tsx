/** Cypher — query the knowledge graph the way Neo4j is queried.
 *
 *  The graph is loaded into a local Neo4j (kg_neo4j_load.py) and queried there,
 *  so this is real Cypher, not an imitation of it. Queries run read-only: Neo4j
 *  refuses a write inside the READ transaction the server opens, and rows and
 *  time are capped. Node values keep the graph's own ids, so a node in a result
 *  can be opened on the canvas; Neo4j Browser is one click away for the visual
 *  exploration it does better than a table. */
import {
  Alert, Box, Button, ButtonBase, Chip, CircularProgress, Dialog, MenuItem, Select, Stack, TextField, Tooltip, Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Database, ExternalLink, Maximize2, Minimize2, Play, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api, type CypherResult, type GeneratedCypher, type Neo4jStatus } from "../api";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

type Obj = Record<string, unknown>;

/** A node, relationship, path, list or scalar from a result row. */
function Cell({ v, onFocusNode }: { v: unknown; onFocusNode?: (id: string) => void }): ReactNode {
  if (v === null || v === undefined) return <Box component="span" sx={{ color: "text.disabled" }}>null</Box>;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object" || x === null)) {
      return <Box component="span">{v.map((x) => String(x)).join(", ")}</Box>;
    }
    return <Stack spacing={0.25}>{v.map((x, i) => <Cell key={i} v={x} onFocusNode={onFocusNode} />)}</Stack>;
  }
  if (typeof v === "object") {
    const o = v as Obj;
    if (o._kind === "node") {
      const label = String(o.label ?? o.code ?? o.ticket ?? o.chunk_key ?? o.id ?? "");
      const id = typeof o.id === "string" ? o.id : "";
      const canFocus = id && !id.startsWith("chunk:") && onFocusNode;
      return (
        <Tooltip title={<pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(o, null, 1)}</pre>}>
          <Chip size="small" variant="outlined" clickable={!!canFocus}
                onClick={canFocus ? () => onFocusNode!(id) : undefined}
                label={`(:${(o._labels as string[] | undefined)?.join(":") ?? ""}) ${label}`}
                sx={{ fontSize: 11.5, maxWidth: 360 }} />
        </Tooltip>
      );
    }
    if (o._kind === "relationship") {
      return (
        <Tooltip title={<pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(o, null, 1)}</pre>}>
          <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>[:{String(o._type)}]</Box>
        </Tooltip>
      );
    }
    if (o._kind === "path") {
      const nodes = (o.nodes as Obj[]) ?? [];
      const rels = (o.relationships as Obj[]) ?? [];
      return (
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          {nodes.map((n, i) => (
            <Box key={i} sx={{ display: "contents" }}>
              <Cell v={n} onFocusNode={onFocusNode} />
              {i < rels.length && <Cell v={rels[i]} />}
            </Box>
          ))}
        </Stack>
      );
    }
    return <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>{JSON.stringify(o)}</Box>;
  }
  return <Box component="span">{String(v)}</Box>;
}

function csv(result: CypherResult): string {
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      const o = v as Obj;
      if (!Array.isArray(v) && o._kind === "node") return String(o.id ?? "");
      return JSON.stringify(v);
    }
    return String(v);
  };
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [result.columns.map(q).join(","), ...result.rows.map((r) => r.map((v) => q(text(v))).join(","))].join("\n");
}

/** The result of one query: a header with the counts and actions, and a table
 *  that scrolls both ways inside whatever height it is given, its header row
 *  pinned. Used in the page and, full-screen, in the expanded view. */
function ResultPanel({ result, onFocusNode, onExpand }: {
  result: CypherResult;
  onFocusNode?: (id: string) => void;
  onExpand?: () => void;
}) {
  const theme = useTheme();
  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column",
               border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.paper" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1.5, py: 0.75, borderBottom: 1, borderColor: "divider",
                                               bgcolor: alpha(theme.palette.text.primary, 0.03), flexShrink: 0 }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          {result.rows.length} row{result.rows.length === 1 ? "" : "s"}{result.truncated ? ` (stopped at ${result.limit})` : ""} · {result.ms} ms
        </Typography>
        <Box sx={{ flex: 1 }} />
        {result.rows.length > 0 && (
          <Button size="small" sx={{ textTransform: "none", fontSize: 12 }}
                  href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(result))}`} download="cypher-result.csv">
            Download CSV
          </Button>
        )}
        {onExpand && result.rows.length > 0 && (
          <Button size="small" startIcon={<Maximize2 size={13} />} onClick={onExpand}
                  sx={{ textTransform: "none", fontSize: 12 }}>
            Expand
          </Button>
        )}
      </Stack>
      {result.notifications.length > 0 && (
        <Alert severity="info" sx={{ borderRadius: 0, fontSize: 12, flexShrink: 0 }}>{result.notifications.join(" · ")}</Alert>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }} tabIndex={0} aria-label="Query results">
        <Box component="table" sx={{ minWidth: "100%", borderCollapse: "collapse", fontSize: 12.5,
                                     "& th, & td": { textAlign: "left", verticalAlign: "top", px: 1.5, py: 0.75,
                                                    borderBottom: 1, borderColor: "divider" },
                                     "& td": { maxWidth: 520, wordBreak: "break-word" },
                                     "& th": { position: "sticky", top: 0, zIndex: 1, bgcolor: "background.paper",
                                               fontFamily: MONO, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" } }}>
          <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j}><Cell v={v} onFocusNode={onFocusNode} /></td>)}</tr>
            ))}
          </tbody>
        </Box>
        {result.rows.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", p: 1.5 }}>No rows.</Typography>
        )}
      </Box>
    </Box>
  );
}

export default function CypherView({ onFocusNode }: { onFocusNode?: (id: string) => void }) {
  const theme = useTheme();
  const [status, setStatus] = useState<Neo4jStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(200);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<CypherResult | null>(null);
  const [error, setError] = useState("");
  // Plain English -> Cypher (kg_nl2cypher.py). The generated query lands in
  // the editor, so what runs is always what the reader can see and change.
  const [question, setQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCypher | null>(null);
  const [genError, setGenError] = useState("");
  const [expanded, setExpanded] = useState(false);
  // Results arrive below the question, the explanation and the editor, often
  // below the fold; bring them into view rather than leave the reader to find
  // them.
  const resultRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  const refresh = useCallback(() => {
    api.neo4jStatus()
      .then((s) => {
        setStatus(s); setStatusError("");
        setQuery((q) => q || s.examples[0]?.query || "");
      })
      .catch((e) => setStatusError((e as Error).message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q) return;
    setRunning(true); setError("");
    try {
      setResult(await api.cypher(q, limit));
    } catch (e) {
      setResult(null); setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [query, limit]);

  const generate = async (text?: string) => {
    const q = (text ?? question).trim();
    if (q.length < 3) return;
    setGenerating(true); setGenError(""); setGenerated(null);
    try {
      const g = await api.generateCypher(q);
      setGenerated(g);
      if (g.cypher) setQuery(g.cypher);
      if (g.valid && g.answerable && g.cypher) void run(g.cypher);
      else setResult(null);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try { await api.neo4jSync(true); } catch (e) { setStatusError((e as Error).message); }
    setSyncing(false);
    refresh();
  };

  const browserUrl = status ? `${status.browser}?cmd=edit&arg=${encodeURIComponent(query)}` : "";
  const ready = !!status?.reachable && !!status.loaded;

  return (
    <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", p: 2, gap: 1.5, overflow: "auto",
                 // Nothing in the column may be squeezed below its own height:
                 // a squeezed box with hidden overflow clips its rows out of
                 // reach, which is how the results table stopped scrolling.
                 "& > *": { flexShrink: 0 } }}>
        {/* where the query runs, and whether it is the current graph */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Database size={15} color={theme.palette.text.secondary} />
          {!status && !statusError && <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Checking Neo4j…</Typography>}
          {status && status.reachable && status.loaded && (
            <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
              Neo4j at <code>{status.uri}</code> · {status.loaded.nodes.toLocaleString()} nodes,{" "}
              {status.loaded.relationships.toLocaleString()} relationships · loaded {status.loaded.loaded_at.slice(0, 16).replace("T", " ")}
            </Typography>
          )}
          {status?.reachable && status.loaded && (
            <Chip size="small" variant="outlined" color={status.current ? "success" : "warning"}
                  label={status.current ? "current build" : "older build — reload"} sx={{ height: 20, fontSize: 11 }} />
          )}
          <Box sx={{ flex: 1 }} />
          {status?.reachable && (
            <Tooltip title="Replace Neo4j's copy with the current knowledge graph">
              <span>
                <Button size="small" variant="outlined" disabled={syncing}
                        startIcon={syncing ? <CircularProgress size={12} /> : <RefreshCw size={13} />}
                        onClick={() => void sync()} sx={{ textTransform: "none" }}>
                  {status.loaded ? "Reload into Neo4j" : "Load into Neo4j"}
                </Button>
              </span>
            </Tooltip>
          )}
          {status?.reachable && (
            <Button size="small" variant="outlined" startIcon={<ExternalLink size={13} />}
                    href={browserUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
              Open in Neo4j Browser
            </Button>
          )}
        </Stack>
        {(statusError || (status && (!status.reachable || !status.loaded))) && (
          <Alert severity="warning" sx={{ fontSize: 12.5 }}>
            {statusError || status?.detail}
          </Alert>
        )}

        {/* ask in English; Claude writes the query */}
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5,
                   bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <TextField
              fullWidth size="small" multiline maxRows={4} value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void generate(); }
              }}
              placeholder="Ask in plain English — e.g. Which documents mention both SOVOS and SAP CPI, and in which passages?"
              slotProps={{ htmlInput: { "aria-label": "Question in plain English" } }}
              sx={{ "& textarea": { fontSize: 13.5 } }}
            />
            <Button variant="contained" size="small" disabled={!ready || generating || question.trim().length < 3}
                    startIcon={generating ? <CircularProgress size={12} color="inherit" /> : <Sparkles size={13} />}
                    onClick={() => void generate()} sx={{ textTransform: "none", whiteSpace: "nowrap", height: 36, flexShrink: 0, px: 2 }}>
              {generating ? "Writing…" : "Generate Cypher"}
            </Button>
          </Stack>
          {genError && <Alert severity="error" sx={{ mt: 1, fontSize: 12.5 }}>{genError}</Alert>}
          {generated && (
            <Box sx={{ mt: 1 }}>
              {!generated.answerable ? (
                <Alert severity="info" sx={{ fontSize: 12.5 }}>{generated.explanation}</Alert>
              ) : (
                <>
                  <Typography sx={{ fontSize: 13 }}>{generated.explanation}</Typography>
                  {generated.assumptions.length > 0 && (
                    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                      {generated.assumptions.map((a, i) => (
                        <Typography component="li" key={i} sx={{ fontSize: 12, color: "text.secondary" }}>{a}</Typography>
                      ))}
                    </Box>
                  )}
                  {!generated.valid && (
                    <Alert severity="warning" sx={{ mt: 0.75, fontSize: 12.5 }}>
                      Neo4j still rejects this query after {generated.attempts} attempt(s): {generated.error}. It is in the editor to fix by hand.
                    </Alert>
                  )}
                </>
              )}
              <Typography sx={{ fontSize: 11, color: "text.disabled", mt: 0.5 }}>
                {generated.seconds} s
                {generated.corrections.length > 0 ? ` · corrected ${generated.corrections.length}× after Neo4j rejected a draft` : ""}
              </Typography>
            </Box>
          )}
        </Box>

        <TextField
          multiline minRows={5} maxRows={16} fullWidth value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void run(); }
          }}
          placeholder="MATCH (s:System)<-[:MENTIONS_SYSTEM]-(d:Document) RETURN s.label, count(d)"
          slotProps={{ htmlInput: { spellCheck: false, "aria-label": "Cypher query" } }}
          sx={{ "& textarea": { fontFamily: MONO, fontSize: 13, lineHeight: 1.55 } }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button variant="contained" size="small" disabled={!ready || running || !query.trim()}
                  startIcon={running ? <CircularProgress size={12} color="inherit" /> : <Play size={13} />}
                  onClick={() => void run()} sx={{ textTransform: "none" }}>
            Run
          </Button>
          <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>⌘/Ctrl + Enter</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Rows</Typography>
          <Select size="small" value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                  sx={{ fontSize: 12, height: 28 }}>
            {[50, 200, 1000].map((n) => <MenuItem key={n} value={n} sx={{ fontSize: 12 }}>{n}</MenuItem>)}
          </Select>
        </Stack>
        <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>
          Read-only: Neo4j refuses writes here. At most {status?.max_rows ?? 1000} rows; a query is stopped after{" "}
          {status?.timeout ?? 20} s.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ fontSize: 12.5, "& .MuiAlert-message": { whiteSpace: "pre-wrap", fontFamily: MONO } }}>
            {error}
          </Alert>
        )}

        {result && (
          // Fills whatever height is left and scrolls inside itself; the
          // column scrolls instead when there is too little room left for it.
          <Box ref={resultRef} sx={{ flex: "1 0 auto", height: "max(320px, 60vh)", display: "flex", scrollMarginTop: 8 }}>
            <ResultPanel result={result} onFocusNode={onFocusNode} onExpand={() => setExpanded(true)} />
          </Box>
        )}
        <Dialog open={expanded && !!result} onClose={() => setExpanded(false)} fullScreen>
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 2, gap: 1.5, bgcolor: "background.default" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
              <Typography component="pre" sx={{ flex: 1, m: 0, fontFamily: MONO, fontSize: 12, color: "text.secondary",
                                                 whiteSpace: "pre-wrap", maxHeight: 96, overflow: "auto" }}>
                {query}
              </Typography>
              <Button size="small" variant="outlined" startIcon={<Minimize2 size={13} />}
                      onClick={() => setExpanded(false)} sx={{ textTransform: "none", flexShrink: 0 }}>
                Close (Esc)
              </Button>
            </Stack>
            {result && (
              <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                <ResultPanel result={result} onFocusNode={(id) => { setExpanded(false); onFocusNode?.(id); }} />
              </Box>
            )}
          </Box>
        </Dialog>
      </Box>

      {/* examples: the model's patterns, each one known to return rows */}
      <Box sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: "divider", p: 2, overflowY: "auto",
                 display: { xs: "none", md: "block" } }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "text.secondary", mb: 0.5 }}>
          ASK IN ENGLISH
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.disabled", mb: 1 }}>
          Click one to have Claude write the query.
        </Typography>
        <Stack spacing={0.5} sx={{ mb: 2.5 }}>
          {(status?.questions ?? []).map((g, gi) => (
            <Box key={g.group} component="details" open={gi === 0}
                 sx={{ border: 1, borderColor: "divider", borderRadius: 1,
                       "& > summary": { cursor: "pointer", listStyle: "none", px: 1, py: 0.75, fontSize: 12.5, fontWeight: 600,
                                        display: "flex", justifyContent: "space-between" },
                       "& > summary::-webkit-details-marker": { display: "none" },
                       "&[open] > summary": { borderBottom: 1, borderColor: "divider" } }}>
              <Box component="summary">
                <span>{g.group}</span>
                <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>{g.questions.length}</Box>
              </Box>
              <Stack sx={{ py: 0.5 }}>
                {g.questions.map((q) => (
                  <ButtonBase key={q} disabled={!ready || generating}
                              onClick={() => { setQuestion(q); void generate(q); }}
                              sx={{ display: "block", textAlign: "left", px: 1, py: 0.6, fontSize: 12.5, lineHeight: 1.4,
                                    color: "text.primary", borderRadius: 0.5,
                                    "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.06), color: "primary.main" } }}>
                    <Sparkles size={11} style={{ marginRight: 6, verticalAlign: "-1px", opacity: 0.6 }} />{q}
                  </ButtonBase>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>

        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "text.secondary", mb: 1 }}>
          CYPHER EXAMPLES
        </Typography>
        <Stack spacing={0.75}>
          {(status?.examples ?? []).map((ex) => (
            <ButtonBase key={ex.title} onClick={() => { setQuery(ex.query); void run(ex.query); }} disabled={!ready}
                        sx={{ display: "block", textAlign: "left", p: 1, borderRadius: 1, border: 1, borderColor: "divider",
                              "&:hover": { borderColor: "primary.main" } }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{ex.title}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 10.5, color: "text.secondary", mt: 0.25,
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {ex.query}
              </Typography>
            </ButtonBase>
          ))}
        </Stack>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "text.secondary", mt: 2.5, mb: 0.75 }}>
          THE MODEL
        </Typography>
        <Typography component="pre" sx={{ fontFamily: MONO, fontSize: 10.5, color: "text.secondary", m: 0, whiteSpace: "pre-wrap" }}>
{`(:Document)-[:BELONGS_TO]->(:Stream)
(:Document)-[:MENTIONS_SYSTEM]->(:System)
(:Document)-[:SPECIFIES_PROCESS]->(:Process)
(:Document)-[:IMPLEMENTS_TICKET|REFERENCES_TICKET]->(:Spec)
(:Process)-[:SUBPROCESS_OF]->(:Process)
(:Document)-[:HAS_CHUNK]->(:Chunk)
(:Chunk)-[:MENTIONS]->(:System|Process|Stream|Spec)

Every node has the graph's own id.
Document links carry method, mentions,
chunk_count and chunks.`}
        </Typography>
      </Box>
    </Box>
  );
}
