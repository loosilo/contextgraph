/**
 * Embedding backends (in priority order when auto-detecting):
 *   local   — random-projection TF-IDF, 256-dim, zero setup, zero API key (DEFAULT)
 *   ollama  — Ollama nomic-embed-text, set OLLAMA_HOST or ensure localhost:11434 is running
 *   openai  — OpenAI text-embedding-3-small, requires OPENAI_API_KEY
 *
 * Override with EMBEDDING_BACKEND=local|ollama|openai
 */

const DIM = 256;

// ── Shared math ──────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function serializeEmbedding(v: number[]): string {
  return JSON.stringify(v);
}

export function deserializeEmbedding(s: string): number[] {
  return JSON.parse(s);
}

// ── Backend selection ────────────────────────────────────────────────────────

type Backend = "local" | "ollama" | "openai";

function resolveBackend(): Backend {
  const explicit = process.env.EMBEDDING_BACKEND as Backend | undefined;
  if (explicit) return explicit;
  if (process.env.OPENAI_API_KEY) return "openai";
  return "local";
}

const BACKEND: Backend = resolveBackend();

export async function embed(text: string): Promise<number[]> {
  if (BACKEND === "openai") return openAIEmbed(text);
  if (BACKEND === "ollama") return ollamaEmbed(text);
  return localEmbed(text);
}

export async function embedQuery(text: string): Promise<number[]> {
  return embed(text);
}

// ── Local: Random Projection of bag-of-words (256-dim, deterministic) ────────
//
// Uses Johnson-Lindenstrauss random projection: project a sparse term-frequency
// vector through a fixed random matrix. Gives meaningful cosine similarity for
// code and prose without any downloads or API keys.

const PROJ_SEED = 0xdeadbeef;
const VOCAB = 65536; // hash space for terms

// Generate a deterministic DIM×VOCAB projection matrix row-by-row on demand
// using a seeded LCG to avoid storing the full matrix in memory.
function lcgNext(s: number): number {
  return ((Math.imul(s, 1664525) + 1013904223) | 0) >>> 0;
}

function projectionValue(termIdx: number, dim: number): number {
  // Each (termIdx, dim) pair maps to a deterministic ±1/√DIM value
  let s = (PROJ_SEED ^ (termIdx * 2654435761)) >>> 0;
  for (let i = 0; i <= dim; i++) s = lcgNext(s);
  return (s & 1) === 0 ? 1 / Math.sqrt(DIM) : -1 / Math.sqrt(DIM);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")    // split camelCase
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

function localEmbed(text: string): number[] {
  const tokens = tokenize(text.slice(0, 4096));
  if (tokens.length === 0) return new Array(DIM).fill(0);

  // Build term-frequency map (hashed to VOCAB)
  const tf = new Map<number, number>();
  for (const t of tokens) {
    const h = fnv1a(t) % VOCAB;
    tf.set(h, (tf.get(h) ?? 0) + 1);
  }

  // Project TF vector through random matrix
  const vec = new Array<number>(DIM).fill(0);
  for (const [termIdx, freq] of tf) {
    for (let d = 0; d < DIM; d++) {
      vec[d] += freq * projectionValue(termIdx, d);
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ── Ollama ────────────────────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "nomic-embed-text";

async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text.slice(0, 8192) }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { embedding: number[] };
  return data.embedding;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
let _openai: { embeddings: { create: Function } } | null = null;

async function getOpenAI() {
  if (_openai) return _openai;
  const { default: OpenAI } = await import("openai");
  _openai = new OpenAI();
  return _openai;
}

async function openAIEmbed(text: string): Promise<number[]> {
  const client = await getOpenAI();
  const res = await client.embeddings.create({ model: OPENAI_MODEL, input: text.slice(0, 8000) });
  return (res as { data: { embedding: number[] }[] }).data[0].embedding;
}
