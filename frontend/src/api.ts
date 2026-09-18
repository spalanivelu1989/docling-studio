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

export interface RagStatus {
  missing: string[];
  embed_model: string;
  embed_provider?: string;
  embed_dimension?: number;
  answer_model: string;
  default_k: number;
  documents: number;
  chunks: number;
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
  graphData: () => fetch("/api/graph/data").then((r) => json<GraphData>(r)),
  rebuildGraph: () => fetch("/api/graph/rebuild", { method: "POST" }).then((r) => json<GraphData>(r)),
  queryGraph: (req: { query?: string; source_id?: string; target_id?: string }) =>
    fetch("/api/graph/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => json<GraphQueryResult>(r)),
};

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
  body: { question: string; mode: SearchMode; k: number },
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
