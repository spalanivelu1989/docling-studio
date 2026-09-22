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

/** A category of documents. Each one is isolated in its own Postgres
 *  database, so `documents` and `chunks` are that database's own counts. */
export interface CategoryInfo {
  code: string;
  label: string;
  description: string;
  folder: string;
  database: string;
  /** False until something has been indexed into it. */
  exists: boolean;
  /** True when RAG_DATABASE_URL_<CODE> puts it off the naming convention. */
  configured: boolean;
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
    throw new Error(typeof detail === "string" ? detail : `Request failed (${res.status})`);
  }
  return data as T;
}

export interface KbFileItem {
  name: string;
  title: string;
  size: number;
  source?: string;
  full_path?: string;
  chunks?: number;
  tokens?: number;
  is_indexed?: boolean;
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
  embed: (id: string) => fetch(`/api/docs/${id}/embed`, { method: "POST" }).then((r) => json<EmbedResult>(r)),
  ragStatus: () => fetch("/api/rag/status").then((r) => json<RagStatus>(r)),
  previewUrl: (id: string, page: number) => `/api/docs/${id}/preview/${page}`,
  downloadUrl: (id: string) => `/api/docs/${id}/download`,
  kbFiles: () => fetch("/api/kb/files").then((r) => json<KbFileItem[]>(r)),
  kbFileContent: (filename: string) => fetch(`/api/kb/files/${encodeURIComponent(filename)}`).then((r) => r.text()),
  deleteKbFile: (filename: string) =>
    fetch(`/api/kb/files/${encodeURIComponent(filename)}`, { method: "DELETE" }).then((r) => json<{ status: string }>(r)),
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
  signal?: AbortSignal
): Promise<void> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }

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
      if (event === "stage") on.stage(payload);
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
}

export interface FitGapHandlers {
  scope: (d: {
    run_id: string; scope: BpmlProcess; scope_label: string; ancestry: BpmlProcess[];
    steps: BpmlProcess[]; mode: "A" | "B"; holdout: boolean; model: string;
    prompt_hash: string; corpus_fingerprint: string; categories: string[];
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

export const fitgap = {
  status: () => fetch("/api/fitgap/status").then((r) => json<FitGapStatus>(r)),
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

export interface EvidenceToolCall {
  tool: string;
  engine: "rag" | "graph" | "bpml" | "other";
  arguments: Record<string, unknown>;
  summary: string;
  ms: number;
  error: string | null;
  warning: string | null;
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
  error: string | null;
}

export interface EvidenceHandlers {
  toolCall: (c: EvidenceToolCall) => void;
  answer: (a: EvidenceAnswer) => void;
  error: (message: string) => void;
}

/** Ask the Evidence Agent and dispatch its server-sent events. Hand-parsed for
 *  the same reason as ask(): EventSource can only GET, and a reconnect would
 *  re-run (and re-bill) the whole investigation. */
export async function askEvidence(
  /** An empty `categories` reads every one of them. */
  body: { question: string; holdout?: boolean; categories?: string[] },
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
      if (event === "tool_call") on.toolCall(payload);
      else if (event === "answer") on.answer(payload);
      else if (event === "error") on.error(payload.message);
    }
  }
}

export const evidence = {
  status: () => fetch("/api/evidence/status").then((r) => json<EvidenceStatus>(r)),
};
