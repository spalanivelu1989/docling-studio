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
  kbFiles: () => fetch("/api/kb/files").then((r) => json<{ name: string; title: string; size: number }[]>(r)),
  kbFileContent: (filename: string) => fetch(`/api/kb/files/${encodeURIComponent(filename)}`).then((r) => r.text()),
};

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
