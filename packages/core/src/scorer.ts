import { getDb } from "./db.js";
import { embedQuery, cosineSimilarity, deserializeEmbedding } from "./embeddings.js";
import { getGraphDistance } from "./graph.js";
import { getChunkBoost, hashQuery } from "./feedback.js";
import { rerank } from "./rerank.js";
import { join } from "node:path";

export interface ScoredChunk {
  id: string;
  filePath: string;
  kind: string;
  name?: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}

interface DbChunk {
  id: string;
  file_path: string;
  kind: string;
  name: string | null;
  start_line: number;
  end_line: number;
  content: string;
  embedding: string | null;
  git_updated_at: number | null;
}

function structuralScore(dist: number): number {
  if (dist === 0) return 1.0;
  if (dist === 1) return 0.8;
  if (dist === 2) return 0.6;
  if (dist === 3) return 0.4;
  return 0.0;
}

export async function searchContext(
  query: string,
  projectRoot: string,
  topK = 10
): Promise<ScoredChunk[]> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const queryVec = await embedQuery(query);
  const queryHash = hashQuery(query);

  // Read current edit context (set via set_context MCP tool)
  const ctxRow = db.query<{ file: string | null }, []>(
    "SELECT file FROM context_state WHERE id = 1"
  ).get();
  const contextFile = ctxRow?.file ?? null;

  const chunks = db.query<DbChunk, []>(
    "SELECT c.*, f.git_updated_at FROM chunks c LEFT JOIN file_meta f ON c.file_path = f.path WHERE c.embedding IS NOT NULL"
  ).all();

  const now = Math.floor(Date.now() / 1000);
  const maxAge = 365 * 24 * 3600;

  // Fetch topK*3 candidates for re-ranking
  const candidateCount = topK * 3;

  const scored = chunks.map((chunk) => {
    const embedding = deserializeEmbedding(chunk.embedding!);
    const semantic = cosineSimilarity(queryVec, embedding);

    // Temporal: recency boost
    const age = chunk.git_updated_at ? now - chunk.git_updated_at : maxAge;
    const temporal = Math.max(0, 1 - age / maxAge);

    // Structural: graph distance from current edit context
    let structural = 0.5; // neutral when no context set
    if (contextFile) {
      const dist = getGraphDistance(contextFile, chunk.file_path, projectRoot);
      structural = structuralScore(dist);
    }

    const base = semantic * 0.65 + structural * 0.20 + temporal * 0.15;

    // Feedback boost: chunks the agent has explicitly expanded before rank higher
    const boost = getChunkBoost(chunk.id, projectRoot);

    return {
      id: chunk.id,
      filePath: chunk.file_path,
      kind: chunk.kind,
      name: chunk.name ?? undefined,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      content: chunk.content,
      score: Math.min(1.0, base + boost),
    };
  });

  const topCandidates = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateCount);

  // BM25 re-rank the candidates for keyword precision
  return rerank(query, topCandidates, topK);
}
