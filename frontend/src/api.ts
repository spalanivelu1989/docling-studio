// Types and calls for the FastAPI endpoints in app.py.

export interface Upload {
  id: string;
  filename: string;
  format: string;
  size: number;
  pages: number;
  warning: string | null;
}

export interface Conversion {
  markdown: string;
  vlm_notice: string | null;
  pages: number;
  unit?: string;
  pictures: number;
  skipped_images: number;
  vlm_images: number;
  flows: number;
  flow_images: number;
  table_images: number;
  cv_flow_images: number;
  elapsed: number;
  ocr: { page: number; image: string; confidence: number; chars: number }[];
}

export interface EmbedResult {
  status: "added" | "updated" | "unchanged";
  title: string;
  chunks: number;
  tokens: number;
  duplicates: string[];
  documents: number;
  total_chunks: number;
  seconds: number;
  file: string;
}

/** A corpus a document can be filed in. One table holds them all and a
 *  category is a column of it, so `documents` and `chunks` are how much of the
 *  corpus this category accounts for. */
export interface CategoryInfo {
  code: string;
  label: string;
  description: string;
  folder: string;
  documents: number;
  chunks: number;
}

export interface RagStatus {
  missing: string[];
  embed_model: string;
  embed_provider?: string;
  embed_dimension?: number;
  answer_model: string;
  default_k: number;
  documents: number;
  chunks: number;
  categories: CategoryInfo[];
  /** Where a document may be filed. Wider than `categories`, which lists only
   *  what there is to search: a category holding nothing is still a valid
   *  destination, it just cannot be a filter yet. */
  ingest_categories?: CategoryInfo[];
  error: string | null;
}

export type StepKey = "embed" | "vector" | "keyword" | "fuse" | "answer";
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StageEvent {
  key: StepKey;
  status: StepStatus;
  detail: string;
  ms?: number;
  terms?: string[];
}

export interface Source {
  n: number;
  title: string;
  section: string;
  content: string;
  category: string;
  score: number;
  similarity: number | null;
  bm25: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  file?: string;
  source_path?: string;
}

export interface Done {
  seconds: number;
  input_tokens: number;
  output_tokens: number;
}

export type SearchMode = "hybrid" | "vector" | "keyword";

/** `?categories=PKG&categories=DR`, or nothing at all for the whole graph. */
function categoryQuery(categories: string[]): string {
  if (!categories.length) return "";
  return "?" + categories.map((c) => `categories=${encodeURIComponent(c)}`).join("&");
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") throw new Error(detail);
    // A structured detail carries the explanation in `message`; without this
    // the caller sees only "Request failed (404)" and cannot tell the user
    // which category the document is actually in.
    const message = (detail as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `Request failed (${res.status})`);
  }
  return data as T;
}

export interface KbFileItem {
  name: string;
  title: string;
  size: number;
  /** Which corpus this document is filed in. */
  category?: string;
  /** The path it was indexed from. This identifies it -- two documents can
   *  share a file name -- and is what a delete is aimed with. */
  source?: string;
  full_path?: string;
  chunks?: number;
  tokens?: number;
  is_indexed?: boolean;
}

/** A document as the three stores see it: the file on disk, the row in the
 *  corpus, the node in the graph. Any of the three can be missing, which is
 *  the point. */
export interface CoverageDocument {
  name: string;
  title: string;
  source: string;
  on_disk: boolean;
  indexed: boolean;
  in_graph: boolean;
  corpus_category: string | null;
  graph_category: string | null;
  chunks: number | null;
  tokens: number | null;
  degree: number | null;
  size: number | null;
  has_original: boolean;
  original: string | null;
  issues: CoverageIssueKind[];
}

export type CoverageIssueKind =
  | "file_missing" | "not_indexed" | "not_in_graph"
  | "shadowed" | "category_mismatch" | "no_original";

export interface CoverageIssue {
  kind: CoverageIssueKind;
  severity: "error" | "warning" | "info";
  title: string;
  source: string;
  detail: string;
}

export interface CoverageReport {
  summary: {
    on_disk: number; indexed: number; in_graph: number;
    documents: number; clean: number;
  } & Record<CoverageIssueKind, number>;
  issues: CoverageIssue[];
  help: Record<CoverageIssueKind, string>;
  corpus_error: string | null;
  graph_error: string | null;
  documents?: CoverageDocument[];
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<{ preview_available: boolean }>(r)),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch("/api/upload", { method: "POST", body }).then((r) => json<Upload>(r));
  },
  convert: (id: string, vlm: boolean, provider: string) =>
    fetch(`/api/convert/${id}?vlm=${vlm}&provider=${provider}`, { method: "POST" }).then((r) => json<Conversion>(r)),
  embed: (id: string, category?: string) =>
    fetch(`/api/docs/${id}/embed${category ? `?category=${encodeURIComponent(category)}` : ""}`,
          { method: "POST" }).then((r) => json<EmbedResult>(r)),
  ragStatus: () => fetch("/api/rag/status").then((r) => json<RagStatus>(r)),
  /** One indexed chunk by its key ("PKG:412"), in the Source shape the
   *  document inspector takes. The Evidence Agent needs this: a claim's
   *  source names a chunk and quotes a sentence, and the passage it came
   *  from has to be fetched before the document can be opened on it. */
  chunk: (chunkId: string) =>
    fetch(`/api/rag/chunk/${encodeURIComponent(chunkId)}`).then((r) => json<Source>(r)),
  previewUrl: (id: string, page: number) => `/api/docs/${id}/preview/${page}`,
  downloadUrl: (id: string) => `/api/docs/${id}/download`,
  kbFiles: () => fetch("/api/kb/files").then((r) => json<KbFileItem[]>(r)),
  /** Where the file system, the corpus and the graph disagree. Read-only. */
  coverage: (documents = true) =>
    fetch(`/api/coverage?documents=${documents}`).then((r) => json<CoverageReport>(r)),
  /** Open an indexed document's ORIGINAL file (the .pptx/.pdf the Markdown was
   *  converted from) so it can be previewed beside its Markdown. Takes the
   *  Markdown's source path, because that is what identifies a document; the
   *  original is found next to it. Rejected for a document added through the
   *  UI, which has no original on disk. */
  openKbOriginal: (source: string) =>
    fetch(`/api/kb/files/open?source=${encodeURIComponent(source)}`, { method: "POST" })
      .then((r) => json<Upload & { markdown_source: string }>(r)),
  kbFileContent: (filename: string, source?: string) =>
    fetch(`/api/kb/files/${encodeURIComponent(filename)}${source ? `?source=${encodeURIComponent(source)}` : ""}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }),
  /** `source` says WHICH document, when several share a file name -- they can,
   *  since knowledge_base/X.md and solvay-spark/pkg/markdown/X.md are two
   *  files. Without it the server refuses an ambiguous delete rather than
   *  removing them all, which is what it used to do. */
  deleteKbFile: (filename: string, source?: string) =>
    fetch(`/api/kb/files/${encodeURIComponent(filename)}`
            + (source ? `?source=${encodeURIComponent(source)}` : ""),
          { method: "DELETE" })
      .then((r) => json<{ status: string; deleted_from_db: boolean; remaining: number;
                          file_removed: boolean }>(r)),
  graphData: (categories: string[] = []) =>
    fetch(`/api/graph/data${categoryQuery(categories)}`).then((r) => json<GraphData>(r)),
  rebuildGraph: (categories: string[] = []) =>
    fetch(`/api/graph/rebuild${categoryQuery(categories)}`, { method: "POST" }).then((r) => json<GraphData>(r)),
  queryGraph: (req: { query?: string; source_id?: string; target_id?: string }) =>
    fetch("/api/graph/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => json<GraphQueryResult>(r)),
  /** The schema is the same whatever the categories; the counts and sample
   *  instances follow them. */
  graphModel: (categories: string[] = []) =>
    fetch(`/api/graph/model${categoryQuery(categories)}`).then((r) => json<GraphModel>(r)),
};

/** The graph's own schema, as a Neo4j Data Importer model. */
export interface ModelConstraint {
  type: string;
  property: string;
}

export interface ModelProperty {
  name: string;
  type: string;
  nullable: boolean;
}

/** A real node from the built graph, standing in for its label. */
export interface ModelInstance {
  id: string;
  label: string;
  detail: string;
  degree: number;
}

export interface ModelNode {
  id: string;
  token: string;
  position: { x: number; y: number };
  properties: ModelProperty[];
  constraints: ModelConstraint[];
  built_as: string | null;
  count: number;
  instances: ModelInstance[];
}

export interface ModelRelationship {
  id: string;
  type: string;
  from: string;
  to: string;
  count: number;
}

export interface GraphModel {
  version: string;
  nodes: ModelNode[];
  relationships: ModelRelationship[];
  stats: {
    labels: number;
    relationship_types: number;
    constraints: number;
    nodes: number;
    edges: number;
  };
}

export interface GraphNode {
  id: string;
  label: string;
  type: "stream" | "system" | "document" | "process" | "spec";
  color?: string;
  size?: number;
  degree?: number;
  description?: string;
  code?: string;
  ticket?: string;
  filename?: string;
  source?: string;
  format?: string;
  chars?: number;
  is_primary?: boolean;
  /** Present on BPML processes, and true when the workbook confirms the code. */
  in_bpml?: boolean;
  /** The register's "Lowest Level Key", on L4 steps only. */
  jira_key?: string;
  /** The category the document came from (document nodes only). Streams,
   *  systems, processes and specs are shared, so they carry none. */
  category?: string;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    total_nodes: number;
    total_edges: number;
    types: Record<string, number>;
    streams: string[];
    systems: string[];
    /** Documents per category in the graph as returned. */
    categories?: Record<string, number>;
    /** Present when the graph was narrowed to some categories. */
    filtered_to?: string[];
  };
}

export interface GraphPathStep {
  from_id: string;
  from: string;
  from_type?: string;
  to_id: string;
  to: string;
  to_type?: string;
  relation: string;
}

export interface GraphPath {
  start_id: string;
  end_id: string;
  hops: number;
  nodes: string[];
  edges: string[];
  steps: GraphPathStep[];
}

export interface GraphQueryResult {
  query: string;
  mode: "path" | "subgraph";
  summary: string;
  answer?: string;
  node_ids: string[];
  edge_ids: string[];
  path?: GraphPath;
  stats: {
    nodes_count: number;
    edges_count: number;
  };
}

export interface KbBatchInsertHandlers {
  onProgress?: (data: { type: "start"; index: number; total: number; filename: string }) => void;
  onFileDone?: (data: {
    type: "done";
    index: number;
    total: number;
    filename: string;
    title: string;
    status: string;
    chunks: number;
    tokens: number;
    duplicates: string[];
  }) => void;
  onFileError?: (data: { type: "error"; index: number; total: number; filename: string; error: string }) => void;
  onComplete?: (data: {
    total: number;
    succeeded: number;
    failed: number;
    total_chunks: number;
    total_tokens: number;
    total_documents_in_db: number;
    total_chunks_in_db: number;
    seconds: number;
  }) => void;
  onError?: (err: string) => void;
}

export async function batchInsertKb(
  files: File[],
  handlers: KbBatchInsertHandlers,
  signal?: AbortSignal,
  category?: string,
): Promise<void> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }
  if (category) formData.append("category", category);

  const res = await fetch("/api/kb/batch-insert", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail || `Request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      if (!raw.trim()) continue;
      let eventType = "message";
      let dataStr = "";

      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
      }

      if (!dataStr) continue;
      try {
        const payload = JSON.parse(dataStr);
        if (eventType === "progress" && handlers.onProgress) handlers.onProgress(payload);
        else if (eventType === "file_done" && handlers.onFileDone) handlers.onFileDone(payload);
        else if (eventType === "file_error" && handlers.onFileError) handlers.onFileError(payload);
        else if (eventType === "complete" && handlers.onComplete) handlers.onComplete(payload);
        else if (eventType === "error" && handlers.onError) handlers.onError(payload.message || "Embedding error");
      } catch (e) {
        console.error("Failed to parse SSE payload", e);
      }
    }
  }
}

export interface AskHandlers {
  /** The history row this question is being written to, sent before the
   *  pipeline starts. `not_saved` means the answer is coming but the history
   *  write failed -- the question is answered either way. */
  run?: (r: { id: string; not_saved?: string }) => void;
  stage: (e: StageEvent) => void;
  sources: (s: Source[]) => void;
  token: (t: string) => void;
  done: (d: Done) => void;
  error: (message: string) => void;
}

/** POST a question and dispatch the server-sent events as they arrive.
 *  Parsed by hand: EventSource can only GET, and it reconnects on close --
 *  which would ask the question (and pay for it) again. */
export async function ask(
  /** An empty `categories` searches every one of them. */
  body: { question: string; mode: SearchMode; k: number; categories: string[] },
  on: AskHandlers,
  signal: AbortSignal,
) {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      const payload = data ? JSON.parse(data) : null;
      if (event === "run") on.run?.(payload);
      else if (event === "stage") on.stage(payload);
      else if (event === "sources") on.sources(payload);
      else if (event === "token") on.token(payload);
      else if (event === "done") on.done(payload);
      else if (event === "error") on.error(payload.message);
    }
  }
}

export interface BatchEmbedFileResult {
  filename: string;
  title: string;
  status: "added" | "updated" | "unchanged";
  chunks: number;
  tokens: number;
  duplicates: string[];
}

export interface BatchEmbedSummary {
  total: number;
  succeeded: number;
  failed: number;
  total_chunks: number;
  total_tokens: number;
  db_documents: number;
  db_chunks: number;
  seconds: number;
}

// --- Fit-Gap Copilot ----------------------------------------------------------

export type FitGapClass =
  | "FIT_STANDARD" | "FIT_CONFIG" | "GAP_DEVELOPMENT"
  | "REUSE" | "ADAPT" | "CHALLENGE" | "SIMPLIFY" | "REPLACE" | "RETIRE"
  | "UNKNOWN";

export interface BpmlProcess {
  code: string;
  name: string;
  level: number;
  parent: string | null;
  description?: string;
  process_type?: string;
  status?: string;
  children?: string[];
  stream?: string | null;
  steps?: number;
}

export interface FitGapEvidence {
  chunk_id: string;
  doc: string;
  heading_path: string;
  quote: string;
  supports: "for" | "against" | "context";
}

export interface FitGapImpact {
  system: string;
  interface_ref: string | null;
  impact: "none" | "reuse" | "variant" | "new";
  evidence: FitGapEvidence[];
}

export interface FitGapDecision {
  question: string;
  options: string[];
  consequence_note: string;
  evidence: FitGapEvidence[];
}

export interface FitGapIssue {
  code: string;
  severity: "hard" | "soft";
  detail: string;
}

export interface FitGapReviewRecord {
  id: number;
  reviewer: string;
  verdict: "accept" | "reject" | "refine";
  corrected_classification: FitGapClass | null;
  comment: string;
  created_at: string;
}

export interface FitGapEntry {
  id?: number;
  run_id: string;
  mode: "A" | "B";
  bpml_code: string;
  step_name: string;
  classification: FitGapClass;
  rationale: string;
  confidence: number;
  materiality: "low" | "medium" | "high";
  linked_tickets: string[];
  sap_objects: string[];
  evidence: FitGapEvidence[];
  integration_impacts: FitGapImpact[];
  decision_points: FitGapDecision[];
  open_questions: string[];
  status: "proposed";
  issues?: FitGapIssue[];
  evidence_valid?: boolean;
  tool_calls?: number;
  seconds?: number;
  reviews?: FitGapReviewRecord[];
}

export interface FitGapSynthesis {
  reuse: {
    steps: number;
    classified: number;
    coverage_pct: number;
    reuse_pct: number | null;
    by_class: Record<string, number>;
    by_process: {
      code: string; label: string; steps: number; fit: number; gap: number;
      unknown: number; reuse_pct: number | null; avg_confidence: number;
    }[];
    confidence_bins: Record<string, number>;
    avg_confidence: number;
    note: string;
  };
  gaps: {
    bpml_code: string; step_name: string; classification: FitGapClass; confidence: number;
    materiality: "low" | "medium" | "high"; rationale: string; linked_tickets: string[];
    sap_objects: string[]; evidence_count: number; docs: string[]; weight: number;
  }[];
  decisions: {
    process: string; question: string; options: string[]; consequence_note: string;
    steps: { bpml_code: string; step_name: string; classification: FitGapClass }[];
    evidence: { doc: string; quote: string; chunk_id: string }[]; weight: number;
  }[];
  integrations: {
    system: string; step_count: number; impacts: Record<string, number>; interfaces: string[];
    steps: { bpml_code: string; step_name: string; impact: string; classification: string }[];
  }[];
  agenda: {
    order: number; process: string; code: string; weight: number; minutes: number;
    steps: number; unresolved: number; gaps: number; decisions: string[];
    open_questions: string[]; pre_read: string[];
  }[];
}

export interface FitGapStatus {
  bpml: { sheet: string; available: boolean; error: string | null; processes: number; by_level: Record<string, number>; roots: BpmlProcess[] };
  model: string;
  prompt_hash: string;
  max_tool_calls: number;
  anthropic_key: boolean;
  runs: number;
  entries: number;
  reviews: number;
  chunks?: number;
  documents?: number;
  /** The document categories a run can be pointed at, with what each holds. */
  categories?: { code: string; documents: number; chunks: number }[];
  graph: { total_nodes: number; total_edges: number; types: Record<string, number> } | null;
  error: string | null;
  /** Set when the corpus counts could not be read; the register itself is fine. */
  corpus_error?: string;
  /** What an analyst may attach to a session, and for how long it is kept. */
  uploads?: { ttl_hours: number; max_files: number; accepted: string[]; database: string };
}

export interface FitGapPreview {
  scope: BpmlProcess;
  scope_label: string;
  ancestry: BpmlProcess[];
  steps_total: number;
  steps_planned: number;
  steps: BpmlProcess[];
  model: string;
  max_tool_calls: number;
  estimated_input_tokens: number;
  estimated_minutes: number;
}

export interface FitGapRunSummary {
  id: string; mode: "A" | "B"; scope_bpml: string; scope_label: string; question: string;
  holdout: boolean; status: string; started_at: string | null; finished_at: string | null;
  model: string; entries: number; reuse_pct: number | null; coverage_pct: number | null;
  /** Categories the run was limited to. Empty means it read every one. */
  categories: string[];
  /** The attachment the run read, if any. The upload itself is long gone by
   *  the time a register is reopened, so the names are the whole record. */
  uploads?: { session?: string; schema?: string; documents?: string[] };
}

export interface FitGapRunDetail extends Omit<FitGapRunSummary, "entries"> {
  prompt_hash: string;
  corpus_fingerprint: string;
  params: Record<string, unknown>;
  country: Record<string, unknown> | null;
  input_tokens: number;
  output_tokens: number;
  synthesis: FitGapSynthesis | Record<string, never>;
  entries: FitGapEntry[];
}

export interface FitGapRunBody {
  mode?: "A" | "B";
  scope_bpml: string;
  country_profile?: Record<string, unknown> | null;
  holdout?: boolean;
  max_steps?: number;
  concurrency?: number;
  question?: string | null;
  /** Empty reads every category. Enforced server-side, not a hint. */
  categories?: string[];
  /** The session holding documents attached to this run, if any. */
  upload_session?: string | null;
}

export interface FitGapHandlers {
  scope: (d: {
    run_id: string; scope: BpmlProcess; scope_label: string; ancestry: BpmlProcess[];
    steps: BpmlProcess[]; mode: "A" | "B"; holdout: boolean; model: string;
    prompt_hash: string; corpus_fingerprint: string; categories: string[];
    uploads?: { session?: string; schema?: string; documents?: string[] };
  }) => void;
  stepStart: (d: { bpml_code: string; step_name: string; level: number }) => void;
  toolCall: (d: { bpml_code: string; tool: string; summary: string; ms: number; error: string | null }) => void;
  entry: (d: FitGapEntry) => void;
  verifyFail: (d: { bpml_code: string; issues: FitGapIssue[]; repaired: boolean }) => void;
  stepError: (d: { bpml_code: string; step_name: string; message: string }) => void;
  synthesis: (d: FitGapSynthesis) => void;
  done: (d: {
    run_id: string; steps: number; entries: number; failed: number; seconds: number;
    input_tokens: number; output_tokens: number;
    verification: { entries: number; evidence_items: number; hard_issues: number; soft_issues: number; entries_repaired: number; evidence_valid_pct: number };
  }) => void;
  error: (message: string) => void;
}

/** Run the Copilot and dispatch its server-sent events. Hand-parsed for the
 *  same reason as ask(): EventSource can only GET, and a reconnect would
 *  re-run (and re-bill) the whole register. */
export async function runFitGap(body: FitGapRunBody, on: FitGapHandlers, signal: AbortSignal) {
  const res = await fetch("/api/fitgap/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "scope") on.scope(payload);
      else if (event === "step_start") on.stepStart(payload);
      else if (event === "tool_call") on.toolCall(payload);
      else if (event === "entry") on.entry(payload);
      else if (event === "verify_fail") on.verifyFail(payload);
      else if (event === "step_error") on.stepError(payload);
      else if (event === "synthesis") on.synthesis(payload);
      else if (event === "done") on.done(payload);
      else if (event === "error") on.error(payload.message);
    }
  }
}

// --- documents attached to one agent session ----------------------------------
//
// Shared by the Fit-Gap Copilot and the Rollout Agent. A document carries the
// role it plays in the analysis, which is what lets the Rollout Agent run a
// three-way comparison rather than a two-document diff.

export type UploadRole = "as_is" | "template" | "sap_bp" | "localization" | "other";

export interface UploadedFile {
  name: string; role: UploadRole; role_label: string;
  format: string; bytes: number; pages: number; unit: string;
  chunks: number; tokens: number; seconds: number; added_at: string | null;
}

/** An upload session: a Postgres schema of its own inside docling_session,
 *  swept once it expires. Never part of the corpus. */
export interface UploadSession {
  session: string;
  exists: boolean;
  created_at?: string;
  used_at?: string;
  expires_at?: string;
  ttl_hours?: number;
  max_files?: number;
  database?: string;
  schema?: string;
  files: UploadedFile[];
  documents: number;
  chunks: number;
  tokens?: number;
  graph?: { total_nodes: number; total_edges: number; entities: number; documents: number };
}

export interface UploadEntity {
  node_id: string; type: string; label: string; code: string | null; ticket: string | null;
  /** Whether the permanent corpus already knows this entity. */
  in_corpus: boolean;
  corpus_documents: string[];
  corpus_mentions: number;
}

export interface UploadComparison {
  documents: { node_id: string; label: string }[];
  entities: UploadEntity[];
  shared: number;
  new: number;
}

export interface UploadHandlers {
  session: (d: { session: string }) => void;
  start: (d: { index: number; total: number; filename: string }) => void;
  stage: (d: { index: number; total: number; filename: string; stage: string }) => void;
  doneFile: (d: UploadedFile & { title: string; graph: Record<string, unknown> }) => void;
  fileError: (d: { index: number; total: number; filename: string; message: string }) => void;
  done: (d: UploadSession & { added: number; total: number }) => void;
  error: (message: string) => void;
}

/** Read a server-sent-event stream and hand each event to its handler.
 *  Hand-parsed for the same reason as ask(): EventSource can only GET. */
async function readEvents(res: Response, on: Record<string, (payload: unknown) => void>) {
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      on[event]?.(JSON.parse(data));
    }
  }
}

/** Convert, chunk, embed and graph documents into a session. `session` is ""
 *  for the first upload; the server answers with the id it created. */
export async function uploadSessionDocuments(
  files: File[],
  session: string,
  role: UploadRole,
  on: UploadHandlers,
  signal?: AbortSignal,
) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("session", session);
  form.append("role", role);
  const res = await fetch("/api/uploads", { method: "POST", body: form, signal });
  // The payloads are `unknown` on the way out of JSON.parse and asserted here,
  // once, rather than anywhere further in.
  await readEvents(res, {
    session: (d) => on.session(d as Parameters<UploadHandlers["session"]>[0]),
    start: (d) => on.start(d as Parameters<UploadHandlers["start"]>[0]),
    stage: (d) => on.stage(d as Parameters<UploadHandlers["stage"]>[0]),
    done_file: (d) => on.doneFile(d as Parameters<UploadHandlers["doneFile"]>[0]),
    file_error: (d) => on.fileError(d as Parameters<UploadHandlers["fileError"]>[0]),
    done: (d) => on.done(d as Parameters<UploadHandlers["done"]>[0]),
    error: (d) => on.error((d as { message: string }).message),
  });
}

export const sessionUploads = {
  status: (session: string) =>
    fetch(`/api/uploads/${session}`).then((r) => json<UploadSession>(r)),
  entities: (session: string, roles?: UploadRole[]) =>
    fetch(`/api/uploads/${session}/entities` +
      (roles?.length ? `?${roles.map((r) => `roles=${r}`).join("&")}` : ""))
      .then((r) => json<UploadComparison>(r)),
  retag: (session: string, name: string, role: UploadRole) =>
    fetch(`/api/uploads/${session}/files/${encodeURIComponent(name)}?role=${role}`,
      { method: "PATCH" }).then((r) => json<UploadSession>(r)),
  remove: (session: string, name: string) =>
    fetch(`/api/uploads/${session}/files/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then((r) => json<UploadSession>(r)),
  drop: (session: string) =>
    fetch(`/api/uploads/${session}`, { method: "DELETE" })
      .then((r) => json<{ dropped: boolean }>(r)),
};

export const fitgap = {
  status: () => fetch("/api/fitgap/status").then((r) => json<FitGapStatus>(r)),
  uploads: sessionUploads,
  roots: () => fetch("/api/fitgap/scope").then((r) => json<{ roots: BpmlProcess[] }>(r)),
  search: (q: string) =>
    fetch(`/api/fitgap/scope?q=${encodeURIComponent(q)}`).then((r) => json<{ query: string; matches: BpmlProcess[] }>(r)),
  node: (code: string) =>
    fetch(`/api/fitgap/scope?code=${encodeURIComponent(code)}`).then((r) =>
      json<{ process: BpmlProcess; ancestry: BpmlProcess[]; children: BpmlProcess[]; steps: number }>(r)),
  preview: (body: FitGapRunBody) =>
    fetch("/api/fitgap/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<FitGapPreview>(r)),
  runs: () => fetch("/api/fitgap/runs").then((r) => json<FitGapRunSummary[]>(r)),
  run: (id: string) => fetch(`/api/fitgap/runs/${id}`).then((r) => json<FitGapRunDetail>(r)),
  exportUrl: (id: string, format: "md" | "json" | "xlsx") => `/api/fitgap/runs/${id}/export?format=${format}`,
  review: (entryId: number, body: { reviewer: string; verdict: string; corrected_classification?: string | null; comment?: string }) =>
    fetch(`/api/fitgap/entries/${entryId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<FitGapReviewRecord>(r)),
};

// --- Evidence Agent -----------------------------------------------------------

export type AnswerState =
  | "supported" | "conflicted" | "documented_unknown"
  | "not_in_corpus" | "false_premise" | "unrepresentable";

export type Stance = "supports" | "opposes" | "context";

export interface EvidenceSource {
  chunk_id: string;
  doc: string;
  heading_path: string;
  quote: string;
  stance: Stance;
  score: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  provenance: string[];
  provenance_note: string;
  verified: boolean | null;
}

export interface EvidenceGraphFact {
  statement: string;
  node_ids: string[];
  edge_ids: string[];
  meaningful: boolean;
  note: string;
}

export interface ScoreTerm {
  rule: string;
  delta: number;
  cap: number | null;
  detail: string;
}

export interface EvidenceClaim {
  text: string;
  sources: EvidenceSource[];
  graph_facts: EvidenceGraphFact[];
  score: number;
  score_terms: ScoreTerm[];
  independent_sources: number;
  note: string;
}

export interface EvidenceAnswer {
  question: string;
  state: AnswerState;
  answer: string;
  claims: EvidenceClaim[];
  open_questions: string[];
  limits: string[];
  engines: Record<string, number>;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  seconds: number;
  model: string;
}

/** Which store a tool call read. Retrieval hits the corpus table in Postgres,
 *  the knowledge graph is held in memory and built from every category's
 *  Markdown, and the BPML hierarchy comes from a spreadsheet. An attachment is
 *  somewhere else again: a database of its own. */
export interface EvidenceToolSources {
  kind: "postgres" | "graph" | "sheet" | "other";
  /** One line for the log, e.g. "PKG 7 · DR 3". */
  label: string;
  /** Categories the result actually came from. */
  categories?: string[];
  /** postgres only: hits per category; for a session, per schema. */
  databases?: Record<string, number>;
  /** postgres only: the categories the search was allowed to cover. */
  searched?: string[];
  /** graph only: the categories the graph was built from. */
  built_from?: string[];
}

/** One passage retrieval returned, at the rank the agent saw it. `text` is the
 *  passage itself rather than a pointer to it: re-indexing renumbers chunks, so
 *  `chunk_id` is a best-effort deep link and not a way to fetch this back. */
export interface EvidenceRagHit {
  rank: number;
  chunk_id: string;
  category: string;
  doc: string;
  heading_path: string;
  score: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  text: string;
  uploaded: boolean;
  /** Which side of a three-way comparison this passage is evidence for. Only
   *  the Rollout Agent's read_sources sets it; empty everywhere else. */
  side: string;
  side_label: string;
  provenance: string[];
  provenance_note: string;
}

export interface EvidenceRagTrace {
  kind: "rag";
  op: string;
  /** The side read_sources was restricted to, when it was. */
  side?: string;
  query: string;
  k: number | null;
  mode: string;
  filters: Record<string, unknown>;
  hits: EvidenceRagHit[];
  note: string;
  duplicate_warning: string;
  truncated: boolean;
}

/** `role` is why the node is in the trace: where the walk started (`seed`), a
 *  node the route passed through (`path`), something a lookup resolved to
 *  (`match`), or somewhere the walk reached (`neighbour`). */
export interface EvidenceGraphNode {
  id: string;
  label: string;
  type: string;
  degree: number | null;
  description: string;
  role: "seed" | "path" | "match" | "neighbour";
  hops: number;
  /** Only compare_entities sets these: whether the corpus already knows this
   *  entity, and in how many documents. null everywhere else, and the panel
   *  leaves the badge off rather than claiming "new". */
  in_corpus?: boolean | null;
  corpus_mentions?: number | null;
}

export interface EvidenceGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string;
  on_path: boolean;
}

export interface EvidenceGraphTrace {
  kind: "graph";
  op: string;
  query: string;
  seeds: string[];
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  path: {
    hops: number | null;
    steps: { from: string; relation: string; to: string; is_label_edge?: boolean }[];
    meaningful: boolean | null;
    note: string;
    node_ids: string[];
  } | null;
  count: number | null;
  shared?: number | null;
  new?: number | null;
  type_filter: string;
  note: string;
  truncated: boolean;
}

export interface EvidenceBpmlStep {
  code?: string;
  name?: string;
  [key: string]: unknown;
}

export interface EvidenceBpmlTrace {
  kind: "bpml";
  op: string;
  query: string;
  process: EvidenceBpmlStep;
  parent: EvidenceBpmlStep | null;
  ancestry: EvidenceBpmlStep[];
  children: EvidenceBpmlStep[];
  truncated: boolean;
}

export type EvidenceTrace = EvidenceRagTrace | EvidenceGraphTrace | EvidenceBpmlTrace;

/** What the trace drawer needs from a call, whichever agent made it. The
 *  Evidence Agent labels its calls by engine and the Rollout Agent also by
 *  stage, but the panel only ever reads the fields below. */
export interface AgentToolCall {
  tool: string;
  engine: string;
  arguments: Record<string, unknown>;
  summary: string;
  sources?: EvidenceToolSources;
  ms: number;
  error: string | null;
  warning?: string | null;
  trace?: EvidenceTrace | null;
}

export interface EvidenceToolCall {
  tool: string;
  engine: "rag" | "graph" | "bpml" | "other";
  arguments: Record<string, unknown>;
  summary: string;
  sources?: EvidenceToolSources;
  ms: number;
  error: string | null;
  warning: string | null;
  /** What the call returned. Absent on a failed call, and on runs recorded
   *  before the investigation log carried traces. */
  trace?: EvidenceTrace | null;
}

/** What the agent recalled before it started, and whether it was allowed to.
 *  Memory ORIENTS a run and can never ground one: nothing recalled here is in
 *  `session.retrieved`, so a quote taken from it fails verification and its
 *  claim is dropped. The panel says so, because a reader who sees a memory
 *  beside the evidence must not mistake it for evidence. */
export interface EvidenceMemory {
  /** The toggle was on for this run. */
  enabled: boolean;
  /** Memory was actually read. False under holdout even when enabled. */
  used: boolean;
  /** Why it was not read, when it was asked for. */
  suppressed_by_holdout: boolean;
  recalled: number;
  memories: { id: string; text: string; type: string; score: number | null }[];
}

/** One line of the session log: the run as a SEQUENCE, in the order it
 *  happened. `calls` says what each tool returned; this says what the agent was
 *  handed, what it reasoned, when it ran out of budget and what it wrote back —
 *  all of which used to exist only for whoever was watching the stream.
 *
 *  A `tool_call` entry carries `call`, the index into `calls`, so the console
 *  can open the same trace drawer without a second copy of every passage. */
export interface EvidenceLogEntry {
  seq: number;
  /** ISO timestamp, millisecond precision. */
  at: string;
  kind: "question" | "memory" | "note" | "thinking" | "tool_call" | "answer" | "error";
  text?: string;
  /** tool_call */
  tool?: string;
  engine?: string;
  summary?: string;
  ms?: number;
  error?: string | null;
  warning?: string | null;
  arguments?: Record<string, unknown>;
  /** Index into EvidenceRunDetail.calls. -1 when the call was not recorded. */
  call?: number;
  /** note: which kind of note — prompt · budget · rejected · retained. */
  note?: string;
  title?: string;
  detail?: Record<string, unknown>;
  /** thinking */
  turn?: number;
  /** memory */
  used?: boolean;
  recalled?: number;
  suppressed_by_holdout?: boolean;
  memories?: string[];
  /** question */
  holdout?: boolean;
  scope?: string[];
  memory?: boolean;
  /** answer */
  state?: string;
  claims?: number;
}

/** Whether the Hindsight memory server is reachable, and how much it holds. */
export interface MemoryStatus {
  /** HINDSIGHT_URL is set. Empty means memory is switched off deliberately. */
  configured: boolean;
  /** The server answered. When false, `detail` says why. */
  available: boolean;
  detail: string;
  url: string;
  bank: string;
  memories?: number;
}

export interface EvidenceStatus {
  model: string;
  prompt_hash: string;
  max_tool_calls: number;
  anthropic_key: boolean;
  tools: string[];
  /** Document categories an investigation can be pointed at. */
  categories: { code: string; documents: number; chunks: number }[];
  duplicate_groups: string[][];
  duplicate_threshold: number;
  hubs: { label: string; degree: number }[];
  hub_degree: number;
  graph: { total_nodes: number; total_edges: number } | null;
  /** How many investigations are on record. */
  history?: { runs: number; answered: number; database?: string; error?: string };
  memory?: MemoryStatus;
  error: string | null;
}

/** One past investigation, as the history strip shows it. Enough to recognise
 *  a question and decide whether to reopen it, without carrying every claim
 *  and quote of fifty runs. */
export interface EvidenceRunSummary {
  id: string;
  question: string;
  holdout: boolean;
  /** running · done · failed · abandoned (a run whose stream was dropped). */
  status: string;
  state: AnswerState | "";
  started_at: string | null;
  finished_at: string | null;
  seconds: number;
  model: string;
  claims: number;
  sources: number;
  tool_calls: number;
  categories: string[];
  /** `{}` for a run recorded before memory existed. */
  memory?: EvidenceMemory | Record<string, never>;
  /** The first 180 characters of the answer. */
  summary: string;
}

/** A past investigation in full: what was asked, every tool call in order, and
 *  the verified answer. `calls` is what makes a reopened run an investigation
 *  rather than an answer with no working. */
export interface EvidenceRunDetail extends Omit<EvidenceRunSummary, "claims" | "sources" | "summary"> {
  prompt_hash: string;
  corpus_fingerprint: string;
  input_tokens: number;
  output_tokens: number;
  answer: EvidenceAnswer | null;
  calls: EvidenceToolCall[];
  /** Empty for a run recorded before the log existed. */
  log?: EvidenceLogEntry[];
  error: string;
}

export interface EvidenceHandlers {
  /** The id the investigation is being recorded under, sent before any work
   *  starts so the page can link to it even if the run is abandoned. */
  run?: (r: { id: string; not_saved?: string }) => void;
  /** Sent once, before the first tool call, whether or not memory was on. */
  memory?: (m: EvidenceMemory) => void;
  /** Every step, in order — including the ones that have no panel of their
   *  own: the assembled prompt, the reasoning between calls, the budget
   *  notice, a rejected submission. */
  log?: (e: EvidenceLogEntry) => void;
  toolCall: (c: EvidenceToolCall) => void;
  answer: (a: EvidenceAnswer) => void;
  error: (message: string) => void;
}

/** Ask the Evidence Agent and dispatch its server-sent events. Hand-parsed for
 *  the same reason as ask(): EventSource can only GET, and a reconnect would
 *  re-run (and re-bill) the whole investigation. */
export async function askEvidence(
  /** An empty `categories` reads every one of them. */
  body: { question: string; holdout?: boolean; categories?: string[]; memory?: boolean },
  on: EvidenceHandlers,
  signal: AbortSignal,
) {
  const res = await fetch("/api/evidence/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "run") on.run?.(payload);
      else if (event === "log") on.log?.(payload);
      else if (event === "memory") on.memory?.(payload);
      else if (event === "tool_call") on.toolCall(payload);
      else if (event === "answer") on.answer(payload);
      else if (event === "error") on.error(payload.message);
    }
  }
}

/** One row of the Ask history panel. Carries no excerpts and no full answer:
 *  those are fetched only when a question is reopened. */
export interface AskRunSummary {
  id: string;
  question: string;
  mode: SearchMode;
  k: number;
  categories: string[];
  status: "running" | "done" | "failed" | "abandoned";
  started_at: string | null;
  finished_at: string | null;
  seconds: number;
  answer_model: string;
  sources: number;
  summary: string;
  input_tokens: number;
  output_tokens: number;
  error: string;
}

export interface AskRunDetail extends Omit<AskRunSummary, "sources" | "summary"> {
  embed_model: string;
  corpus_fingerprint: string;
  /** The corpus has been re-indexed since this answer was written, so the
   *  excerpts below are what it said then, not what it would say now. */
  corpus_changed: boolean;
  answer: string;
  sources: Source[];
  terms: string[];
}

export const askHistory = {
  runs: (limit = 50, search = "") =>
    fetch(`/api/ask/runs?limit=${limit}&search=${encodeURIComponent(search)}`)
      .then((r) => json<{ runs: AskRunSummary[]; retention: number }>(r)),
  run: (id: string) =>
    fetch(`/api/ask/runs/${encodeURIComponent(id)}`).then((r) => json<AskRunDetail>(r)),
  deleteRun: (id: string) =>
    fetch(`/api/ask/runs/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((r) => json<{ status: string; id: string }>(r)),
  clear: () =>
    fetch("/api/ask/runs", { method: "DELETE" })
      .then((r) => json<{ status: string; removed: number }>(r)),
};

export const evidence = {
  status: () => fetch("/api/evidence/status").then((r) => json<EvidenceStatus>(r)),
  runs: (limit = 50) =>
    fetch(`/api/evidence/runs?limit=${limit}`).then((r) => json<EvidenceRunSummary[]>(r)),
  run: (id: string) =>
    fetch(`/api/evidence/runs/${encodeURIComponent(id)}`).then((r) => json<EvidenceRunDetail>(r)),
  deleteRun: (id: string) =>
    fetch(`/api/evidence/runs/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((r) => json<{ status: string; id: string }>(r)),
};

// --- the Rollout Agent --------------------------------------------------------
//
// Fit-to-Standard analysis for a country rollout: the country's As-Is compared
// against the Global Template and, where a source exists, SAP Best Practice.
// Every controlled vocabulary comes from /api/rollout/status so the page shows
// the labels the validator enforces rather than a second copy that can drift.

export type DeviationType =
  | "PF" | "BR" | "AP" | "RO" | "LC" | "CT" | "DT" | "IN"
  | "RP" | "UX" | "EX" | "TM" | "TC" | "SEC" | "VOL" | "POL";

export type Disposition =
  | "ADOPT_GT" | "CONFIGURE_STANDARD" | "USE_SAP_LOCALIZATION" | "ADOPT_SAP_BP"
  | "EXTEND_STANDARD" | "RETAIN_LOCAL_EXCEPTION" | "REDESIGN_GT" | "RETIRE_LEGACY"
  | "REQUIRES_DECISION" | "OUT_OF_SCOPE";

export type LocalizationState =
  | "CONFIRMED_STATUTORY" | "SAP_DELIVERED" | "CORPORATE_POLICY"
  | "LOCAL_PREFERENCE" | "SUSPECTED" | "NOT_LOCALIZATION";

export type Materiality = "Critical" | "High" | "Medium" | "Low" | "Informational";
export type WorkshopBucket = "MUST_DISCUSS" | "CONFIRM" | "NO_WORKSHOP_TIME";
export type RolloutDimension =
  "flow" | "rules" | "governance" | "data" | "integration" | "controls" | "reporting";

export interface RolloutEvidence {
  chunk_id: string; doc: string; heading_path: string; quote: string;
  side: "as_is" | "template" | "sap_bp" | "localization";
  evidence_class: "E1" | "E2" | "E3" | "E4";
}

export interface AsIsStep {
  step_id: string; name: string; trigger: string; actor: string; action: string;
  system: string; input: string; business_rule: string; decision: string; control: string;
  output: string; exception: string; integration: string; timing: string; volume: string;
  sequence: number; confidence: "High" | "Medium" | "Low"; evidence: RolloutEvidence[];
}

export interface AsIsModel {
  process_name: string; country: string; steps: AsIsStep[];
  normalisation_notes: string[]; evidence_gaps: string[];
}

export interface Deviation {
  gap_id: string; as_is_step_id: string; gt_step_ref: string; sap_bp_reference: string | null;
  as_is_statement: string; gt_statement: string; exact_difference: string;
  primary_type: DeviationType; secondary_types: DeviationType[]; dimension: RolloutDimension;
  localization_state: LocalizationState; materiality: Materiality;
  impacts: { area: string; score: number; note: string }[];
  gt_fit_rating: number; sap_bp_fit_rating: number | null; harmonization_potential: number;
  candidate_disposition: Disposition; standard_options_considered: string[];
  workshop_bucket: WorkshopBucket; decision_question: string; decision_options: string[];
  decision_owner: string[]; workshop_minutes: number; why_discussed: string;
  evidence_confidence: "High" | "Medium" | "Low";
  evidence: RolloutEvidence[]; open_questions: string[];
}

export interface LocalizationItem {
  topic: string; status: "Confirmed" | "Candidate" | "Not applicable";
  relevance: string; requirement: string; sap_capability: string; gt_capability: string;
  as_is_handling: string; recommended_path: string; workshop_decision: string;
  owner: string[]; evidence: RolloutEvidence[];
}

export interface BacklogCandidate {
  title: string; requirement: string; business_value: string; acceptance_criteria: string[];
  affected_process: string; dependencies: string[];
  build_type: "configuration" | "extension" | "localization" | "undetermined";
  localization_flag: boolean; priority: "Must" | "Should" | "Could" | "Won't"; gap_id: string;
}

export interface RolloutAnalysis {
  headline: string;
  /** What the agent compared the As-Is against. Filled by the agent itself
   *  when the run named no Global Template process. */
  template_process: string;
  dimension_ratings: { dimension: RolloutDimension; gt_rating: number; sap_bp_rating: number | null; note: string }[];
  fit_areas: { as_is_step_id: string; gt_step_ref: string; statement: string; evidence: RolloutEvidence[] }[];
  deviations: Deviation[];
  localization: LocalizationItem[];
  backlog: BacklogCandidate[];
  open_questions: string[];
  sap_bp_note: string;
}

export interface RolloutScores {
  /** Which subject the run read. The score cards that do not apply to a
   *  subject are blank, and this is what says why. */
  subject?: string; subject_label?: string;
  gt_alignment: number | null; gt_band: string;
  sap_bp_alignment: number | null; sap_bp_band: string; sap_bp_note: string;
  localization_adjusted: number | null; localization_share: number;
  harmonization_potential: number | null; harmonization_band: string;
  pattern: string; formula: string;
  dimensions: { dimension: string; label: string; weight: number; rating: number | null; percent: number | null; note: string }[];
  sap_bp_dimensions: { dimension: string; label: string; weight: number; rating: number | null; percent: number | null; note: string }[];
  counts: {
    fit_areas: number; deviations: number; localization_items: number;
    localization_confirmed: number; backlog: number; open_questions: number;
    by_materiality: Record<string, number>; by_type: Record<string, number>;
    workshop: Record<string, number>; workshop_minutes: number;
  };
  heatmap: {
    dimension: string; label: string; weight: number; rating: number | null;
    deviations: number; must_discuss: number; localization: number;
    focus: "High" | "Medium" | "Low" | "None"; gap_ids: string[];
  }[];
  agenda: {
    position: number; gap_id: string; topic: string; why: string; minutes: number;
    materiality: Materiality; primary_type: DeviationType;
    localization_state: LocalizationState; options: string[]; owner: string[];
    disposition: Disposition;
  }[];
}

export interface RolloutQualityIssue {
  gate: string; severity: "hard" | "soft"; detail: string; gap_id: string;
}

export interface RolloutGates {
  issues: number; hard: number; soft: number;
  by_gate: Record<string, number>; not_checked: string[];
  items: RolloutQualityIssue[];
}

export interface RolloutStatus {
  /** Whether this server can render the workshop pack as a PDF. WeasyPrint
   *  needs pango, cairo and gdk-pixbuf; when they are missing `detail` says
   *  so and the page offers Markdown instead of a button that fails. */
  pdf?: { available: boolean; detail: string };
  bpml: FitGapStatus["bpml"];
  model: string; prompt_hash: string;
  max_tool_calls: Record<string, number>;
  anthropic_key: boolean; runs: number; decisions: number;
  documents?: number; chunks?: number;
  categories?: { code: string; documents: number; chunks: number }[];
  vocabulary: {
    deviation_types: Record<string, string>;
    dispositions: Record<string, string>;
    localization_states: Record<string, string>;
    dimensions: Record<string, { label: string; weight: number }>;
    ratings: Record<string, string>;
  };
  /** What a run can analyse, and which upload role each one needs. */
  subjects: RolloutSubject[];
  uploads: {
    ttl_hours: number; max_files: number; accepted: string[]; database: string;
    roles: { value: UploadRole; label: string }[];
  };
  error: string | null;
  corpus_error?: string;
}

/** A run reads one document set as its subject and compares it against the
 *  Global Template. `country_as_is` asks how far the country is from the
 *  template; `sap_best_practice` asks how far the template has drifted from
 *  SAP standard, and has no country in it at all. */
export interface RolloutSubject {
  value: string; label: string; role: UploadRole;
  localization: boolean; score_b: boolean;
}

export interface RolloutPreview {
  /** null when no Global Template process was named — the agent finds one. */
  scope: BpmlProcess | null;
  scope_label: string; ancestry: BpmlProcess[]; steps_total: number;
  attached: { name: string; role: UploadRole; role_label: string; chunks: number }[];
  by_role: Record<string, number>;
  ready: boolean; blocker: string; sap_bp_available: boolean;
  subject: string; subject_label: string; required_role: UploadRole;
  model: string; max_tool_calls: Record<string, number>;
  estimated_input_tokens: number; estimated_minutes: number;
}

export interface RolloutRunBody {
  /** Optional. Empty asks the agent to identify the template process itself. */
  scope_bpml?: string;
  subject?: string;
  country?: string;
  country_context?: string;
  sap_release?: string;
  gt_version?: string;
  question?: string | null;
  upload_session: string;
  categories?: string[];
}

export interface RolloutRunSummary {
  id: string; scope_bpml: string; scope_label: string; country: string; status: string;
  started_at: string | null; finished_at: string | null; model: string;
  categories: string[]; uploads: { session?: string; documents?: { name: string; role: string }[] };
  gt_alignment: number | null; harmonization_potential: number | null;
  deviations: number; must_discuss: number;
}

/** What the analysis was built from: every cited chunk, with the document it
 *  came from, where in it, how it scored and what it supported. Empty for
 *  runs made before the record was kept. */
export interface RolloutSourceChunk {
  chunk_id: string; document: string; category: string;
  kind: "corpus" | "upload";
  heading_path: string;
  score: number | null; vector_rank: number | null; keyword_rank: number | null;
  snippet: string; truncated: boolean; file: string; known: boolean;
  used_by: { kind: string; ref: string; label: string; side: string;
             evidence_class: string; quote: string }[];
}

export interface RolloutSourceDocument {
  document: string; category: string; kind: "corpus" | "upload"; file: string;
  chunks: number; citations: number; best_score: number | null; headings: string[];
}

export interface RolloutSources {
  chunks: Record<string, RolloutSourceChunk>;
  documents: RolloutSourceDocument[];
  retrieved_total: number; cited_total: number; unused_total: number;
}

export interface RolloutRunDetail extends RolloutRunSummary {
  subject: string;
  sources: RolloutSources | Record<string, never>;
  /** The investigation log, with the evidence each call returned. Empty for
   *  runs recorded before the log was kept at all. */
  calls?: (AgentToolCall & { stage: string })[];
  country_context: string; sap_release: string; gt_version: string; question: string;
  prompt_hash: string; corpus_fingerprint: string;
  input_tokens: number; output_tokens: number;
  asis: AsIsModel | Record<string, never>;
  analysis: RolloutAnalysis | Record<string, never>;
  scores: RolloutScores | Record<string, never>;
  gates: RolloutGates | Record<string, never>;
  decisions: RolloutDecision[];
}

/** One named person's verdict on one gap. The log is append-only: a later
 *  decision supersedes an earlier one for display but never replaces it, so
 *  the record still shows that the view changed and when. */
export interface RolloutDecision {
  id: number; gap_id: string; reviewer: string; verdict: "accept" | "reject" | "defer";
  disposition: string; comment: string; decided_at: string | null;
}

export interface RolloutHandlers {
  scope: (d: {
    run_id: string; scope: BpmlProcess | null; scope_label: string; ancestry: BpmlProcess[];
    country: string; model: string; prompt_hash: string; corpus_fingerprint: string;
    categories: string[]; uploads: Record<string, unknown>; sap_bp_available: boolean;
  }) => void;
  stage: (d: { stage: string; status: string; detail: string; tool_calls?: number; seconds?: number }) => void;
  toolCall: (d: AgentToolCall & { stage: string }) => void;
  asis: (d: AsIsModel) => void;
  gate: (d: RolloutGates) => void;
  analysis: (d: RolloutAnalysis) => void;
  scores: (d: RolloutScores) => void;
  sources: (d: RolloutSources) => void;
  done: (d: { run_id: string; seconds: number; input_tokens: number; output_tokens: number; tool_calls: number }) => void;
  error: (message: string) => void;
}

/** Run the Rollout Agent and dispatch its server-sent events. */
export async function runRollout(body: RolloutRunBody, on: RolloutHandlers, signal: AbortSignal) {
  const res = await fetch("/api/rollout/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  await readEvents(res, {
    scope: (d) => on.scope(d as Parameters<RolloutHandlers["scope"]>[0]),
    stage: (d) => on.stage(d as Parameters<RolloutHandlers["stage"]>[0]),
    tool_call: (d) => on.toolCall(d as Parameters<RolloutHandlers["toolCall"]>[0]),
    asis: (d) => on.asis(d as AsIsModel),
    gate: (d) => on.gate(d as RolloutGates),
    analysis: (d) => on.analysis(d as RolloutAnalysis),
    scores: (d) => on.scores(d as RolloutScores),
    sources: (d) => on.sources(d as RolloutSources),
    done: (d) => on.done(d as Parameters<RolloutHandlers["done"]>[0]),
    error: (d) => on.error((d as { message: string }).message),
  });
}

export const rollout = {
  status: () => fetch("/api/rollout/status").then((r) => json<RolloutStatus>(r)),
  preview: (body: RolloutRunBody) =>
    fetch("/api/rollout/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<RolloutPreview>(r)),
  runs: () => fetch("/api/rollout/runs").then((r) => json<RolloutRunSummary[]>(r)),
  run: (id: string) => fetch(`/api/rollout/runs/${id}`).then((r) => json<RolloutRunDetail>(r)),
  deleteRun: (id: string) =>
    fetch(`/api/rollout/runs/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((r) => json<{ status: string; id: string }>(r)),
  exportUrl: (id: string, format: "md" | "json" | "pdf") =>
    `/api/rollout/runs/${id}/export?format=${format}`,
  /** Where a cited document can be read. Corpus documents are resolved by
   *  file name; an attachment is served from its session, as the Markdown the
   *  agent actually read. */
  sourceUrl: (chunk: RolloutSourceChunk, session: string) =>
    chunk.kind === "upload"
      ? (session ? `/api/uploads/${session}/files/${encodeURIComponent(chunk.document)}/markdown` : "")
      : (chunk.file ? `/api/kb/files/${encodeURIComponent(chunk.file)}` : ""),
  decide: (runId: string, body: { gap_id: string; reviewer: string; verdict: string; disposition?: string; comment?: string }) =>
    fetch(`/api/rollout/runs/${runId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<RolloutDecision>(r)),
};
